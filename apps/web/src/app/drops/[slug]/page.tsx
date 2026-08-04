"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { AnimatePresence, m } from "framer-motion";
import type { Collection, MintIntentResponse, MintResult } from "@unipad/shared";
import { api, API_URL } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { dropPriceLabel, isMintable, collectionStatusLabel, cleanDropDescription } from "@/lib/drops";
import { formatLaunchAt } from "@/lib/schedule";
import { useToast } from "@/lib/toast";
import { useWallet } from "@/lib/wallet";
import { prepareSpherePaymentWindow } from "@/lib/sphereConnect";
import { rememberMint } from "@/lib/mintCache";
import { clearLaunchCheckpoint } from "@/lib/launchCheckpoint";
import { DROP_DETAIL_FALLBACKS, isOptimizableCoverUrl, resolveCoverUrl } from "@/lib/media";
import { fadeUp, scaleIn, springSnappy } from "@/lib/motion";

type Stage = "ready" | "intent" | "paying" | "queued" | "minting" | "done" | "error";

export default function DropDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const {
    token,
    principal,
    displayName,
    ensureSphereConnected,
    ensureSphereForPayment,
    connecting,
    payUct,
  } = useWallet();
  const toast = useToast();

  const [collection, setCollection] = useState<Collection | null>(null);
  const [stage, setStage] = useState<Stage>("ready");
  const [intent, setIntent] = useState<MintIntentResponse | null>(null);
  const [result, setResult] = useState<MintResult | null>(null);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [liveSupply, setLiveSupply] = useState<{ minted: number; remaining: number } | null>(
    null,
  );
  const [notFound, setNotFound] = useState(false);

  const intentKeyRef = useRef<string | null>(null);
  const mintLockRef = useRef(false);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const refresh = useCallback(() => {
    api
      .getCollection(slug, token ?? undefined)
      .then((c) => {
        setCollection(c);
        setLiveSupply({ minted: c.mintedCount, remaining: c.remainingSupply });
        setNotFound(false);
      })
      .catch((e) => {
        if (typeof e === "object" && e && "status" in e && (e as { status: number }).status === 404) {
          setNotFound(true);
          setCollection(null);
        } else {
          toastRef.current.error(e);
        }
      });
  }, [slug, token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    intentKeyRef.current = intent?.idempotencyKey ?? null;
  }, [intent?.idempotencyKey]);

  useEffect(() => {
    if (!collection) return;
    // Live site has no WS backend unless NEXT_PUBLIC_WS_URL points at the API.
    // Skipping avoids noisy failed sockets against the Next origin on Vercel.
    const configuredWs = process.env.NEXT_PUBLIC_WS_URL?.trim();
    if (!configuredWs && /vercel\.app$/i.test(typeof window !== "undefined" ? window.location.hostname : "")) {
      return;
    }
    const collectionId = collection.id;
    const wsBase = configuredWs || API_URL.replace(/^http/, "ws");
    if (!/^wss?:\/\//i.test(wsBase)) return;
    const channels = [`collection:${collectionId}`];
    if (principal) channels.push(`wallet:${principal}`);
    const url = `${wsBase.replace(/\/$/, "")}/?${channels
      .map((ch) => `channel=${encodeURIComponent(ch)}`)
      .join("&")}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      return;
    }
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as {
          type?: string;
          remainingSupply?: number;
          mintedCount?: number;
          queuePosition?: number;
          idempotencyKey?: string;
          status?: string;
          tokenId?: number;
          mintTxRef?: string;
        };
        if (msg.type === "supply.updated" && msg.mintedCount != null) {
          setLiveSupply({
            minted: msg.mintedCount,
            remaining: msg.remainingSupply ?? 0,
          });
        }
        if (msg.type === "queue.position" && msg.idempotencyKey) {
          setQueuePosition(msg.queuePosition ?? null);
          if ((msg.queuePosition ?? 0) > 0) setStage("queued");
          if (msg.queuePosition === 0) setStage("minting");
        }
        if (msg.type === "mint.result" && msg.status === "confirmed") {
          setResult({
            status: "confirmed",
            idempotencyKey: msg.idempotencyKey ?? intentKeyRef.current ?? "",
            tokenId: msg.tokenId,
            mintTxRef: msg.mintTxRef,
          });
          setStage("done");
          setQueuePosition(null);
          toastRef.current.success("Mint complete", `You got #${msg.tokenId}.`);
          refresh();
        }
      } catch {
        /* ignore */
      }
    };
    return () => ws.close();
  }, [collection?.id, principal, refresh]);

  const [trackPct, setTrackPct] = useState(0);

  useEffect(() => {
    const targets: Partial<Record<Stage, number>> = {
      ready: 0,
      intent: 22,
      paying: 48,
      queued: 68,
      minting: 88,
      done: 100,
    };
    if (stage === "error") return;
    const target = targets[stage] ?? 0;
    if (stage === "ready") {
      setTrackPct(0);
      return;
    }
    setTrackPct((prev) => (prev < target ? Math.max(prev, Math.floor(target * 0.35)) : prev));
    const id = window.setInterval(() => {
      setTrackPct((prev) => {
        if (prev >= target) return target;
        const step = Math.max(1, Math.ceil((target - prev) / 6));
        return Math.min(target, prev + step);
      });
    }, 180);
    return () => window.clearInterval(id);
  }, [stage]);

  const priceLabel = useMemo(
    () => (collection ? dropPriceLabel(collection) : "—"),
    [collection],
  );

  async function runMint() {
    if (!collection || mintLockRef.current) return;
    mintLockRef.current = true;

    let sessionToken: string;
    try {
      setStage("ready");
      // Sphere Connect must open from this click. JWT alone is not enough to pay.
      sessionToken = await ensureSphereConnected();
    } catch (e) {
      toast.error(e);
      mintLockRef.current = false;
      return;
    }

    setResult(null);
    setQueuePosition(null);

    let nextIntent: MintIntentResponse;
    try {
      setStage("intent");
      toast.info("Reserving your spot…");
      try {
        nextIntent = await api.mintIntent(sessionToken, collection.id, displayName);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          sessionToken = await ensureSphereConnected();
          nextIntent = await api.mintIntent(sessionToken, collection.id, displayName);
        } else {
          throw err;
        }
      }
      setIntent(nextIntent);
    } catch (e) {
      toast.error(e);
      setStage("error");
      mintLockRef.current = false;
      return;
    }

    // Sphere send UI must start inside the confirm-button click — not after
    // mint-intent awaits — or Chrome blocks the wallet popup and we hang at 48%.
    // Closing the Sphere window after Connect also kills send; Pay reopens it.
    let paymentRef: string | null;
    try {
      paymentRef = await toast.confirmAndRun({
        title: `Mint for ${priceLabel}?`,
        message:
          "Tap Pay to open Sphere and approve the UCT transfer. Keep the Sphere wallet window open until you confirm.",
        confirmLabel: "Pay with Sphere",
        cancelLabel: "Cancel",
        run: () => {
          // Sync under this click — reopen/focus Sphere before any await.
          try {
            prepareSpherePaymentWindow();
          } catch {
            /* ensureSphereForPayment will surface a clear error */
          }
          setStage("paying");
          toast.info(
            "Approve UCT in Sphere",
            "Look at the Sphere wallet window (or extension) and confirm. Keep it open.",
          );
          return (async () => {
            await ensureSphereForPayment();
            return payUct({
              recipient: nextIntent.payment.recipient,
              amount: nextIntent.payment.amount,
              memo: nextIntent.payment.memo,
              coinIdHex: nextIntent.payment.coinIdHex,
            });
          })();
        },
      });
    } catch (e) {
      const info = toast.error(e);
      if (
        info.code === "UPAD_PAYMENT_REJECTED" ||
        info.code === "UPAD_INSUFFICIENT_FUNDS" ||
        info.code === "UPAD_UNAUTHORIZED" ||
        info.code === "UPAD_PAYMENT_TIMEOUT"
      ) {
        setStage("ready");
      } else {
        setStage("error");
      }
      mintLockRef.current = false;
      return;
    }

    if (!paymentRef) {
      setStage("ready");
      mintLockRef.current = false;
      return;
    }

    try {
      setStage("minting");
      toast.info("Finishing your mint…");
      const mintResult = await api.mint(
        sessionToken,
        collection.id,
        nextIntent.idempotencyKey,
        paymentRef,
      );
      setResult(mintResult);
      if (mintResult.queuePosition && mintResult.queuePosition > 0) {
        setQueuePosition(mintResult.queuePosition);
        setStage("queued");
        toast.info("You’re in line", `Position ${mintResult.queuePosition}. Stay on this page.`);
      } else if (mintResult.status === "confirmed") {
        setStage("done");
        toast.success("Mint complete", `You got #${mintResult.tokenId}.`);
        if (principal && mintResult.tokenId != null) {
          rememberMint({
            collectionId: collection.id,
            collectionName: collection.name,
            slug: collection.slug,
            coverUrl: collection.coverUrl,
            tokenId: mintResult.tokenId,
            mintTxRef: mintResult.mintTxRef || "",
            mintedAt: new Date().toISOString(),
            ownerPrincipal: principal,
          });
        }
      } else if (mintResult.status === "refund_pending") {
        setStage("ready");
        toast.info(
          "Refund pending",
          mintResult.reason === "mint_cap"
            ? "You already hit the mint limit. Your payment is cancelled for an automatic refund."
            : "This drop sold out before your mint finished. Your payment is cancelled for an automatic refund.",
        );
      } else if (mintResult.status === "rejected") {
        setStage("ready");
        toast.error(
          new Error(
            mintResult.reason === "sold_out"
              ? "Sold out — no mint was issued."
              : mintResult.reason || "Mint failed",
          ),
        );
      } else {
        setStage("ready");
        toast.error(new Error(mintResult.reason || "Mint failed"));
      }
      refresh();
    } catch (e) {
      const info = toast.error(e);
      if (
        info.code === "UPAD_PAYMENT_REJECTED" ||
        info.code === "UPAD_INSUFFICIENT_FUNDS" ||
        info.code === "UPAD_UNAUTHORIZED"
      ) {
        setStage("ready");
      } else {
        setStage("error");
      }
    } finally {
      mintLockRef.current = false;
    }
  }

  if (notFound) {
    return (
      <section className="section">
        <div className="shell" style={{ maxWidth: 480 }}>
          <h2>Drop not found</h2>
          <p className="muted">
            {token
              ? "It may have been removed or the link is wrong."
              : "If this is your saved draft, connect the same wallet you used to create it."}
          </p>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <Link href="/drops" className="btn btn-signal">
              Browse drops
            </Link>
            <Link href="/launch" className="btn btn-ghost">
              Create a drop
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (!collection) {
    return (
      <section className="section">
        <div className="shell muted">Loading drop…</div>
      </section>
    );
  }

  const minted = liveSupply?.minted ?? collection.mintedCount;
  const remaining = liveSupply?.remaining ?? collection.remainingSupply;
  const supplyPct = Math.min(100, Math.round((minted / Math.max(1, collection.totalSupply)) * 100));
  const mintable = isMintable({ ...collection, remainingSupply: remaining, mintedCount: minted });
  const busy =
    connecting ||
    stage === "paying" ||
    stage === "minting" ||
    stage === "queued" ||
    stage === "intent";

  const stageProgress = trackPct;

  const stageLabel =
    stage === "intent"
      ? "Reserving your spot…"
      : stage === "paying"
        ? "Approve UCT in Sphere…"
        : stage === "queued"
          ? `In line${queuePosition ? ` #${queuePosition}` : ""}…`
          : stage === "minting"
            ? "Confirming your mint…"
            : stage === "done"
              ? "Mint complete"
              : null;

  const description = cleanDropDescription(
    collection.description,
    collection.creatorDisplayName,
  );
  const coverSrc = resolveCoverUrl(collection.coverUrl, DROP_DETAIL_FALLBACKS[0]);

  return (
    <m.section
      className="shell collection-hero"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.45 }}
    >
      <m.div
        className="visual"
        initial={{ opacity: 0, scale: 1.04 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      >
        <Image
          src={coverSrc}
          alt=""
          fill
          sizes="(max-width: 860px) 100vw, 55vw"
          priority
          style={{ objectFit: "cover", objectPosition: "center" }}
          unoptimized={!isOptimizableCoverUrl(coverSrc)}
        />
      </m.div>

      <m.div
        className="mint-stage mint-card"
        variants={scaleIn}
        initial="hidden"
        animate="show"
      >
        <Link href="/drops" className="text-link back-link">
          ← All drops
        </Link>

        <div className={`pill-status status-${collection.status}`}>
          {collectionStatusLabel({
            status: collection.status,
            remainingSupply: liveSupply?.remaining ?? collection.remainingSupply,
          })}
        </div>
        <h1 className="display" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
          {collection.name}
        </h1>
        <div className="muted">by {collection.creatorDisplayName || "Creator"}</div>
        {description ? (
          <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>
            {description}
          </p>
        ) : null}

        <div className="mint-price-row">
          <div>
            <div className="mint-price">{priceLabel}</div>
            <div className="muted">
              {remaining} left · {minted}/{collection.totalSupply} minted
              {collection.activePhase?.maxPerWallet
                ? ` · max ${collection.activePhase.maxPerWallet}/wallet`
                : null}
            </div>
          </div>
          <div
            className={`supply-bar mint-supply${busy ? " is-live" : ""}`}
            aria-hidden
          >
            <m.span
              className="supply-fill"
              animate={{
                width: `${
                  busy
                    ? Math.min(99, Math.max(supplyPct, supplyPct + Math.round(stageProgress * 0.12)))
                    : supplyPct
                }%`,
              }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            />
            {busy ? <span className="supply-pulse" /> : null}
          </div>
        </div>

        {collection.phases.some((p) => {
          if (p.type !== "allowlist") return false;
          const now = Date.now();
          const startOk = !p.startsAt || Date.parse(p.startsAt) <= now;
          const endOk = !p.endsAt || Date.parse(p.endsAt) > now;
          return startOk && endOk;
        }) ? (
          <p className="hint" style={{ margin: 0 }}>
            Allowlist mint — only guest-list @nametags or wallets can mint right now.
          </p>
        ) : null}

        <AnimatePresence>
          {busy || stage === "done" ? (
            <m.div
              className="mint-track"
              aria-live="polite"
              key="track"
              variants={fadeUp}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0, height: 0 }}
            >
              <div className="mint-track-label">
                <span>{stageLabel ?? "Working…"}</span>
                <span className="muted">{stageProgress}%</span>
              </div>
              <div className={`mint-track-bar${busy ? " is-live" : ""}`}>
                <m.span
                  animate={{ width: `${stageProgress}%` }}
                  transition={{ duration: 0.35 }}
                />
                {busy ? <span className="mint-track-shim" /> : null}
              </div>
            </m.div>
          ) : null}
        </AnimatePresence>

        {stage === "paying" ? (
          <div className="flash">
            Waiting on Sphere — approve the UCT payment in the Sphere wallet window or extension.
            Keep that window open.
          </div>
        ) : null}

        {queuePosition && queuePosition > 0 ? (
          <div className="flash">
            You’re in line (#{queuePosition}). Keep this page open — we’ll finish for you.
          </div>
        ) : null}

        {result?.status === "confirmed" ? (
          <m.div className="flash ok" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            Minted #{result.tokenId}.{" "}
            <Link href="/wallet" className="text-link">
              Open My mints
            </Link>{" "}
            to view it or send it to another wallet.
          </m.div>
        ) : null}

        <m.button
          type="button"
          className="btn btn-signal"
          disabled={busy || !mintable}
          whileHover={busy || !mintable ? undefined : { y: -2 }}
          whileTap={busy || !mintable ? undefined : { scale: 0.98 }}
          transition={springSnappy}
          onClick={runMint}
        >
          {!token
            ? connecting
              ? "Connecting…"
              : "Connect Sphere to mint"
            : stage === "paying"
              ? "Approve in Sphere…"
              : stage === "queued"
                ? `In line #${queuePosition ?? "…"}`
                : stage === "minting" || stage === "intent"
                  ? "Working on it…"
                  : !mintable
                    ? collection.status === "draft"
                      ? "Not published yet"
                      : collection.status === "scheduled"
                        ? "Not open yet"
                        : "Minted"
                    : `Mint · ${priceLabel}`}
        </m.button>

        {collection.status === "draft" ? (
          <p className="hint" style={{ marginTop: "0.75rem" }}>
            Draft preview — close this tab when you’re done.{" "}
            <Link
              href="/launch?fresh=1"
              className="text-link"
              onClick={() => clearLaunchCheckpoint()}
            >
              Start over
            </Link>
          </p>
        ) : null}

        {collection.status === "scheduled" && collection.launchAt ? (
          <p className="hint">Minting opens {formatLaunchAt(collection.launchAt)}.</p>
        ) : null}
      </m.div>
    </m.section>
  );
}

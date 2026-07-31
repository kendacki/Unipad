"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import type { Collection, MintIntentResponse, MintResult } from "@unipad/shared";
import { api, API_URL } from "@/lib/api";
import { dropPriceLabel, isMintable, statusLabel } from "@/lib/drops";
import { formatLaunchAt } from "@/lib/schedule";
import { useToast } from "@/lib/toast";
import { useWallet } from "@/lib/wallet";
import { DROP_DETAIL_FALLBACKS } from "@/lib/media";

type Stage = "ready" | "intent" | "paying" | "queued" | "minting" | "done" | "error";

export default function DropDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const { token, principal, connectSphere, connecting, payUct } = useWallet();
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
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const refresh = useCallback(() => {
    api
      .getCollection(slug)
      .then((c) => {
        setCollection(c);
        setLiveSupply({ minted: c.mintedCount, remaining: c.remainingSupply });
        setNotFound(false);
      })
      .catch((e) => {
        if (typeof e === "object" && e && "status" in e && (e as { status: number }).status === 404) {
          setNotFound(true);
        } else {
          toastRef.current.error(e);
        }
      });
  }, [slug]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    intentKeyRef.current = intent?.idempotencyKey ?? null;
  }, [intent?.idempotencyKey]);

  useEffect(() => {
    if (!collection) return;
    const collectionId = collection.id;
    const wsBase = process.env.NEXT_PUBLIC_WS_URL ?? API_URL.replace(/^http/, "ws");
    const channels = [`collection:${collectionId}`];
    if (principal) channels.push(`wallet:${principal}`);
    const url = `${wsBase}/?${channels.map((ch) => `channel=${encodeURIComponent(ch)}`).join("&")}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      return;
    }
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
    if (!token || !collection) {
      try {
        await connectSphere();
        toast.success("Wallet connected", "Tap Mint again to continue.");
      } catch (e) {
        toast.error(e);
      }
      return;
    }

    const ok = await toast.confirm({
      title: `Mint for ${priceLabel}?`,
      message: "You’ll pay in UCT first. Then we finish your mint automatically.",
      confirmLabel: "Pay & mint",
      cancelLabel: "Cancel",
    });
    if (!ok) return;

    setResult(null);
    try {
      setStage("intent");
      toast.info("Reserving your spot…");
      const nextIntent = await api.mintIntent(token, collection.id);
      setIntent(nextIntent);

      setStage("paying");
      toast.info("Waiting for UCT payment…");
      const paymentRef = await payUct({
        recipient: nextIntent.payment.recipient,
        amount: nextIntent.payment.amount,
        memo: nextIntent.payment.memo,
        coinIdHex: nextIntent.payment.coinIdHex,
      });

      setStage("minting");
      toast.info("Finishing your mint…");
      const mintResult = await api.mint(
        token,
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
      } else {
        setStage("error");
        toast.error(new Error(mintResult.reason || "Mint failed"));
      }
      refresh();
    } catch (e) {
      toast.error(e);
      setStage("error");
    }
  }

  if (notFound) {
    return (
      <section className="section">
        <div className="shell" style={{ maxWidth: 480 }}>
          <h2>Drop not found</h2>
          <p className="muted">It may have been removed or the link is wrong.</p>
          <Link href="/drops" className="btn btn-signal">
            Browse drops
          </Link>
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
        ? "Waiting for UCT payment…"
        : stage === "queued"
          ? `In line${queuePosition ? ` #${queuePosition}` : ""}…`
          : stage === "minting"
            ? "Confirming your mint…"
            : stage === "done"
              ? "Mint complete"
              : null;

  return (
    <section className="shell collection-hero">
      <div className="visual">
        <Image
          src={collection.coverUrl || DROP_DETAIL_FALLBACKS[0]}
          alt=""
          fill
          sizes="(max-width: 860px) 100vw, 55vw"
          priority
        />
      </div>

      <div className="mint-stage mint-card">
        <Link href="/drops" className="text-link back-link">
          ← All drops
        </Link>

        <div className={`pill-status status-${collection.status}`}>
          {statusLabel(collection.status)}
        </div>
        <h1 className="display" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
          {collection.name}
        </h1>
        {collection.description ? (
          <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>
            {collection.description}
          </p>
        ) : null}
        <div className="muted">by {collection.creatorDisplayName || "Creator"}</div>

        <div className="mint-price-row">
          <div>
            <div className="mint-price">{priceLabel}</div>
            <div className="muted">
              {remaining} left · {minted}/{collection.totalSupply} minted
            </div>
          </div>
          <div
            className={`supply-bar mint-supply${busy ? " is-live" : ""}`}
            aria-hidden
          >
            <span
              className="supply-fill"
              style={{
                width: `${
                  busy
                    ? Math.min(99, Math.max(supplyPct, supplyPct + Math.round(stageProgress * 0.12)))
                    : supplyPct
                }%`,
              }}
            />
            {busy ? <span className="supply-pulse" /> : null}
          </div>
        </div>

        {busy || stage === "done" ? (
          <div className="mint-track" aria-live="polite">
            <div className="mint-track-label">
              <span>{stageLabel ?? "Working…"}</span>
              <span className="muted">{stageProgress}%</span>
            </div>
            <div className={`mint-track-bar${busy ? " is-live" : ""}`}>
              <span style={{ width: `${stageProgress}%` }} />
              {busy ? <span className="mint-track-shim" /> : null}
            </div>
          </div>
        ) : null}

        {queuePosition && queuePosition > 0 ? (
          <div className="flash">
            You’re in line (#{queuePosition}). Keep this page open — we’ll finish for you.
          </div>
        ) : null}

        {result?.status === "confirmed" ? (
          <div className="flash ok">
            Minted #{result.tokenId}.{" "}
            <Link href="/wallet" className="text-link">
              View in My mints
            </Link>
          </div>
        ) : null}

        <button
          type="button"
          className="btn btn-signal"
          disabled={busy || !mintable}
          onClick={runMint}
        >
          {!token
            ? connecting
              ? "Connecting…"
              : "Connect Sphere to mint"
            : stage === "paying"
              ? "Confirm payment…"
              : stage === "queued"
                ? `In line #${queuePosition ?? "…"}`
                : stage === "minting" || stage === "intent"
                  ? "Working on it…"
                  : !mintable
                    ? collection.status === "scheduled"
                      ? "Not open yet"
                      : "Sold out"
                    : `Mint · ${priceLabel}`}
        </button>

        {collection.status === "scheduled" && collection.launchAt ? (
          <p className="hint">Minting opens {formatLaunchAt(collection.launchAt)}.</p>
        ) : (
          <p className="hint">Pay with UCT first — then we confirm your NFT.</p>
        )}
      </div>
    </section>
  );
}

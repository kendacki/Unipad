"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { m } from "framer-motion";
import { api } from "@/lib/api";
import {
  cachedMintsFor,
  removeCachedMint,
  replaceCachedMintsFor,
} from "@/lib/mintCache";
import { prepareSpherePaymentWindow } from "@/lib/sphereConnect";
import { useToast } from "@/lib/toast";
import { useWallet } from "@/lib/wallet";
import { DROP_COVER_FALLBACKS } from "@/lib/media";
import { fadeUp, springSnappy } from "@/lib/motion";

type TokenRow = {
  collectionId: string;
  collectionName: string;
  slug: string;
  coverUrl: string | null;
  tokenId: number;
  mintTxRef: string;
  mintedAt: string;
  ownerPrincipal?: string;
};

function principalFromJwt(jwt: string | null): string | null {
  if (!jwt) return null;
  try {
    const part = jwt.split(".")[1];
    if (!part) return null;
    const padded = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const json = atob(padded + pad);
    const payload = JSON.parse(json) as { sub?: string };
    return typeof payload.sub === "string" ? payload.sub.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

function nametagQuery(displayName: string | null): string | null {
  if (!displayName) return null;
  const t = displayName.trim();
  if (!t || t.startsWith("0x") || t.includes("…") || t.includes("...")) return null;
  if (/^[0-9a-f]{64,66}$/i.test(t)) return null;
  return t.startsWith("@") ? t : `@${t}`;
}

function mergeRows(...lists: TokenRow[][]): TokenRow[] {
  const map = new Map<string, TokenRow>();
  for (const list of lists) {
    for (const row of list) {
      if (!row?.collectionId || row.tokenId == null) continue;
      map.set(`${row.collectionId}:${row.tokenId}`, row);
    }
  }
  return [...map.values()].sort((x, y) => y.mintedAt.localeCompare(x.mintedAt));
}

function formatMintedAt(iso: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

export default function WalletPage() {
  const toast = useToast();
  const {
    principal,
    displayName,
    token,
    connectSphere,
    connecting,
    ensureSphereForPayment,
    resolveTransferRecipient,
    confirmNftTransfer,
  } = useWallet();
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const [recipientDraft, setRecipientDraft] = useState<Record<string, string>>({});

  const sessionPrincipal = useMemo(() => {
    const fromJwt = principalFromJwt(token);
    const raw = (fromJwt || principal || "").trim().toLowerCase().replace(/^0x/, "");
    return raw || null;
  }, [token, principal]);

  const sessionNametag = useMemo(() => nametagQuery(displayName), [displayName]);

  const refresh = useCallback(async () => {
    if (!sessionPrincipal) return;
    setLoading(true);
    setLoadError(null);

    let authTokens: TokenRow[] | null = null;
    let publicTokens: TokenRow[] | null = null;
    let lastError: string | null = null;

    // Authenticated path claims @nametag transfers onto this hex wallet.
    if (token) {
      try {
        const r = await api.myTokens(token, sessionNametag);
        authTokens = Array.isArray(r.tokens) ? r.tokens : [];
      } catch (e) {
        lastError = e instanceof Error ? e.message : "Could not load mints";
      }
    }

    try {
      const r = await api.walletTokens(sessionPrincipal, sessionNametag);
      publicTokens = Array.isArray(r.tokens) ? r.tokens : [];
    } catch (e) {
      if (!authTokens) {
        lastError = e instanceof Error ? e.message : "Could not load mints";
      }
    }

    // Prefer authenticated inventory. Never wipe local cache from a failed/empty
    // public-only response — that made sent/received mints look like they vanished.
    if (authTokens) {
      const remote = mergeRows(authTokens, publicTokens || []);
      replaceCachedMintsFor(
        sessionPrincipal,
        remote.map((t) => ({
          collectionId: t.collectionId,
          collectionName: t.collectionName,
          slug: t.slug,
          coverUrl: t.coverUrl,
          tokenId: t.tokenId,
          mintTxRef: t.mintTxRef,
          mintedAt: t.mintedAt,
          ownerPrincipal: t.ownerPrincipal || sessionPrincipal,
        })),
      );
      setTokens(remote);
      setLoadError(null);
    } else if (publicTokens) {
      const cached = cachedMintsFor(sessionPrincipal);
      const remote = mergeRows(publicTokens, cached);
      replaceCachedMintsFor(
        sessionPrincipal,
        remote.map((t) => ({
          collectionId: t.collectionId,
          collectionName: t.collectionName,
          slug: t.slug,
          coverUrl: t.coverUrl,
          tokenId: t.tokenId,
          mintTxRef: t.mintTxRef,
          mintedAt: t.mintedAt,
          ownerPrincipal: t.ownerPrincipal || sessionPrincipal,
        })),
      );
      setTokens(remote);
    } else {
      setTokens(cachedMintsFor(sessionPrincipal));
      if (lastError) setLoadError(lastError);
    }
    setLoading(false);
  }, [token, sessionPrincipal, sessionNametag]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const onVis = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  async function sendToken(row: TokenRow) {
    if (!token || !sessionPrincipal) return;
    const key = `${row.collectionId}:${row.tokenId}`;
    const toRaw = (recipientDraft[key] || "").trim();
    if (!toRaw) {
      toast.error(new Error("Enter a recipient @nametag or chain pubkey"));
      return;
    }

    let confirmed: boolean | null = null;
    try {
      confirmed = await toast.confirmAndRun({
        title: `Send ${row.collectionName} #${row.tokenId}?`,
        message: `Approve in Sphere to send this mint to ${toRaw}. It will leave your My mints list after confirmation.`,
        confirmLabel: "Confirm in Sphere",
        cancelLabel: "Cancel",
        run: () => {
          try {
            prepareSpherePaymentWindow();
          } catch {
            /* ensureSphereForPayment will surface a clear error */
          }
          toast.info(
            "Approve in Sphere",
            "Confirm the transfer in the Sphere wallet window (or extension). Keep it open.",
          );
          return (async () => {
            setSendingKey(key);
            try {
              await ensureSphereForPayment();
              const to = await resolveTransferRecipient(toRaw);
              await confirmNftTransfer({
                collectionName: row.collectionName,
                collectionId: row.collectionId,
                tokenId: row.tokenId,
                to,
              });
              await api.transferToken(token, {
                collectionId: row.collectionId,
                tokenId: row.tokenId,
                to,
                nametag: sessionNametag,
              });
              return true;
            } finally {
              setSendingKey(null);
            }
          })();
        },
      });
    } catch (e) {
      setSendingKey(null);
      toast.error(e);
      return;
    }

    if (!confirmed) return;

    // Drop from UI + cache immediately so a stale list can’t bring it back.
    removeCachedMint(sessionPrincipal, row.collectionId, row.tokenId);
    setTokens((prev) =>
      prev.filter(
        (t) => !(t.collectionId === row.collectionId && t.tokenId === row.tokenId),
      ),
    );
    toast.success("Mint sent", `Transferred to ${toRaw}.`);
    setRecipientDraft((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    await refresh();
  }

  if (!token || !sessionPrincipal) {
    return (
      <section className="section">
        <div className="shell" style={{ maxWidth: 560 }}>
          <m.div
            className="panel glass"
            variants={fadeUp}
            initial="hidden"
            animate="show"
          >
            <h2>My mints</h2>
            <p className="hint">Connect your wallet to see NFTs you’ve minted and send them.</p>
            <m.button
              type="button"
              className="btn btn-primary"
              disabled={connecting}
              whileHover={connecting ? undefined : { y: -1 }}
              whileTap={connecting ? undefined : { scale: 0.98 }}
              transition={springSnappy}
              onClick={async () => {
                try {
                  await connectSphere();
                  toast.success("Wallet connected");
                } catch (e) {
                  toast.error(e);
                }
              }}
            >
              Connect Sphere
            </m.button>
          </m.div>
        </div>
      </section>
    );
  }

  return (
    <m.section
      className="section"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      <div className="shell">
        <div className="section-head mint-head">
          <h2>My mints</h2>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={loading}
            onClick={() => void refresh()}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {loadError ? (
          <div className="flash" style={{ marginBottom: "1rem" }}>
            {loadError} — tap Refresh.
          </div>
        ) : null}

        {!tokens.length ? (
          <div className="flash glass">
            {loading ? (
              "Loading your mints…"
            ) : (
              <>
                No mints yet.{" "}
                <Link href="/drops" style={{ textDecoration: "underline", color: "var(--orange)" }}>
                  Browse drops
                </Link>
                .
              </>
            )}
          </div>
        ) : (
          <div className="grid-drops mint-grid">
            {tokens.map((t) => {
              const key = `${t.collectionId}:${t.tokenId}`;
              const busy = sendingKey === key;
              const cover =
                t.coverUrl || DROP_COVER_FALLBACKS[t.tokenId % DROP_COVER_FALLBACKS.length];
              return (
                <article key={key} className="mint-card-owned">
                  <Link href={`/drops/${t.slug}`} className="mint-card-media">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={cover} alt="" loading="lazy" />
                  </Link>
                  <div className="mint-card-body">
                    <h3>
                      {t.collectionName} #{t.tokenId}
                    </h3>
                    <p className="mint-card-date">{formatMintedAt(t.mintedAt)}</p>
                    <div className="mint-send">
                      <input
                        id={`to-${key}`}
                        type="text"
                        aria-label="Recipient"
                        placeholder="@nametag or chain pubkey"
                        value={recipientDraft[key] ?? ""}
                        disabled={busy}
                        onChange={(e) =>
                          setRecipientDraft((prev) => ({ ...prev, [key]: e.target.value }))
                        }
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        className="btn btn-signal"
                        disabled={busy || !(recipientDraft[key] || "").trim()}
                        onClick={() => void sendToken(t)}
                      >
                        {busy ? "Confirm in Sphere…" : "Send"}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </m.section>
  );
}

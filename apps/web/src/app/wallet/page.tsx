"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { m } from "framer-motion";
import { api } from "@/lib/api";
import { cachedMintsFor, rememberMint, removeCachedMint } from "@/lib/mintCache";
import { useToast } from "@/lib/toast";
import { shortPrincipal, useWallet } from "@/lib/wallet";
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

export default function WalletPage() {
  const toast = useToast();
  const { principal, displayName, token, connectSphere, connecting } = useWallet();
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

  const refresh = useCallback(async () => {
    if (!sessionPrincipal) return;
    setLoading(true);
    setLoadError(null);

    const local = cachedMintsFor(sessionPrincipal);
    const remoteLists: TokenRow[][] = [];
    let lastError: string | null = null;

    // Public inventory (proven path for this mint) — always try first, no nametag filter.
    try {
      const r = await api.walletTokens(sessionPrincipal);
      remoteLists.push(Array.isArray(r.tokens) ? r.tokens : []);
    } catch (e) {
      lastError = e instanceof Error ? e.message : "Could not load mints";
    }

    // Authenticated list as a second source (merge, never replace).
    if (token) {
      try {
        const r = await api.myTokens(token);
        remoteLists.push(Array.isArray(r.tokens) ? r.tokens : []);
      } catch {
        /* public list is enough */
      }
    }

    const merged = mergeRows(...remoteLists, local);
    for (const t of merged) {
      rememberMint({
        collectionId: t.collectionId,
        collectionName: t.collectionName,
        slug: t.slug,
        coverUrl: t.coverUrl,
        tokenId: t.tokenId,
        mintTxRef: t.mintTxRef,
        mintedAt: t.mintedAt,
        ownerPrincipal: t.ownerPrincipal || sessionPrincipal,
      });
    }

    setTokens(merged);
    if (!merged.length && lastError) setLoadError(lastError);
    setLoading(false);
  }, [token, sessionPrincipal]);

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
    const to = (recipientDraft[key] || "").trim();
    if (!to) {
      toast.error(new Error("Enter a recipient @nametag or chain pubkey"));
      return;
    }

    const confirmed = await toast.confirmAndRun({
      title: `Send ${row.collectionName} #${row.tokenId}?`,
      message: `This moves the mint on Unipad to ${to}. You won’t see it in My mints afterward.`,
      confirmLabel: "Send mint",
      cancelLabel: "Cancel",
      run: async () => {
        setSendingKey(key);
        try {
          await api.transferToken(token, {
            collectionId: row.collectionId,
            tokenId: row.tokenId,
            to,
          });
          return true;
        } finally {
          setSendingKey(null);
        }
      },
    });

    if (!confirmed) return;
    removeCachedMint(sessionPrincipal, row.collectionId, row.tokenId);
    toast.success("Mint sent", `Transferred to ${to}.`);
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
        <div className="section-head">
          <div>
            <h2>My mints</h2>
            <p>
              {displayName && !/^[0-9a-f]{64,66}$/i.test(displayName)
                ? displayName
                : shortPrincipal(sessionPrincipal)}
            </p>
          </div>
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
          <div className="grid-drops">
            {tokens.map((t) => {
              const key = `${t.collectionId}:${t.tokenId}`;
              const busy = sendingKey === key;
              const cover =
                t.coverUrl || DROP_COVER_FALLBACKS[t.tokenId % DROP_COVER_FALLBACKS.length];
              return (
                <div key={key} className="drop-tile mint-owned">
                  <Link href={`/drops/${t.slug}`} className="drop-media">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={cover} alt="" loading="lazy" />
                  </Link>
                  <div className="drop-meta">
                    <div>
                      <h3>
                        {t.collectionName} #{t.tokenId}
                      </h3>
                      <div className="muted">{new Date(t.mintedAt).toLocaleString()}</div>
                    </div>
                    <div className="mint-send">
                      <label className="sr-only" htmlFor={`to-${key}`}>
                        Recipient
                      </label>
                      <input
                        id={`to-${key}`}
                        type="text"
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
                        {busy ? "Sending…" : "Send"}
                      </button>
                    </div>
                    <p className="hint" style={{ marginTop: 8 }}>
                      Send to another Sphere @nametag or their 66-char chain pubkey.
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </m.section>
  );
}

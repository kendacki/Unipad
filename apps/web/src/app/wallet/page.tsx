"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { m } from "framer-motion";
import { api } from "@/lib/api";
import { cachedMintsFor, rememberMint, removeCachedMint } from "@/lib/mintCache";
import { useToast } from "@/lib/toast";
import { shortPrincipal, useWallet } from "@/lib/wallet";
import { DROP_COVER_FALLBACKS } from "@/lib/media";
import { cardItem, fadeUp, springSnappy, staggerFast } from "@/lib/motion";

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

function nametagQuery(displayName: string | null): string | null {
  if (!displayName) return null;
  const t = displayName.trim();
  if (!t || t.startsWith("0x") || t.includes("…") || t.includes("...")) return null;
  if (/^[0-9a-f]{64,66}$/i.test(t)) return null;
  return t;
}

/** Prefer JWT `sub` — source of truth for mint ownership. */
function principalFromJwt(jwt: string | null): string | null {
  if (!jwt) return null;
  try {
    const part = jwt.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { sub?: string };
    return typeof payload.sub === "string" ? payload.sub.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

function mergeRows(a: TokenRow[], b: TokenRow[]): TokenRow[] {
  const map = new Map<string, TokenRow>();
  for (const row of [...b, ...a]) {
    map.set(`${row.collectionId}:${row.tokenId}`, row);
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
    if (!token || !sessionPrincipal) return;
    setLoading(true);
    setLoadError(null);
    const nametag = nametagQuery(displayName);
    const local = cachedMintsFor(sessionPrincipal);

    let remote: TokenRow[] = [];
    const errors: string[] = [];

    try {
      const r = await api.myTokens(token, nametag);
      remote = r.tokens;
      for (const t of r.tokens) {
        rememberMint({
          ...t,
          ownerPrincipal: t.ownerPrincipal || sessionPrincipal,
        });
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "Session mint list failed");
      try {
        const r = await api.walletTokens(sessionPrincipal, nametag);
        remote = r.tokens;
        for (const t of r.tokens) {
          rememberMint({
            ...t,
            ownerPrincipal: t.ownerPrincipal || sessionPrincipal,
          });
        }
      } catch (e2) {
        errors.push(e2 instanceof Error ? e2.message : "Wallet mint list failed");
        // Last resort: public list without nametag (avoids bad nametag filter)
        try {
          const r = await api.walletTokens(sessionPrincipal);
          remote = r.tokens;
        } catch (e3) {
          errors.push(e3 instanceof Error ? e3.message : "Public mint list failed");
        }
      }
    }

    const merged = mergeRows(remote, local);
    setTokens(merged);
    if (!merged.length && errors.length) {
      setLoadError(errors[0] ?? "Could not load mints");
    }
    setLoading(false);
  }, [token, sessionPrincipal, displayName]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => {
      void refresh();
    };
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
            nametag: nametagQuery(displayName),
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
        <m.div className="section-head" variants={fadeUp} initial="hidden" animate="show">
          <div>
            <h2>My mints</h2>
            <p>
              {displayName ? `${displayName} · ` : ""}
              {shortPrincipal(sessionPrincipal)}
            </p>
            <p className="hint" style={{ marginTop: 6, maxWidth: 40 * 16 }}>
              Wallet id: <code style={{ fontSize: "0.75rem", wordBreak: "break-all" }}>{sessionPrincipal}</code>
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
        </m.div>

        {loadError ? (
          <div className="flash" style={{ marginBottom: "1rem" }}>
            {loadError} — tap Refresh. Use the same Sphere wallet you minted with.
          </div>
        ) : null}

        {!tokens.length ? (
          <m.div className="flash glass" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            {loading ? (
              "Loading your mints…"
            ) : (
              <>
                No mints for this wallet yet.{" "}
                <Link href="/drops" style={{ textDecoration: "underline", color: "var(--orange)" }}>
                  Browse drops
                </Link>
                . If you already minted, reconnect the same Sphere account and tap Refresh.
              </>
            )}
          </m.div>
        ) : (
          <m.div
            className="grid-drops"
            variants={staggerFast}
            initial="hidden"
            animate="show"
          >
            {tokens.map((t) => {
              const key = `${t.collectionId}:${t.tokenId}`;
              const busy = sendingKey === key;
              const cover =
                t.coverUrl || DROP_COVER_FALLBACKS[t.tokenId % DROP_COVER_FALLBACKS.length];
              return (
                <m.div
                  key={key}
                  className="drop-tile mint-owned"
                  variants={cardItem}
                  whileHover={{ y: -4 }}
                >
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
                </m.div>
              );
            })}
          </m.div>
        )}
      </div>
    </m.section>
  );
}

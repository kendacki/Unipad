"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { m } from "framer-motion";
import { api } from "@/lib/api";
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

/** Only pass real Sphere nametags — ignore hex / truncated display labels. */
function nametagQuery(displayName: string | null): string | null {
  if (!displayName) return null;
  const t = displayName.trim();
  if (!t || t.startsWith("0x") || t.includes("…") || t.includes("...")) return null;
  if (/^[0-9a-f]{64,66}$/i.test(t)) return null;
  return t;
}

export default function WalletPage() {
  const toast = useToast();
  const { principal, displayName, token, connectSphere, connecting } = useWallet();
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const [recipientDraft, setRecipientDraft] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    if (!token || !principal) return;
    setLoading(true);
    const nametag = nametagQuery(displayName);
    try {
      const r = await api.myTokens(token, nametag);
      setTokens(r.tokens);
    } catch (e) {
      try {
        const r = await api.walletTokens(principal, nametag);
        setTokens(r.tokens);
      } catch {
        toast.error(e);
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toast is stable enough; avoid refresh loops
  }, [token, principal, displayName]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") onFocus();
    });
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  async function sendToken(row: TokenRow) {
    if (!token || !principal) return;
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
    toast.success("Mint sent", `Transferred to ${to}.`);
    setRecipientDraft((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    await refresh();
  }

  if (!token || !principal) {
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
              {shortPrincipal(principal)}
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

        {!tokens.length ? (
          <m.div className="flash glass" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
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
              return (
                <m.div
                  key={key}
                  className="drop-tile mint-owned"
                  variants={cardItem}
                  whileHover={{ y: -4 }}
                >
                  <Link href={`/drops/${t.slug}`} className="drop-media">
                    <Image
                      src={
                        t.coverUrl || DROP_COVER_FALLBACKS[t.tokenId % DROP_COVER_FALLBACKS.length]
                      }
                      alt=""
                      fill
                      sizes="(max-width: 640px) 100vw, 360px"
                      loading="lazy"
                    />
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
                        className="input"
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

"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
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
};

export default function WalletPage() {
  const toast = useToast();
  const { principal, token, connectSphere, connecting } = useWallet();
  const [tokens, setTokens] = useState<TokenRow[]>([]);

  useEffect(() => {
    if (!principal) return;
    let cancelled = false;
    api
      .walletTokens(principal)
      .then((r) => {
        if (!cancelled) setTokens(r.tokens);
      })
      .catch((e) => {
        if (!cancelled) toast.error(e);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [principal]);

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
            <p className="hint">Connect your wallet to see NFTs you’ve minted.</p>
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
            <p>{shortPrincipal(principal)}</p>
          </div>
        </m.div>
        {!tokens.length ? (
          <m.div className="flash glass" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            No mints yet.{" "}
            <Link href="/drops" style={{ textDecoration: "underline", color: "var(--orange)" }}>
              Browse drops
            </Link>
            .
          </m.div>
        ) : (
          <m.div
            className="grid-drops"
            variants={staggerFast}
            initial="hidden"
            animate="show"
          >
            {tokens.map((t) => (
              <m.div key={`${t.collectionId}-${t.tokenId}`} variants={cardItem} whileHover={{ y: -6 }}>
                <Link href={`/drops/${t.slug}`} className="drop-tile">
                  <div className="drop-media">
                    <Image
                      src={
                        t.coverUrl || DROP_COVER_FALLBACKS[t.tokenId % DROP_COVER_FALLBACKS.length]
                      }
                      alt=""
                      fill
                      sizes="(max-width: 640px) 100vw, 360px"
                      loading="lazy"
                    />
                  </div>
                  <div className="drop-meta">
                    <div>
                      <h3>
                        {t.collectionName} #{t.tokenId}
                      </h3>
                      <div className="muted">{new Date(t.mintedAt).toLocaleString()}</div>
                    </div>
                  </div>
                </Link>
              </m.div>
            ))}
          </m.div>
        )}
      </div>
    </m.section>
  );
}

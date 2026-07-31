"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { shortPrincipal, useWallet } from "@/lib/wallet";
import { DROP_COVER_FALLBACKS } from "@/lib/media";

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
    // toast is stable via useMemo in ToastProvider
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [principal]);

  if (!token || !principal) {
    return (
      <section className="section">
        <div className="shell" style={{ maxWidth: 560 }}>
          <div className="panel glass">
            <h2>My mints</h2>
            <p className="hint">Connect your wallet to see NFTs you’ve minted.</p>
            <button
              type="button"
              className="btn btn-primary"
              disabled={connecting}
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
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="section">
      <div className="shell">
        <div className="section-head">
          <div>
            <h2>My mints</h2>
            <p>{shortPrincipal(principal)}</p>
          </div>
        </div>
        {!tokens.length ? (
          <div className="flash glass">
            No mints yet.{" "}
            <Link href="/drops" style={{ textDecoration: "underline", color: "var(--orange)" }}>
              Browse drops
            </Link>
            .
          </div>
        ) : (
          <div className="grid-drops">
            {tokens.map((t) => (
              <Link
                key={`${t.collectionId}-${t.tokenId}`}
                href={`/drops/${t.slug}`}
                className="drop-tile"
              >
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
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import { m } from "framer-motion";
import type { RoyaltyEntry, RoyaltySummary } from "@unipad/shared";
import { formatUct } from "@unipad/shared";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { useWallet } from "@/lib/wallet";
import { cardItem, fadeUp, springSnappy, staggerFast } from "@/lib/motion";

export default function RoyaltiesPage() {
  const toast = useToast();
  const { token, connectSphere, connecting } = useWallet();
  const [summary, setSummary] = useState<RoyaltySummary | null>(null);
  const [entries, setEntries] = useState<RoyaltyEntry[]>([]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api
      .royalties(token)
      .then((r) => {
        if (cancelled) return;
        setSummary(r.summary);
        setEntries(r.entries);
      })
      .catch((e) => {
        if (cancelled) return;
        // Session expired — ask to reconnect. Other errors: soft empty state.
        const code = e && typeof e === "object" && "code" in e ? String((e as { code: string }).code) : "";
        if (code === "UPAD_UNAUTHORIZED" || code === "UPAD_AUTH_FAILED") {
          toast.error(e);
        } else {
          setSummary({ accruedUct: "0", paidUct: "0", platformFeeBps: 250 });
          setEntries([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, toast]);

  if (!token) {
    return (
      <section className="section">
        <div className="shell" style={{ maxWidth: 560 }}>
          <m.div className="panel glass" variants={fadeUp} initial="hidden" animate="show">
            <h2>Earnings</h2>
            <p className="hint">See UCT you’ve earned from mints on your drops.</p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
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
            </div>
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
            <h2>Earnings</h2>
            <p>
              Primary mint sales after the platform fee (
              {summary ? `${summary.platformFeeBps / 100}%` : "—"}).
            </p>
          </div>
        </m.div>

        {summary ? (
          <m.div
            className="panel glass"
            style={{ marginBottom: "1.5rem" }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springSnappy}
          >
            <div>
              <strong>{formatUct(summary.accruedUct)} UCT</strong> waiting
            </div>
            <div className="muted">{formatUct(summary.paidUct)} UCT already paid</div>
          </m.div>
        ) : null}

        {!entries.length ? (
          <m.div className="flash glass" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            No earnings yet. Publish a drop and get mints.
          </m.div>
        ) : (
          <m.div className="grid-drops" variants={staggerFast} initial="hidden" animate="show">
            {entries.map((e) => (
              <m.div
                key={e.id}
                className="drop-tile panel glass"
                variants={cardItem}
                whileHover={{ y: -4 }}
                transition={springSnappy}
              >
                <div className="drop-meta">
                  <div>
                    <h3>{e.collectionName}</h3>
                    <div className="muted">{new Date(e.createdAt).toLocaleString()}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="pill-status">{e.payoutStatus}</div>
                    <div style={{ marginTop: 4 }}>
                      <strong>{formatUct(e.creatorNetUct)} UCT</strong>
                    </div>
                    <div className="muted">
                      sale {formatUct(e.grossUct)} · fee {formatUct(e.platformFeeUct)}
                    </div>
                  </div>
                </div>
              </m.div>
            ))}
          </m.div>
        )}
      </div>
    </m.section>
  );
}

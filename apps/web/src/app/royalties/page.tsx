"use client";

import { useEffect, useState } from "react";
import type { RoyaltyEntry, RoyaltySummary } from "@unipad/shared";
import { formatUct } from "@unipad/shared";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { useWallet } from "@/lib/wallet";

export default function RoyaltiesPage() {
  const toast = useToast();
  const { token, connectSphere, connecting } = useWallet();
  const [summary, setSummary] = useState<RoyaltySummary | null>(null);
  const [entries, setEntries] = useState<RoyaltyEntry[]>([]);

  useEffect(() => {
    if (!token) return;
    api
      .royalties(token)
      .then((r) => {
        setSummary(r.summary);
        setEntries(r.entries);
      })
      .catch((e) => toast.error(e));
  }, [token, toast]);

  if (!token) {
    return (
      <section className="section">
        <div className="shell" style={{ maxWidth: 560 }}>
          <div className="panel glass">
            <h2>Earnings</h2>
            <p className="hint">See UCT you’ve earned from mints on your drops.</p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
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
        </div>
      </section>
    );
  }

  return (
    <section className="section">
      <div className="shell">
        <div className="section-head">
          <div>
            <h2>Earnings</h2>
            <p>
              Primary mint sales after the platform fee (
              {summary ? `${summary.platformFeeBps / 100}%` : "—"}).
            </p>
          </div>
        </div>

        {summary ? (
          <div className="panel glass" style={{ marginBottom: "1.5rem" }}>
            <div>
              <strong>{formatUct(summary.accruedUct)} UCT</strong> waiting
            </div>
            <div className="muted">{formatUct(summary.paidUct)} UCT already paid</div>
          </div>
        ) : null}

        {!entries.length ? (
          <div className="flash glass">No earnings yet. Publish a drop and get mints.</div>
        ) : (
          <div className="grid-drops">
            {entries.map((e) => (
              <div key={e.id} className="drop-tile panel glass">
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
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { m } from "framer-motion";
import {
  DEFAULT_PLATFORM_FEE_BPS,
  formatUct,
  type RoyaltyEntry,
  type RoyaltySummary,
} from "@unipad/shared";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { useWallet } from "@/lib/wallet";
import { fadeUp, springSnappy } from "@/lib/motion";

const emptySummary = (): RoyaltySummary => ({
  accruedUct: "0",
  paidUct: "0",
  platformFeeBps: DEFAULT_PLATFORM_FEE_BPS,
  grossSalesUct: "0",
  platformFeesUct: "0",
  saleCount: 0,
});

function statusLabel(status: string) {
  if (status === "paid") return "Paid";
  if (status === "accrued") return "Credited";
  return status;
}

export default function RoyaltiesPage() {
  const toast = useToast();
  const { token, connectSphere, connecting } = useWallet();
  const [summary, setSummary] = useState<RoyaltySummary | null>(null);
  const [entries, setEntries] = useState<RoyaltyEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    api
      .royalties(token)
      .then((r) => {
        if (cancelled) return;
        setSummary({ ...emptySummary(), ...r.summary });
        setEntries(r.entries);
      })
      .catch((e) => {
        if (cancelled) return;
        const code =
          e && typeof e === "object" && "code" in e ? String((e as { code: string }).code) : "";
        if (code === "UPAD_UNAUTHORIZED" || code === "UPAD_AUTH_FAILED") {
          toast.error(e);
        } else {
          setSummary(emptySummary());
          setEntries([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, toast]);

  const earnedTotal = useMemo(() => {
    if (!summary) return "0";
    return (BigInt(summary.accruedUct || "0") + BigInt(summary.paidUct || "0")).toString();
  }, [summary]);

  const amount = (value?: string) =>
    loading && !summary ? "…" : formatUct(value ?? "0");

  if (!token) {
    return (
      <section className="section earnings-page">
        <div className="shell earnings-shell">
          <m.div className="earnings-gate panel glass" variants={fadeUp} initial="hidden" animate="show">
            <h2>Earnings</h2>
            <p className="hint">Connect to see sales on your drops.</p>
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
      className="section earnings-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35 }}
    >
      <div className="shell earnings-shell">
        <m.div className="earnings-top" variants={fadeUp} initial="hidden" animate="show">
          <div className="earnings-title">
            <h2>Earnings</h2>
            <p>From mints on your drops</p>
          </div>
        </m.div>

        <m.div
          className="earnings-stats"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springSnappy}
        >
          <div className="earnings-stat earnings-stat-balance">
            <span className="earnings-stat-label">Balance</span>
            <strong className="earnings-stat-value">
              {amount(summary?.accruedUct)}
              <span> UCT</span>
            </strong>
          </div>
          <div className="earnings-stat">
            <span className="earnings-stat-label">Earned</span>
            <strong className="earnings-stat-value">
              {amount(earnedTotal)}
              <span> UCT</span>
            </strong>
            <span className="earnings-stat-meta">
              {summary?.saleCount ?? 0} sale{(summary?.saleCount ?? 0) === 1 ? "" : "s"}
            </span>
          </div>
          <div className="earnings-stat">
            <span className="earnings-stat-label">Paid out</span>
            <strong className="earnings-stat-value">
              {amount(summary?.paidUct)}
              <span> UCT</span>
            </strong>
          </div>
        </m.div>

        <m.div
          className="earnings-activity panel glass"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springSnappy, delay: 0.06 }}
        >
          <div className="earnings-panel-head">
            <h3>Sales</h3>
            <span className="muted">{entries.length}</span>
          </div>

          {!entries.length ? (
            <div className="earnings-empty">
              <p>No sales yet</p>
              <p className="muted">When someone mints your drop, it shows here.</p>
            </div>
          ) : (
            <div className="earnings-table-wrap">
              <table className="earnings-table">
                <thead>
                  <tr>
                    <th>Drop</th>
                    <th>Price</th>
                    <th>Earned</th>
                    <th>Status</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <strong>{e.collectionName}</strong>
                      </td>
                      <td className="muted">{formatUct(e.grossUct)} UCT</td>
                      <td>
                        <strong>{formatUct(e.creatorNetUct)} UCT</strong>
                      </td>
                      <td>
                        <span
                          className={`earnings-status ${
                            e.payoutStatus === "paid" ? "is-paid" : "is-accrued"
                          }`}
                        >
                          {statusLabel(e.payoutStatus)}
                        </span>
                      </td>
                      <td className="muted">
                        {new Date(e.createdAt).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </m.div>
      </div>
    </m.section>
  );
}

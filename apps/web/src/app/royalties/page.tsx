"use client";

import { useEffect, useMemo, useState } from "react";
import { m } from "framer-motion";
import {
  formatUct,
  parseUct,
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
  platformFeeBps: 250,
  grossSalesUct: "0",
  platformFeesUct: "0",
  saleCount: 0,
});

function statusLabel(status: string) {
  if (status === "paid") return "Paid out";
  if (status === "accrued") return "In balance";
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

  const feePct = summary ? summary.platformFeeBps / 100 : 2.5;
  const example = useMemo(() => {
    const bps = summary?.platformFeeBps ?? 250;
    const gross = parseUct("7");
    const fee = (BigInt(gross) * BigInt(bps)) / 10000n;
    const net = BigInt(gross) - fee;
    return {
      gross: formatUct(gross),
      fee: formatUct(fee.toString()),
      net: formatUct(net.toString()),
      youPct: 100 - bps / 100,
    };
  }, [summary?.platformFeeBps]);

  const netTotal = useMemo(() => {
    if (!summary) return "0";
    return (BigInt(summary.accruedUct || "0") + BigInt(summary.paidUct || "0")).toString();
  }, [summary]);

  if (!token) {
    return (
      <section className="section earnings-page">
        <div className="shell earnings-shell">
          <m.div className="earnings-gate earnings-glass" variants={fadeUp} initial="hidden" animate="show">
            <p className="earnings-eyebrow">Seller dashboard</p>
            <h2>Earnings</h2>
            <p className="hint">
              Connect to see mint sales, platform fees, and the balance credited to you.
            </p>
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
      transition={{ duration: 0.4 }}
    >
      <div className="shell earnings-shell">
        <m.header className="earnings-hero" variants={fadeUp} initial="hidden" animate="show">
          <div className="earnings-hero-copy">
            <p className="earnings-eyebrow">Seller dashboard</p>
            <h2>Earnings</h2>
            <p>Track mint sales and what lands in your seller balance.</p>
          </div>
          <m.div
            className="earnings-hero-balance earnings-glass"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springSnappy}
          >
            <span className="earnings-kpi-label">Available balance</span>
            <strong className="earnings-hero-value">
              {loading && !summary ? "…" : formatUct(summary?.accruedUct ?? "0")}
              <span> UCT</span>
            </strong>
            <span className="earnings-kpi-hint">
              Net after {feePct}% fee · lifetime {formatUct(netTotal)} UCT
            </span>
          </m.div>
        </m.header>

        <div className="earnings-kpis">
          <m.div
            className="earnings-kpi earnings-glass"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springSnappy}
          >
            <span className="earnings-kpi-label">Gross sales</span>
            <strong className="earnings-kpi-value">
              {loading && !summary ? "…" : `${formatUct(summary?.grossSalesUct ?? "0")} UCT`}
            </strong>
            <span className="earnings-kpi-hint">
              {summary?.saleCount ?? 0} mint{(summary?.saleCount ?? 0) === 1 ? "" : "s"}
            </span>
          </m.div>
          <m.div
            className="earnings-kpi earnings-glass"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springSnappy, delay: 0.05 }}
          >
            <span className="earnings-kpi-label">Platform fees</span>
            <strong className="earnings-kpi-value">
              {loading && !summary ? "…" : `${formatUct(summary?.platformFeesUct ?? "0")} UCT`}
            </strong>
            <span className="earnings-kpi-hint">{feePct}% of each mint</span>
          </m.div>
          <m.div
            className="earnings-kpi earnings-glass"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springSnappy, delay: 0.1 }}
          >
            <span className="earnings-kpi-label">Paid out</span>
            <strong className="earnings-kpi-value">
              {loading && !summary ? "…" : `${formatUct(summary?.paidUct ?? "0")} UCT`}
            </strong>
            <span className="earnings-kpi-hint">Sent to your wallet</span>
          </m.div>
        </div>

        <div className="earnings-body">
          <m.aside
            className="earnings-split earnings-glass"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springSnappy, delay: 0.08 }}
          >
            <div className="earnings-panel-head">
              <h3>Mint split</h3>
              <span className="earnings-chip">Example · {example.gross} UCT</span>
            </div>
            <p className="earnings-split-copy">
              Each mint takes a {feePct}% platform fee. The rest is credited to your balance.
            </p>
            <div className="earnings-meter" aria-hidden>
              <div className="earnings-meter-you" style={{ flexGrow: example.youPct }} />
              <div className="earnings-meter-fee" style={{ flexGrow: feePct }} />
            </div>
            <ul className="earnings-split-list">
              <li>
                <span className="earnings-dot you" />
                <span>You ({example.youPct}%)</span>
                <strong>{example.net} UCT</strong>
              </li>
              <li>
                <span className="earnings-dot fee" />
                <span>Platform ({feePct}%)</span>
                <strong>{example.fee} UCT</strong>
              </li>
            </ul>
          </m.aside>

          <m.div
            className="earnings-activity earnings-glass"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springSnappy, delay: 0.12 }}
          >
            <div className="earnings-panel-head">
              <h3>Sales activity</h3>
              <span className="muted">{entries.length} recent</span>
            </div>

            {!entries.length ? (
              <div className="earnings-empty">
                <p>No sales yet</p>
                <p className="muted">When someone mints your drop, it appears here.</p>
              </div>
            ) : (
              <div className="earnings-table-wrap">
                <table className="earnings-table">
                  <thead>
                    <tr>
                      <th>Drop</th>
                      <th>Sale</th>
                      <th>Fee</th>
                      <th>You get</th>
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
                        <td>{formatUct(e.grossUct)} UCT</td>
                        <td className="muted">{formatUct(e.platformFeeUct)} UCT</td>
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
      </div>
    </m.section>
  );
}

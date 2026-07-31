"use client";

import { useEffect, useMemo, useState } from "react";
import { m } from "framer-motion";
import {
  DEFAULT_TREASURY_PRINCIPAL,
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
  const treasury = DEFAULT_TREASURY_PRINCIPAL;
  const example = useMemo(() => {
    const bps = summary?.platformFeeBps ?? 250;
    const gross = parseUct("7");
    const fee = (BigInt(gross) * BigInt(bps)) / 10000n;
    const net = BigInt(gross) - fee;
    return { gross: formatUct(gross), fee: formatUct(fee.toString()), net: formatUct(net.toString()) };
  }, [summary?.platformFeeBps]);

  const netTotal = useMemo(() => {
    if (!summary) return "0";
    return (BigInt(summary.accruedUct || "0") + BigInt(summary.paidUct || "0")).toString();
  }, [summary]);

  if (!token) {
    return (
      <section className="section earnings-page">
        <div className="shell" style={{ maxWidth: 560 }}>
          <m.div className="panel glass earnings-gate" variants={fadeUp} initial="hidden" animate="show">
            <h2>Earnings</h2>
            <p className="hint">
              Track mint sales on your drops. Buyers pay the full price; {feePct}% goes to {treasury},
              and the rest credits your seller balance.
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
      <div className="shell">
        <m.div className="section-head" variants={fadeUp} initial="hidden" animate="show">
          <div>
            <h2>Earnings</h2>
            <p>Sales, fees, and your seller balance — updated when someone mints your drop.</p>
          </div>
        </m.div>

        <div className="earnings-kpis">
          <m.div
            className="earnings-kpi glass"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springSnappy}
          >
            <span className="earnings-kpi-label">Your balance</span>
            <strong className="earnings-kpi-value">
              {loading && !summary ? "…" : `${formatUct(summary?.accruedUct ?? "0")} UCT`}
            </strong>
            <span className="earnings-kpi-hint">Net after {feePct}% platform fee</span>
          </m.div>
          <m.div
            className="earnings-kpi glass"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springSnappy, delay: 0.04 }}
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
            className="earnings-kpi glass"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springSnappy, delay: 0.08 }}
          >
            <span className="earnings-kpi-label">Platform fee</span>
            <strong className="earnings-kpi-value">
              {loading && !summary ? "…" : `${formatUct(summary?.platformFeesUct ?? "0")} UCT`}
            </strong>
            <span className="earnings-kpi-hint">
              {feePct}% → {treasury}
            </span>
          </m.div>
          <m.div
            className="earnings-kpi glass"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springSnappy, delay: 0.12 }}
          >
            <span className="earnings-kpi-label">Paid out</span>
            <strong className="earnings-kpi-value">
              {loading && !summary ? "…" : `${formatUct(summary?.paidUct ?? "0")} UCT`}
            </strong>
            <span className="earnings-kpi-hint">Already sent to your wallet</span>
          </m.div>
        </div>

        <m.div
          className="earnings-split glass"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springSnappy, delay: 0.1 }}
        >
          <div>
            <h3>How each mint splits</h3>
            <p>
              On a {example.gross} UCT mint, {feePct}% ({example.fee} UCT) goes to {treasury}. You are
              credited {example.net} UCT in Earnings.
            </p>
          </div>
          <div className="earnings-split-bars" aria-hidden>
            <div className="earnings-split-seller">
              <span>You · {100 - feePct}%</span>
              <strong>{example.net} UCT</strong>
            </div>
            <div className="earnings-split-platform">
              <span>{treasury} · {feePct}%</span>
              <strong>{example.fee} UCT</strong>
            </div>
          </div>
          <p className="earnings-split-total muted">
            Lifetime net credited: {formatUct(netTotal)} UCT
          </p>
        </m.div>

        <m.div
          className="earnings-activity glass"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springSnappy, delay: 0.14 }}
        >
          <div className="earnings-activity-head">
            <h3>Sales activity</h3>
            <span className="muted">{entries.length} recent</span>
          </div>

          {!entries.length ? (
            <div className="earnings-empty">
              <p>No sales yet.</p>
              <p className="muted">When someone mints your drop, the net amount shows here.</p>
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
    </m.section>
  );
}

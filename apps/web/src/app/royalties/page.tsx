"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { m } from "framer-motion";
import {
  DEFAULT_PLATFORM_FEE_BPS,
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

/** Cap a typed display amount to the earnings balance (never wallet). */
function clampToEarningsBalance(raw: string, balanceBase: string): string {
  const cleaned = raw.trim();
  if (!cleaned) return "";
  if (!/^\d*\.?\d*$/.test(cleaned)) return raw;
  try {
    const parsed = parseUct(cleaned.endsWith(".") ? cleaned.slice(0, -1) || "0" : cleaned);
    const max = BigInt(balanceBase || "0");
    if (BigInt(parsed) > max) return formatUct(max.toString());
  } catch {
    /* keep typing mid-edit */
  }
  return raw;
}

export default function RoyaltiesPage() {
  const toast = useToast();
  const { token, connectSphere, connecting } = useWallet();
  const [summary, setSummary] = useState<RoyaltySummary | null>(null);
  const [entries, setEntries] = useState<RoyaltyEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [amountDisplay, setAmountDisplay] = useState("");
  const [paying, setPaying] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await api.royalties(token);
      setSummary({ ...emptySummary(), ...r.summary });
      setEntries(r.entries);
    } catch (e) {
      const code =
        e && typeof e === "object" && "code" in e ? String((e as { code: string }).code) : "";
      if (code === "UPAD_UNAUTHORIZED" || code === "UPAD_AUTH_FAILED") {
        toast.error(e);
      } else {
        setSummary(emptySummary());
        setEntries([]);
      }
    } finally {
      setLoading(false);
    }
  }, [token, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const balanceBase = summary?.accruedUct ?? "0";
  const balanceDisplay = formatUct(balanceBase);
  const hasBalance = BigInt(balanceBase || "0") > 0n;

  /** Lifetime sales total — Balance + Paid out; unchanged when sending a payout. */
  const earnedTotal = useMemo(() => {
    if (!summary) return "0";
    return (BigInt(summary.accruedUct || "0") + BigInt(summary.paidUct || "0")).toString();
  }, [summary]);

  const amount = (value?: string) =>
    loading && !summary ? "…" : formatUct(value ?? "0");

  function fillMax() {
    setAmountDisplay(balanceDisplay);
  }

  function onAmountChange(value: string) {
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setAmountDisplay(clampToEarningsBalance(value, balanceBase));
    }
  }

  function onAmountBlur() {
    const cleaned = amountDisplay.trim();
    if (!cleaned) return;
    try {
      const parsed = parseUct(cleaned);
      const max = BigInt(balanceBase || "0");
      const next = BigInt(parsed) > max ? max.toString() : parsed;
      setAmountDisplay(formatUct(next));
    } catch {
      setAmountDisplay("");
      toast.error("Enter a valid UCT amount from your earnings balance");
    }
  }

  async function sendPayout() {
    if (!token) return;
    if (!hasBalance) {
      toast.error("No balance to send");
      return;
    }

    const to = recipient.trim();
    if (!to) {
      toast.error("Enter a recipient @nametag");
      return;
    }

    let amountUct: string;
    try {
      amountUct = parseUct(amountDisplay.trim() || "0");
    } catch {
      toast.error("Enter a valid UCT amount");
      return;
    }
    const requested = BigInt(amountUct);
    const available = BigInt(balanceBase || "0");
    if (requested <= 0n) {
      toast.error("Amount must be greater than zero");
      return;
    }
    if (requested > available) {
      toast.error(`Max you can send is ${balanceDisplay} UCT from Balance.`);
      setAmountDisplay(balanceDisplay);
      return;
    }

    const tagged = to.startsWith("@") ? to : `@${to}`;
    const ok = await toast.confirm({
      title: "Send payout?",
      message: `Send ${formatUct(amountUct)} UCT to ${tagged} from Balance.`,
      confirmLabel: "Send",
      cancelLabel: "Cancel",
    });
    if (!ok) return;

    setPaying(true);
    try {
      // Re-check ledger before submit so wallet balance is never consulted.
      const latest = await api.royalties(token);
      const liveAvailable = BigInt(latest.summary.accruedUct || "0");
      if (requested > liveAvailable) {
        setSummary({ ...emptySummary(), ...latest.summary });
        setEntries(latest.entries);
        setAmountDisplay(formatUct(liveAvailable.toString()));
        toast.error("Earnings balance changed. Amount was capped to what’s available from sales.");
        return;
      }

      const result = await api.payoutRoyalties(token, {
        amountUct,
        recipient: to,
      });
      setSummary({ ...emptySummary(), ...result.summary });
      setEntries(result.entries);
      setAmountDisplay("");
      setRecipient("");
      toast.success(
        "Payout recorded",
        `${formatUct(result.paidUct)} UCT sent from earnings · now in Paid out.`,
      );
    } catch (e) {
      toast.error(e);
      void refresh();
    } finally {
      setPaying(false);
    }
  }

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
              <span className="earnings-count-box" aria-label={`${summary?.saleCount ?? 0} sales`}>
                {summary?.saleCount ?? 0}
              </span>{" "}
              sale{(summary?.saleCount ?? 0) === 1 ? "" : "s"}
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
          className="earnings-payout"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springSnappy, delay: 0.04 }}
        >
          <div className="earnings-payout-copy">
            <h3>Send payout</h3>
            <p>Send from Balance only. Sent amounts move to Paid out.</p>
          </div>

          <div className="earnings-payout-grid">
            <label className="earnings-field">
              <span>Recipient</span>
              <input
                type="text"
                className="input"
                placeholder="@nametag"
                autoComplete="off"
                spellCheck={false}
                value={recipient}
                disabled={paying || !hasBalance}
                onChange={(e) => setRecipient(e.target.value)}
              />
            </label>

            <label className="earnings-field">
              <span>Amount</span>
              <div className="earnings-amount-row">
                <input
                  type="text"
                  className="input"
                  inputMode="decimal"
                  placeholder={hasBalance ? balanceDisplay : "0"}
                  value={amountDisplay}
                  disabled={paying || !hasBalance}
                  onChange={(e) => onAmountChange(e.target.value)}
                  onBlur={onAmountBlur}
                />
                <button
                  type="button"
                  className="btn btn-ghost earnings-max-btn"
                  disabled={paying || !hasBalance}
                  onClick={fillMax}
                >
                  Max
                </button>
              </div>
            </label>
          </div>

          <div className="earnings-payout-actions">
            <m.button
              type="button"
              className="btn btn-signal"
              disabled={paying || !hasBalance || connecting}
              whileHover={paying || !hasBalance ? undefined : { y: -1 }}
              whileTap={paying || !hasBalance ? undefined : { scale: 0.98 }}
              transition={springSnappy}
              onClick={() => void sendPayout()}
            >
              {paying ? "Sending…" : "Send from earnings"}
            </m.button>
          </div>
        </m.div>

        <m.div
          className="earnings-activity panel glass"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springSnappy, delay: 0.08 }}
        >
          <div className="earnings-panel-head">
            <h3>Transactions</h3>
            <span className="earnings-count-box" aria-label={`${entries.length} transactions`}>
              {entries.length}
            </span>
          </div>

          {!entries.length ? (
            <div className="earnings-empty">
              <p>No transactions yet</p>
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
                        {e.payoutStatus === "paid" && e.payoutRecipient ? (
                          <div className="earnings-paid-to">to {e.payoutRecipient}</div>
                        ) : null}
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
                        {new Date(e.paidAt || e.createdAt).toLocaleString(undefined, {
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

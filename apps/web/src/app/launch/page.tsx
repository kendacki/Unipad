"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, m } from "framer-motion";
import { parseUct, type PhaseType } from "@unipad/shared";
import { api } from "@/lib/api";
import {
  SCHEDULE_HOURS,
  SCHEDULE_MINUTES,
  SCHEDULE_PRESETS,
  formatLaunchAt,
  localDateValue,
  resolveLaunchAt,
  timezoneHint,
  upcomingDateOptions,
  type LaunchMode,
  type SchedulePreset,
} from "@/lib/schedule";
import { useToast } from "@/lib/toast";
import { useWallet } from "@/lib/wallet";
import { fadeUp, springSnappy } from "@/lib/motion";

type Step = 0 | 1 | 2 | 3 | 4;

type PhaseDraft = {
  type: PhaseType;
  name: string;
  priceDisplay: string;
  maxPerWallet: number;
  enabled: boolean;
};

const MINT_LIMIT_OPTIONS = [
  { value: 1, label: "1 per wallet" },
  { value: 2, label: "2 per wallet" },
  { value: 10, label: "10 per wallet" },
] as const;

type MintLimit = (typeof MINT_LIMIT_OPTIONS)[number]["value"];

/** Stored for API compatibility; secondary market UI is deferred. */
const DEFAULT_ROYALTY_BPS = 500;

function mintLimitLabel(limit: number) {
  return MINT_LIMIT_OPTIONS.find((o) => o.value === limit)?.label ?? `${limit} per wallet`;
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function sessionToken(fallback: string | null) {
  if (fallback) return fallback;
  try {
    return (JSON.parse(localStorage.getItem("unipad.session") || "{}") as { token?: string })
      .token;
  } catch {
    return undefined;
  }
}

const STEP_HELP = [
  "Name, owner, and cover.",
  "Supply, price, and open time.",
  "Early-access wallets.",
  "Check details, then save.",
  "Publish when you’re ready.",
] as const;

export default function LaunchPage() {
  const router = useRouter();
  const toast = useToast();
  const { token, connectSphere, connecting } = useWallet();
  const [step, setStep] = useState<Step>(0);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [description, setDescription] = useState("");
  const [coverLink, setCoverLink] = useState("");
  const [coverUploadUrl, setCoverUploadUrl] = useState("");
  const [coverFileName, setCoverFileName] = useState("");
  const [totalSupply, setTotalSupply] = useState(100);
  const [mintLimit, setMintLimit] = useState<MintLimit>(2);
  const [phases, setPhases] = useState<PhaseDraft[]>([
    { type: "allowlist", name: "Allowlist", priceDisplay: "2", maxPerWallet: 2, enabled: false },
    { type: "public", name: "Public", priceDisplay: "1", maxPerWallet: 2, enabled: true },
  ]);
  const [allowlistText, setAllowlistText] = useState("");
  const [launchMode, setLaunchMode] = useState<LaunchMode>("now");
  const [schedulePreset, setSchedulePreset] = useState<SchedulePreset>("tomorrow_10");
  const [customDate, setCustomDate] = useState(() => localDateValue(new Date(Date.now() + 86400000)));
  const [customHour, setCustomHour] = useState(10);
  const [customMinute, setCustomMinute] = useState(0);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const steps = ["Basics", "Price", "Guest list", "Check", "Publish"];
  const dateOptions = useMemo(() => upcomingDateOptions(), []);
  const tz = useMemo(() => timezoneHint(), []);
  const activePhases = useMemo(() => phases.filter((p) => p.enabled), [phases]);
  const hasAllowlist = activePhases.some((p) => p.type === "allowlist");

  function applyMintLimit(limit: MintLimit) {
    setMintLimit(limit);
    setPhases((prev) => prev.map((p) => ({ ...p, maxPerWallet: limit })));
  }

  const previewLaunchAt = useMemo(() => {
    if (launchMode === "now") return null;
    try {
      return resolveLaunchAt({
        mode: launchMode,
        preset: schedulePreset,
        customDate,
        customHour,
        customMinute,
      });
    } catch {
      return null;
    }
  }, [launchMode, schedulePreset, customDate, customHour, customMinute]);

  const resolvedCoverUrl = coverLink.trim() || coverUploadUrl;

  async function onCoverFile(file: File | null) {
    if (!file) return;
    setUploading(true);
    try {
      const t = sessionToken(token) ?? "blob";
      const saved = await api.uploadMedia(t, file);
      setCoverUploadUrl(saved.url);
      setCoverFileName(file.name);
      setCoverLink("");
      toast.success("Image uploaded");
    } catch (e) {
      toast.error(e);
    } finally {
      setUploading(false);
    }
  }

  async function createDraft() {
    const t = sessionToken(token);
    if (!t) {
      toast.error(new Error("Connect your wallet to list a drop."));
      return;
    }
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      toast.error(new Error("Give your drop a name (at least 2 characters)."));
      return;
    }
    const trimmedOwner = ownerName.trim();
    if (trimmedOwner.length < 2) {
      toast.error(new Error("Enter the owner’s name (at least 2 characters)."));
      return;
    }
    const finalSlug = (slug || slugify(trimmedName)).trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(finalSlug)) {
      toast.error(new Error("Drop name must produce a valid link (letters and numbers)."));
      return;
    }
    if (!Number.isInteger(totalSupply) || totalSupply < 1 || totalSupply > 100_000) {
      toast.error(new Error("Supply must be between 1 and 100,000."));
      return;
    }
    if (!activePhases.length) {
      toast.error(new Error("Enable at least one mint phase."));
      return;
    }
    if (activePhases.some((p) => Number(p.priceDisplay) < 1)) {
      toast.error(new Error("Minimum mint price is 1 UCT."));
      return;
    }
    if (hasAllowlist && !allowlistText.trim()) {
      toast.error(new Error("Add at least one wallet or @nametag to the guest list."));
      return;
    }

    let launchAt: string | null = null;
    try {
      launchAt = resolveLaunchAt({
        mode: launchMode,
        preset: schedulePreset,
        customDate,
        customHour,
        customMinute,
      });
    } catch (e) {
      toast.error(e);
      return;
    }

    const phaseStart = launchAt ?? new Date().toISOString();
    let parsedPhases;
    try {
      parsedPhases = activePhases.map((p) => ({
        type: p.type,
        name: p.name,
        priceUct: parseUct(p.priceDisplay),
        maxPerWallet: p.maxPerWallet,
        startsAt: phaseStart,
      }));
    } catch {
      toast.error(new Error("Enter valid UCT prices for enabled phases."));
      return;
    }

    setSubmitting(true);
    try {
      const created = await api.createCollection(t, {
        name: trimmedName,
        slug: finalSlug,
        description: description.trim(),
        totalSupply,
        royaltyBps: DEFAULT_ROYALTY_BPS,
        coverUrl: resolvedCoverUrl || undefined,
        creatorDisplayName: trimmedOwner,
        launchAt,
        phases: parsedPhases,
      });
      setCreatedId(created.id);
      setCreatedSlug(created.slug);
      const alPhase = created.phases.find((p) => p.type === "allowlist");

      if (alPhase && allowlistText.trim()) {
        const entries = allowlistText
          .split(/[\n,]+/)
          .map((w) => w.trim())
          .filter(Boolean)
          .map((walletPrincipal) => ({ walletPrincipal, maxMints: alPhase.maxPerWallet }));
        if (entries.length) {
          await api.upsertAllowlist(t, created.id, alPhase.id, entries);
        }
      }

      toast.success("Drop saved", "Review once more, then publish when you’re ready.");
      setStep(4);
    } catch (e) {
      toast.error(e);
    } finally {
      setSubmitting(false);
    }
  }

  async function publish() {
    if (!createdId) return;
    const t = sessionToken(token);
    if (!t) return;
    const scheduled = Boolean(previewLaunchAt);
    const ok = await toast.confirm({
      title: scheduled ? "Schedule this drop?" : "Publish this drop?",
      message: scheduled
        ? `Minting opens ${formatLaunchAt(previewLaunchAt!)}. It will show as Upcoming until then.`
        : "People will be able to mint as soon as you publish.",
      confirmLabel: scheduled ? "Schedule" : "Publish now",
      cancelLabel: "Not yet",
    });
    if (!ok) return;

    setSubmitting(true);
    try {
      const published = await api.publishCollection(t, createdId);
      if (published.status === "scheduled") {
        toast.success("Scheduled", `Minting opens ${formatLaunchAt(published.launchAt || previewLaunchAt!)}.`);
      } else {
        toast.success("It’s live!", "Your drop is open for minting.");
      }
      router.push(`/drops/${createdSlug}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setSubmitting(false);
    }
  }

  const actions = (
    back: () => void,
    nextLabel: string,
    next: () => void,
    nextDisabled?: boolean,
  ) => (
    <div className="launch-actions">
      <button type="button" className="btn btn-ghost" onClick={back}>
        Back
      </button>
      <button type="button" className="btn btn-signal" disabled={nextDisabled} onClick={next}>
        {nextLabel}
      </button>
    </div>
  );

  return (
    <m.section
      className="section launch-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="shell launch-shell">
        <m.div className="launch-head" variants={fadeUp} initial="hidden" animate="show">
          <h2>Create a drop</h2>
          <p>Name it, set a UCT price, then publish.</p>
        </m.div>

        <div className="wizard-steps">
          {steps.map((label, i) => (
            <m.span
              key={label}
              className={step === i ? "active" : step > i ? "done" : ""}
              layout
              transition={springSnappy}
              animate={{ scale: step === i ? 1.03 : 1, opacity: step === i ? 1 : 0.65 }}
            >
              {i + 1}. {label}
            </m.span>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <m.p
            key={`help-${step}`}
            className="step-help"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25 }}
          >
            {STEP_HELP[step]}
          </m.p>
        </AnimatePresence>

        {!token ? (
          <m.div
            className="launch-card"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <p className="hint" style={{ margin: 0 }}>
              Connect your wallet to create a drop.
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
        ) : null}

        <AnimatePresence mode="wait">
          {step === 0 ? (
            <m.div
              key="step-0"
              className="launch-card"
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="launch-row-2">
                <label>
                  Drop name
                  <input
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (!slug || slug === slugify(name)) setSlug(slugify(e.target.value));
                    }}
                    placeholder="My first drop"
                  />
                </label>
                <label>
                  Owner&apos;s name
                  <input
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="Your name or studio"
                  />
                </label>
              </div>
              <label>
                Description
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this drop about?"
                />
              </label>
              <div className="launch-cover">
                <label>
                  Cover link
                  <input
                    value={coverLink}
                    onChange={(e) => {
                      setCoverLink(e.target.value);
                      if (e.target.value.trim()) {
                        setCoverUploadUrl("");
                        setCoverFileName("");
                      }
                    }}
                    placeholder="https://…"
                  />
                </label>
                <label>
                  Or upload
                  <div className="cover-upload-row">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={(e) => onCoverFile(e.target.files?.[0] ?? null)}
                    />
                    <span className="cover-upload-name muted">
                      {uploading ? "Uploading…" : coverFileName || ""}
                    </span>
                  </div>
                </label>
              </div>
              <div className="launch-actions">
                <button
                  type="button"
                  className="btn btn-signal"
                  disabled={!name.trim() || !ownerName.trim()}
                  onClick={() => setStep(1)}
                >
                  Next
                </button>
              </div>
            </m.div>
          ) : null}

          {step === 1 ? (
            <m.div
              key="step-1"
              className="launch-card"
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="launch-row-2">
                <label>
                  Supply
                  <input
                    type="number"
                    min={1}
                    max={100000}
                    value={totalSupply}
                    onChange={(e) => setTotalSupply(Number(e.target.value))}
                  />
                </label>
                <label>
                  Mints per wallet
                  <select
                    value={mintLimit}
                    onChange={(e) => applyMintLimit(Number(e.target.value) as MintLimit)}
                  >
                    {MINT_LIMIT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="launch-block">
                <label>
                  Mint opens
                  <select
                    value={launchMode}
                    onChange={(e) => setLaunchMode(e.target.value as LaunchMode)}
                  >
                    <option value="now">On publish</option>
                    <option value="schedule">Schedule</option>
                  </select>
                </label>

                {launchMode === "schedule" ? (
                  <>
                    <label>
                      Start time
                      <select
                        value={schedulePreset}
                        onChange={(e) => setSchedulePreset(e.target.value as SchedulePreset)}
                      >
                        {SCHEDULE_PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    {schedulePreset === "custom" ? (
                      <div className="schedule-custom">
                        <label>
                          Date
                          <select value={customDate} onChange={(e) => setCustomDate(e.target.value)}>
                            {dateOptions.map((d) => (
                              <option key={d.value} value={d.value}>
                                {d.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Hour
                          <select
                            value={customHour}
                            onChange={(e) => setCustomHour(Number(e.target.value))}
                          >
                            {SCHEDULE_HOURS.map((h) => (
                              <option key={h.value} value={h.value}>
                                {h.label.slice(0, 2)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Minute
                          <select
                            value={customMinute}
                            onChange={(e) => setCustomMinute(Number(e.target.value))}
                          >
                            {SCHEDULE_MINUTES.map((m) => (
                              <option key={m.value} value={m.value}>
                                {m.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ) : null}

                    {previewLaunchAt ? (
                      <p className="schedule-preview">
                        Opens <strong>{formatLaunchAt(previewLaunchAt)}</strong>
                        <span className="muted"> · {tz}</span>
                      </p>
                    ) : (
                      <p className="hint" style={{ margin: 0 }}>
                        Pick a time at least 1 minute from now.
                      </p>
                    )}
                  </>
                ) : null}
              </div>

              <div className="launch-phases">
                {phases.map((p, idx) => (
                  <div key={p.type} className={`launch-phase ${p.enabled ? "is-on" : ""}`}>
                    <label className="launch-phase-toggle">
                      <input
                        type="checkbox"
                        checked={p.enabled}
                        onChange={(e) => {
                          const next = [...phases];
                          next[idx] = { ...p, enabled: e.target.checked };
                          setPhases(next);
                        }}
                      />
                      <span>{p.name}</span>
                    </label>
                    {p.enabled ? (
                      <label className="launch-phase-price">
                        Price (UCT)
                        <input
                          type="number"
                          min={1}
                          step="any"
                          value={p.priceDisplay}
                          onChange={(e) => {
                            const next = [...phases];
                            next[idx] = { ...p, priceDisplay: e.target.value };
                            setPhases(next);
                          }}
                        />
                      </label>
                    ) : null}
                  </div>
                ))}
              </div>

              {actions(
                () => setStep(0),
                hasAllowlist ? "Guest list" : "Review",
                () => {
                  if (launchMode === "schedule" && !previewLaunchAt) {
                    toast.error(new Error("Pick a valid schedule time."));
                    return;
                  }
                  setStep(hasAllowlist ? 2 : 3);
                },
                !activePhases.length || (launchMode === "schedule" && !previewLaunchAt),
              )}
            </m.div>
          ) : null}

          {step === 2 ? (
            <m.div
              key="step-2"
              className="launch-card"
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              <label>
                Early-access wallets
                <textarea
                  rows={7}
                  value={allowlistText}
                  onChange={(e) => setAllowlistText(e.target.value)}
                  placeholder={"@collector\n02ab…"}
                />
              </label>
              <p className="hint" style={{ margin: 0 }}>
                One @nametag or wallet per line.
              </p>
              {actions(
                () => setStep(1),
                "Review",
                () => setStep(3),
              )}
            </m.div>
          ) : null}

          {step === 3 ? (
            <m.div
              key="step-3"
              className="launch-card"
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="launch-review">
                <h3>{name}</h3>
                <p className="muted">
                  {ownerName} · {totalSupply} supply · {mintLimitLabel(mintLimit)}
                </p>
                <ul>
                  {activePhases.map((p) => (
                    <li key={p.type}>
                      {p.name}: <strong>{p.priceDisplay} UCT</strong>
                    </li>
                  ))}
                </ul>
                {allowlistText.trim() ? (
                  <p className="muted">
                    Guest list: {allowlistText.split(/[\n,]+/).filter((w) => w.trim()).length}
                  </p>
                ) : null}
                <p className="schedule-preview">
                  {previewLaunchAt
                    ? `Opens ${formatLaunchAt(previewLaunchAt)}`
                    : "Opens on publish"}
                </p>
                {description ? <p className="launch-review-desc">{description}</p> : null}
              </div>
              {actions(
                () => setStep(hasAllowlist ? 2 : 1),
                submitting ? "Saving…" : "Save drop",
                createDraft,
                submitting || !token,
              )}
            </m.div>
          ) : null}

          {step === 4 ? (
            <m.div
              key="step-4"
              className="launch-card"
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="launch-review">
                <h3>{previewLaunchAt ? "Ready to schedule?" : "Ready to publish?"}</h3>
                <p className="muted">
                  {previewLaunchAt
                    ? `Lists as Upcoming until ${formatLaunchAt(previewLaunchAt)}.`
                    : "Minting opens as soon as you publish."}
                </p>
              </div>
              <div className="launch-actions">
                <button
                  type="button"
                  className="btn btn-signal"
                  disabled={submitting}
                  onClick={publish}
                >
                  {submitting
                    ? previewLaunchAt
                      ? "Scheduling…"
                      : "Publishing…"
                    : previewLaunchAt
                      ? "Schedule"
                      : "Publish"}
                </button>
                {createdSlug ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => router.push(`/drops/${createdSlug}`)}
                  >
                    Preview draft
                  </button>
                ) : null}
              </div>
            </m.div>
          ) : null}
        </AnimatePresence>
      </div>
    </m.section>
  );
}

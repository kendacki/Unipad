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

/** How many NFTs each wallet may mint from this drop */
const MINT_LIMIT_OPTIONS = [
  { value: 1, label: "One NFT", hint: "Each wallet can mint 1" },
  { value: 2, label: "Two NFTs", hint: "Each wallet can mint up to 2" },
  { value: 10, label: "Multiple NFTs", hint: "Each wallet can mint up to 10" },
] as const;

type MintLimit = (typeof MINT_LIMIT_OPTIONS)[number]["value"];

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
  const [royaltyBps, setRoyaltyBps] = useState(500);
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
  const [allowlistPhaseId, setAllowlistPhaseId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const steps = ["Basics", "Price", "Guest list", "Check", "Publish"];
  const dateOptions = useMemo(() => upcomingDateOptions(), []);
  const tz = useMemo(() => timezoneHint(), []);

  const activePhases = useMemo(() => phases.filter((p) => p.enabled), [phases]);

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
      // Covers go to Vercel Blob (same-origin /v1/media/upload). Wallet optional for upload.
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
    if (!Number.isInteger(royaltyBps) || royaltyBps < 0 || royaltyBps > 2000) {
      toast.error(new Error("Royalty must be between 0% and 20%."));
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
    const allowlistOn = activePhases.some((p) => p.type === "allowlist");
    if (allowlistOn && !allowlistText.trim()) {
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
        royaltyBps,
        coverUrl: resolvedCoverUrl || undefined,
        creatorDisplayName: trimmedOwner,
        launchAt,
        phases: parsedPhases,
      });
      setCreatedId(created.id);
      setCreatedSlug(created.slug);
      const alPhase = created.phases.find((p) => p.type === "allowlist");
      setAllowlistPhaseId(alPhase?.id ?? null);

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

  return (
    <m.section
      className="section"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="shell" style={{ maxWidth: 720 }}>
        <m.div className="section-head" variants={fadeUp} initial="hidden" animate="show">
          <div>
            <h2>Create a drop</h2>
            <p>Name it, set a UCT price, then publish.</p>
          </div>
        </m.div>

        <div className="wizard-steps">
          {steps.map((label, i) => (
            <m.span
              key={label}
              className={step === i ? "active" : step > i ? "done" : ""}
              layout
              transition={springSnappy}
              animate={{ scale: step === i ? 1.04 : 1, opacity: step === i ? 1 : 0.72 }}
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
          {step === 0 && "Start with the basics — name and cover."}
          {step === 1 && "Set price, supply, and when minting should open."}
          {step === 2 && "Optional: paste wallets that can mint early."}
          {step === 3 && "Looks good? Save your drop."}
          {step === 4 &&
            (previewLaunchAt
              ? "Confirm to list it as Upcoming until mint opens."
              : "Publish when you want minting to open.")}
          </m.p>
        </AnimatePresence>
        {!token ? (
          <m.div
            className="panel glass"
            style={{ marginBottom: "1rem" }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <p className="hint" style={{ marginTop: 0 }}>
              Connect your wallet to create a drop.
            </p>
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
        ) : null}

        <AnimatePresence mode="wait">
          {step === 0 ? (
          <m.div
            key="step-0"
            className="panel glass form-grid"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
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
            <label>
              Short description
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this drop about?"
              />
            </label>
            <label>
              Cover image link
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
              Or upload a cover
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
            <button
              type="button"
              className="btn btn-signal"
              disabled={!name.trim() || !ownerName.trim()}
              onClick={() => setStep(1)}
            >
              Next: price
            </button>
          </m.div>
        ) : null}

        {step === 1 ? (
          <m.div
            key="step-1"
            className="panel glass form-grid"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <label>
              How many NFTs
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
                    {opt.label} — {opt.hint}
                  </option>
                ))}
              </select>
              <span className="hint">
                Caps how many NFTs one Sphere wallet can mint from this drop.
              </span>
            </label>
            <label>
              Your royalty (basis points)
              <input
                type="number"
                min={0}
                max={2000}
                value={royaltyBps}
                onChange={(e) => setRoyaltyBps(Number(e.target.value))}
              />
              <span className="muted">{(royaltyBps / 100).toFixed(2)}% of secondary (stored)</span>
            </label>

            <div className="schedule-block">
              <label>
                When should minting open?
                <select
                  value={launchMode}
                  onChange={(e) => setLaunchMode(e.target.value as LaunchMode)}
                >
                  <option value="now">As soon as I publish</option>
                  <option value="schedule">Schedule for later</option>
                </select>
                <span className="hint">
                  Scheduled drops show as Upcoming on Unipad until the start time ({tz}).
                </span>
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
                      Mint opens <strong>{formatLaunchAt(previewLaunchAt)}</strong>
                    </p>
                  ) : (
                    <p className="hint" style={{ margin: 0 }}>
                      Pick a time at least 1 minute from now.
                    </p>
                  )}
                </>
              ) : null}
            </div>

            {phases.map((p, idx) => (
              <div
                key={p.type}
                style={{
                  borderTop: "1px solid var(--line)",
                  paddingTop: "0.85rem",
                  display: "grid",
                  gap: "0.65rem",
                }}
              >
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    onChange={(e) => {
                      const next = [...phases];
                      next[idx] = { ...p, enabled: e.target.checked };
                      setPhases(next);
                    }}
                  />
                  {p.name} phase ({p.type})
                </label>
                {p.enabled ? (
                  <>
                    <label>
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
                    <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
                      Mint limit: {mintLimitLabel(mintLimit)}
                    </p>
                  </>
                ) : null}
              </div>
            ))}

            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="button" className="btn btn-ghost" onClick={() => setStep(0)}>
                Back
              </button>
              <button
                type="button"
                className="btn btn-signal"
                disabled={
                  !activePhases.length || (launchMode === "schedule" && !previewLaunchAt)
                }
                onClick={() => {
                  if (launchMode === "schedule" && !previewLaunchAt) {
                    toast.error(new Error("Pick a valid schedule time."));
                    return;
                  }
                  setStep(activePhases.some((p) => p.type === "allowlist") ? 2 : 3);
                }}
              >
                {activePhases.some((p) => p.type === "allowlist") ? "Allowlist" : "Review"}
              </button>
            </div>
          </m.div>
        ) : null}

        {step === 2 ? (
          <m.div
            key="step-2"
            className="panel glass form-grid"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="muted" style={{ margin: 0 }}>
              Paste wallet principals (one per line) for the allowlist phase. You can also add them
              after create via the API.
            </p>
            <label>
              Early-access wallets
              <textarea
                rows={8}
                value={allowlistText}
                onChange={(e) => setAllowlistText(e.target.value)}
                placeholder={"02ab…\n@collector"}
              />
            </label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>
                Back
              </button>
              <button type="button" className="btn btn-signal" onClick={() => setStep(3)}>
                Review
              </button>
            </div>
          </m.div>
        ) : null}

        {step === 3 ? (
          <m.div
            key="step-3"
            className="panel glass form-grid"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <h3 className="display" style={{ fontSize: "1.5rem" }}>
              {name}
            </h3>
            <p className="muted" style={{ margin: 0 }}>
              /{slug} · {totalSupply} supply · {(royaltyBps / 100).toFixed(2)}% royalty ·{" "}
              {mintLimitLabel(mintLimit).toLowerCase()} per wallet
            </p>
            <ul className="muted" style={{ margin: 0, paddingLeft: "1.1rem" }}>
              {activePhases.map((p) => (
                <li key={p.type}>
                  {p.name}: {p.priceDisplay} UCT · max {p.maxPerWallet}/wallet
                </li>
              ))}
            </ul>
            {allowlistText.trim() ? (
              <p className="muted" style={{ margin: 0 }}>
                Early-access wallets: {allowlistText.split(/[\n,]+/).filter((w) => w.trim()).length}
              </p>
            ) : null}
            <p className="schedule-preview" style={{ margin: 0 }}>
              {previewLaunchAt
                ? `Scheduled · mint opens ${formatLaunchAt(previewLaunchAt)}`
                : "Opens as soon as you publish"}
            </p>
            <p style={{ margin: 0, lineHeight: 1.55 }}>{description || "No description"}</p>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setStep(activePhases.some((p) => p.type === "allowlist") ? 2 : 1)}
              >
                Back
              </button>
              <button
                type="button"
                className="btn btn-signal"
                disabled={submitting || !token}
                onClick={createDraft}
              >
                {submitting ? "Creating…" : "Save drop"}
              </button>
            </div>
          </m.div>
        ) : null}

        {step === 4 ? (
          <m.div
            key="step-4"
            className="panel glass form-grid"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <h3 className="display" style={{ fontSize: "1.5rem" }}>
              {previewLaunchAt ? "Ready to schedule?" : "Ready to publish?"}
            </h3>
            <p className="muted" style={{ margin: 0 }}>
              {previewLaunchAt
                ? `This drop will list as Upcoming until ${formatLaunchAt(previewLaunchAt)}, then minting opens automatically.`
                : "Publishing opens active phases. Mint payments settle in UCT to the treasury; creators accrue net proceeds after the platform fee."}
              {allowlistPhaseId ? " Allowlist entries are saved." : ""}
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
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
                    ? "Schedule drop"
                    : "Publish"}
              </button>
              {createdSlug ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => router.push(`/drops/${createdSlug}`)}
                >
                  Preview
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

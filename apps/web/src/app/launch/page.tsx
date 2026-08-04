"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, m } from "framer-motion";
import { normalizeSphereRecipient, parseUct, type PhaseType } from "@unipad/shared";
import { api } from "@/lib/api";
import {
  clearLaunchCheckpoint,
  loadLaunchCheckpoint,
  saveLaunchCheckpoint,
  stashPublishedDrop,
  type LaunchCheckpoint,
} from "@/lib/launchCheckpoint";
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
import { prepareSpherePaymentWindow } from "@/lib/sphereConnect";
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
  "Confirm everything looks right, then save.",
  "Publish when you’re ready.",
] as const;

export default function LaunchPage() {
  const router = useRouter();
  const toast = useToast();
  const { token, connectSphere, connecting, sessionHydrated, ensureSphereForPayment, confirmPublishDrop } =
    useWallet();
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("fresh") === "1") {
      clearLaunchCheckpoint();
      router.replace("/launch", { scroll: false });
      return;
    }
    const checkpoint = loadLaunchCheckpoint();
    if (!checkpoint?.createdId || !checkpoint.createdSlug) return;
    setStep(4);
    setCreatedId(checkpoint.createdId);
    setCreatedSlug(checkpoint.createdSlug);
    setName(checkpoint.name);
    setSlug(checkpoint.slug);
    setOwnerName(checkpoint.ownerName);
    setDescription(checkpoint.description);
    setTotalSupply(checkpoint.totalSupply);
    setMintLimit(
      (MINT_LIMIT_OPTIONS.find((o) => o.value === checkpoint.mintLimit)?.value ?? 2) as MintLimit,
    );
    setPhases(checkpoint.phases as PhaseDraft[]);
    setAllowlistText(checkpoint.allowlistText);
    setLaunchMode((checkpoint.launchMode as LaunchMode) || "now");
    setSchedulePreset((checkpoint.schedulePreset as SchedulePreset) || "tomorrow_10");
    setCustomDate(checkpoint.customDate);
    setCustomHour(checkpoint.customHour);
    setCustomMinute(checkpoint.customMinute);
  }, [router]);

  function checkpointPayload(id: string, dropSlug: string): LaunchCheckpoint {
    return {
      step: 4,
      createdId: id,
      createdSlug: dropSlug,
      name,
      slug: dropSlug,
      ownerName,
      description,
      totalSupply,
      mintLimit,
      phases,
      allowlistText,
      launchMode,
      schedulePreset,
      customDate,
      customHour,
      customMinute,
    };
  }

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
      saveLaunchCheckpoint(checkpointPayload(created.id, created.slug));
      const alPhase = created.phases.find((p) => p.type === "allowlist");

      if (hasAllowlist) {
        if (!alPhase) {
          throw new Error("Allowlist phase missing — enable Allowlist and try again.");
        }
        const entries = allowlistText
          .split(/[\n,]+/)
          .map((w) => w.trim())
          .filter(Boolean)
          .map((raw) => {
            try {
              return {
                walletPrincipal: normalizeSphereRecipient(raw),
                maxMints: alPhase.maxPerWallet,
              };
            } catch {
              return { walletPrincipal: raw.toLowerCase(), maxMints: alPhase.maxPerWallet };
            }
          })
          .filter((e) => Boolean(e.walletPrincipal));

        if (!entries.length) {
          throw new Error("Add at least one valid @nametag or wallet to the guest list.");
        }

        const saved = await api.upsertAllowlist(t, created.id, alPhase.id, entries);
        if (!saved.entries?.length) {
          throw new Error("Guest list did not save. Check each @nametag and try again.");
        }
      }

      toast.success("Drop saved", "Preview if you want, then publish when you’re ready.");
      setStep(4);
    } catch (e) {
      toast.error(e);
    } finally {
      setSubmitting(false);
    }
  }

  async function publish() {
    if (!createdId) return;
    const scheduled = Boolean(previewLaunchAt);
    const dropSlug = createdSlug || slug;

    let sessionJwt: string | null = null;
    try {
      sessionJwt = await toast.confirmAndRun({
        title: scheduled ? "Schedule this drop?" : "Publish this drop?",
        message: scheduled
          ? `Minting opens ${formatLaunchAt(previewLaunchAt!)}. Confirm in Sphere to schedule — keep the wallet window open.`
          : "People will be able to mint as soon as you publish. Confirm in Sphere — keep the wallet window open.",
        confirmLabel: "Confirm in Sphere",
        cancelLabel: "Not yet",
        run: () => {
          try {
            prepareSpherePaymentWindow();
          } catch {
            /* ensureSphereForPayment will surface a clear error */
          }
          toast.info(
            "Confirm in Sphere",
            "Approve publishing this drop in the Sphere wallet window (or extension).",
          );
          return (async () => {
            const jwt = await ensureSphereForPayment();
            await confirmPublishDrop({
              collectionName: name,
              collectionId: createdId,
              slug: dropSlug,
              scheduled,
              launchAt: previewLaunchAt,
            });
            return jwt;
          })();
        },
      });
    } catch (e) {
      toast.error(e);
      return;
    }
    if (!sessionJwt) return;

    setSubmitting(true);
    try {
      const published = await api.publishCollection(sessionJwt, createdId);
      clearLaunchCheckpoint();
      stashPublishedDrop(published);
      const nextSlug = published.slug || dropSlug;
      const bust = Date.now();
      if (published.status === "scheduled") {
        toast.success("Scheduled", `Minting opens ${formatLaunchAt(published.launchAt || previewLaunchAt!)}.`);
        router.push(
          `/drops?view=upcoming&highlight=${encodeURIComponent(nextSlug || "")}&_=${bust}`,
        );
      } else {
        toast.success("It’s live!", "Your drop is open for minting.");
        router.push(
          `/drops?view=live&highlight=${encodeURIComponent(nextSlug || "")}&_=${bust}`,
        );
      }
      router.refresh();
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

        {sessionHydrated && !token ? (
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
                          const enabled = e.target.checked;
                          setPhases((prev) => {
                            const next = prev.map((row, i) =>
                              i === idx ? { ...row, enabled } : row,
                            );
                            // Allowlist minting is exclusive while that phase is open —
                            // keep Public available for later windows, but warn via copy.
                            return next;
                          });
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
              {hasAllowlist ? (
                <p className="hint" style={{ margin: 0 }}>
                  Allowlist is on — only guest-list @nametags/wallets can mint while that phase is
                  live (Public does not bypass it).
                </p>
              ) : null}

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
                One @nametag or wallet per line. Only these users can mint while Allowlist is live.
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
              <div className="launch-check">
                <header className="launch-check-hero">
                  {resolvedCoverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- remote cover URL from creator
                    <img
                      className="launch-check-cover"
                      src={resolvedCoverUrl}
                      alt=""
                    />
                  ) : (
                    <div className="launch-check-cover launch-check-cover-empty" aria-hidden>
                      <span>No cover</span>
                    </div>
                  )}
                  <div className="launch-check-hero-copy">
                    <p className="launch-check-eyebrow">Final check</p>
                    <h3 className="launch-check-title">{name || "Untitled drop"}</h3>
                    {slug ? <p className="launch-check-slug">/{slug}</p> : null}
                  </div>
                </header>

                <dl className="launch-check-grid">
                  <div className="launch-check-row">
                    <dt>Owner</dt>
                    <dd>{ownerName || "—"}</dd>
                  </div>
                  <div className="launch-check-row">
                    <dt>Supply</dt>
                    <dd>{totalSupply.toLocaleString()} items</dd>
                  </div>
                  <div className="launch-check-row">
                    <dt>Mint limit</dt>
                    <dd>{mintLimitLabel(mintLimit)}</dd>
                  </div>
                  <div className="launch-check-row">
                    <dt>Opens</dt>
                    <dd>
                      {previewLaunchAt
                        ? formatLaunchAt(previewLaunchAt)
                        : "On publish"}
                    </dd>
                  </div>
                  {hasAllowlist ? (
                    <div className="launch-check-row">
                      <dt>Guest list</dt>
                      <dd>
                        {allowlistText
                          .split(/[\n,]+/)
                          .filter((w) => w.trim()).length || 0}{" "}
                        wallets
                      </dd>
                    </div>
                  ) : null}
                </dl>

                <section className="launch-check-phases" aria-label="Mint phases">
                  <h4 className="launch-check-section-label">Mint phases</h4>
                  <ul className="launch-check-phase-list">
                    {activePhases.map((p) => (
                      <li key={p.type} className="launch-check-phase">
                        <span className="launch-check-phase-name">{p.name}</span>
                        <span className="launch-check-phase-price">
                          {p.priceDisplay}
                          <span className="launch-check-phase-unit"> UCT</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>

                {description ? (
                  <section className="launch-check-about" aria-label="Description">
                    <h4 className="launch-check-section-label">About</h4>
                    <p className="launch-check-desc">{description}</p>
                  </section>
                ) : null}
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
                {createdSlug ? (
                  <p className="hint" style={{ margin: 0 }}>
                    Preview opens in a new tab — this page stays here so you can publish when ready.
                  </p>
                ) : null}
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
                    onClick={() => {
                      if (createdId && createdSlug) {
                        saveLaunchCheckpoint(checkpointPayload(createdId, createdSlug));
                      }
                      window.open(
                        `/drops/${createdSlug}?from=launch`,
                        "_blank",
                        "noopener,noreferrer",
                      );
                    }}
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

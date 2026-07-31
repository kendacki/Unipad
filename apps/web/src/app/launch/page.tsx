"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { parseUct, type PhaseType } from "@unipad/shared";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { useWallet } from "@/lib/wallet";

type Step = 0 | 1 | 2 | 3 | 4;

type PhaseDraft = {
  type: PhaseType;
  name: string;
  priceDisplay: string;
  maxPerWallet: number;
  enabled: boolean;
};

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
  const [description, setDescription] = useState("");
  const [coverUrl, setCoverUrl] = useState(
    "https://images.unsplash.com/photo-1699524826369-57870e627c43?auto=format&fit=crop&w=1600&q=80",
  );
  const [totalSupply, setTotalSupply] = useState(100);
  const [royaltyBps, setRoyaltyBps] = useState(500);
  const [phases, setPhases] = useState<PhaseDraft[]>([
    { type: "allowlist", name: "Allowlist", priceDisplay: "20", maxPerWallet: 2, enabled: false },
    { type: "public", name: "Public", priceDisplay: "25", maxPerWallet: 3, enabled: true },
  ]);
  const [allowlistText, setAllowlistText] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);
  const [allowlistPhaseId, setAllowlistPhaseId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const steps = ["Basics", "Price", "Guest list", "Check", "Publish"];

  const activePhases = useMemo(() => phases.filter((p) => p.enabled), [phases]);

  async function onCoverFile(file: File | null) {
    if (!file) return;
    const t = sessionToken(token);
    if (!t) {
      toast.error(new Error("Connect"));
      return;
    }
    setUploading(true);
    try {
      const saved = await api.uploadMedia(t, file);
      setCoverUrl(saved.url);
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
      toast.error(new Error("Connect"));
      return;
    }
    if (!activePhases.length) {
      toast.error(new Error("Enable at least one mint phase."));
      return;
    }

    let parsedPhases;
    try {
      parsedPhases = activePhases.map((p) => ({
        type: p.type,
        name: p.name,
        priceUct: parseUct(p.priceDisplay),
        maxPerWallet: p.maxPerWallet,
        startsAt: new Date().toISOString(),
      }));
    } catch {
      toast.error(new Error("Enter valid UCT prices for enabled phases."));
      return;
    }

    setSubmitting(true);
    try {
      const finalSlug = slug || slugify(name);
      const created = await api.createCollection(t, {
        name,
        slug: finalSlug,
        description,
        totalSupply,
        royaltyBps,
        coverUrl: coverUrl || undefined,
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
    const ok = await toast.confirm({
      title: "Publish this drop?",
      message: "People will be able to mint as soon as you publish.",
      confirmLabel: "Publish now",
      cancelLabel: "Not yet",
    });
    if (!ok) return;

    setSubmitting(true);
    try {
      await api.publishCollection(t, createdId);
      toast.success("It’s live!", "Your drop is open for minting.");
      router.push(`/drops/${createdSlug}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="section">
      <div className="shell" style={{ maxWidth: 720 }}>
        <div className="section-head">
          <div>
            <h2>Create a drop</h2>
            <p>Name it, set a UCT price, then publish. Buyers pay first — then they get their NFT.</p>
          </div>
        </div>

        <div className="wizard-steps">
          {steps.map((label, i) => (
            <span key={label} className={step === i ? "active" : step > i ? "done" : ""}>
              {i + 1}. {label}
            </span>
          ))}
        </div>

        <p className="step-help">
          {step === 0 && "Start with the basics — name and cover."}
          {step === 1 && "Choose who can mint and what they pay in UCT."}
          {step === 2 && "Optional: paste wallets that can mint early."}
          {step === 3 && "Looks good? Save your drop."}
          {step === 4 && "Publish when you want minting to open."}
        </p>
        {!token ? (
          <div className="panel glass" style={{ marginBottom: "1rem" }}>
            <p className="hint" style={{ marginTop: 0 }}>
              Connect your wallet to create a drop.
            </p>
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
        ) : null}

        {step === 0 ? (
          <div className="panel glass form-grid">
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
              Link name
              <input value={slug} onChange={(e) => setSlug(slugify(e.target.value))} />
              <span className="hint">Used in the URL, like /drops/{slug || "my-drop"}</span>
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
              <input value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} />
            </label>
            <label>
              Or upload a cover
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => onCoverFile(e.target.files?.[0] ?? null)}
              />
              {uploading ? <span className="muted">Uploading…</span> : null}
            </label>
            <button
              type="button"
              className="btn btn-signal"
              disabled={!name || !slug}
              onClick={() => setStep(1)}
            >
              Next: price
            </button>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="panel glass form-grid">
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
              Your royalty \(basis points\)
              <input
                type="number"
                min={0}
                max={2000}
                value={royaltyBps}
                onChange={(e) => setRoyaltyBps(Number(e.target.value))}
              />
              <span className="muted">{(royaltyBps / 100).toFixed(2)}% of secondary (stored)</span>
            </label>

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
                        value={p.priceDisplay}
                        onChange={(e) => {
                          const next = [...phases];
                          next[idx] = { ...p, priceDisplay: e.target.value };
                          setPhases(next);
                        }}
                      />
                    </label>
                    <label>
                      Max per person
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={p.maxPerWallet}
                        onChange={(e) => {
                          const next = [...phases];
                          next[idx] = { ...p, maxPerWallet: Number(e.target.value) };
                          setPhases(next);
                        }}
                      />
                    </label>
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
                disabled={!activePhases.length}
                onClick={() => setStep(activePhases.some((p) => p.type === "allowlist") ? 2 : 3)}
              >
                {activePhases.some((p) => p.type === "allowlist") ? "Allowlist" : "Review"}
              </button>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="panel glass form-grid">
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
                placeholder={"mock_buyer_abc\n02ab…\n@collector"}
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
          </div>
        ) : null}

        {step === 3 ? (
          <div className="panel glass form-grid">
            <h3 className="display" style={{ fontSize: "1.5rem" }}>
              {name}
            </h3>
            <p className="muted" style={{ margin: 0 }}>
              /{slug} · {totalSupply} supply · {(royaltyBps / 100).toFixed(2)}% royalty
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
          </div>
        ) : null}

        {step === 4 ? (
          <div className="panel glass form-grid">
            <h3 className="display" style={{ fontSize: "1.5rem" }}>
              Ready to publish?
            </h3>
            <p className="muted" style={{ margin: 0 }}>
              Publishing opens active phases. Mint payments settle in UCT to the treasury; creators
              accrue net proceeds after the platform fee.
              {allowlistPhaseId ? " Allowlist entries are saved." : ""}
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-signal"
                disabled={submitting}
                onClick={publish}
              >
                {submitting ? "Publishing…" : "Publish"}
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
          </div>
        ) : null}
      </div>
    </section>
  );
}

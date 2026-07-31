"use client";

import { useId, useState } from "react";

const FAQS = [
  {
    q: "What is Unipad?",
    a: "Unipad is an NFT launchpad on Unicity. Creators list drops, collectors mint with UCT, and settlement finishes after payment — no gas wars.",
  },
  {
    q: "What do I pay with?",
    a: "Mints are paid in UCT on Unicity. You connect Sphere, pay once, then Unipad completes the mint for you.",
  },
  {
    q: "How does minting work?",
    a: "Open a live drop, connect your wallet, confirm the UCT payment, and stay on the page. We queue and confirm the NFT after payment clears.",
  },
  {
    q: "How do I launch my own drop?",
    a: "Go to Create a drop, set name, supply, price, and optional schedule, then publish. Your drop appears on Unipad as Live or Upcoming.",
  },
  {
    q: "Can I schedule a mint?",
    a: "Yes. When listing, choose Schedule for later and pick a preset or custom date and time. The drop shows as Upcoming until minting opens.",
  },
  {
    q: "Do creators earn royalties?",
    a: "Yes. You set royalty basis points when creating a drop. Secondary proceeds accrue to your creator earnings after the platform fee.",
  },
] as const;

export function FaqSection() {
  const baseId = useId();
  const [open, setOpen] = useState(0);

  return (
    <section className="section faq-section" aria-labelledby={`${baseId}-title`}>
      <div className="faq-atmosphere" aria-hidden />
      <div className="shell faq-layout">
        <header className="faq-intro faq-glass">
          <p className="faq-kicker">FAQ</p>
          <h2 id={`${baseId}-title`}>Questions, answered</h2>
          <p>
            Everything you need to mint or launch on Unipad — short, clear, and ready when you are.
          </p>
        </header>

        <div className="faq-list faq-glass">
          {FAQS.map((item, i) => {
            const expanded = open === i;
            const panelId = `${baseId}-panel-${i}`;
            const btnId = `${baseId}-btn-${i}`;
            return (
              <div key={item.q} className={`faq-item${expanded ? " is-open" : ""}`}>
                <button
                  type="button"
                  id={btnId}
                  className="faq-trigger"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  onClick={() => setOpen(expanded ? -1 : i)}
                >
                  <span className="faq-index">{String(i + 1).padStart(2, "0")}</span>
                  <span className="faq-question">{item.q}</span>
                  <span className="faq-icon" aria-hidden>
                    {expanded ? "−" : "+"}
                  </span>
                </button>
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={btnId}
                  className="faq-panel"
                  hidden={!expanded}
                >
                  <p>{item.a}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

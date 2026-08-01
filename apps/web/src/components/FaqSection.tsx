"use client";

import { useId, useState } from "react";
import { AnimatePresence, m } from "framer-motion";
import { accordionPanel, fadeUp, springSnappy, staggerContainer, cardItem } from "@/lib/motion";

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
    a: "Yes. When someone mints your drop, your share is credited on the Earnings page. You also set secondary royalty basis points when creating a drop.",
  },
] as const;

export function FaqSection() {
  const baseId = useId();
  const [open, setOpen] = useState(0);

  return (
    <section className="section faq-section" aria-labelledby={`${baseId}-title`}>
      <div className="faq-atmosphere" aria-hidden />
      <div className="shell faq-layout">
        <m.header
          className="faq-intro faq-glass"
          variants={fadeUp}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.35 }}
        >
          <p className="faq-kicker">FAQ</p>
          <h2 id={`${baseId}-title`}>Questions, answered</h2>
          <p>
            Everything you need to mint or launch on Unipad — short, clear, and ready when you are.
          </p>
        </m.header>

        <m.div
          className="faq-list faq-glass"
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.15 }}
        >
          {FAQS.map((item, i) => {
            const expanded = open === i;
            const panelId = `${baseId}-panel-${i}`;
            const btnId = `${baseId}-btn-${i}`;
            return (
              <m.div
                key={item.q}
                className={`faq-item${expanded ? " is-open" : ""}`}
                variants={cardItem}
                layout
                transition={springSnappy}
              >
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
                  <m.span
                    className="faq-icon"
                    aria-hidden
                    animate={{ rotate: expanded ? 180 : 0 }}
                    transition={springSnappy}
                  >
                    {expanded ? "−" : "+"}
                  </m.span>
                </button>
                <AnimatePresence initial={false}>
                  {expanded ? (
                    <m.div
                      id={panelId}
                      role="region"
                      aria-labelledby={btnId}
                      className="faq-panel"
                      key="panel"
                      variants={accordionPanel}
                      initial="collapsed"
                      animate="open"
                      exit="collapsed"
                      style={{ overflow: "hidden" }}
                    >
                      <p>{item.a}</p>
                    </m.div>
                  ) : null}
                </AnimatePresence>
              </m.div>
            );
          })}
        </m.div>
      </div>
    </section>
  );
}

"use client";

import { m } from "framer-motion";
import { LogoMark } from "@/components/Icons";
import { fadeUp, springSoft } from "@/lib/motion";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="shell">
        <m.div
          className="site-footer-card"
          variants={fadeUp}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.25 }}
          whileHover={{ y: -2 }}
          transition={springSoft}
        >
          <div className="site-footer-main">
            <div className="site-footer-brand">
              <div className="site-footer-logo">
                <LogoMark className="site-footer-mark" />
                <span className="site-footer-word">
                  Uni<span>pad</span>
                </span>
              </div>
              <p>
                Unipad helps creators launch NFT drops on Unicity and collectors mint with UCT —
                fair launches, clear prices, no gas wars.
              </p>
            </div>
          </div>

          <div className="site-footer-bar">
            <p className="site-footer-copy">© {year} Unipad. All rights reserved.</p>
            <p className="site-footer-note">Built for Unicity · Settled in UCT</p>
          </div>
        </m.div>
      </div>
    </footer>
  );
}

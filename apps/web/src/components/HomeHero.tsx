"use client";

import Image from "next/image";
import Link from "next/link";
import { m } from "framer-motion";
import { fadeUp, heroActions, heroBrand, heroLine, springSnappy, staggerContainer } from "@/lib/motion";

export function HomeHero() {
  return (
    <section className="hero">
      <m.div
        className="hero-media"
        aria-hidden
        initial={{ opacity: 0, scale: 1.06 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
      >
        <Image
          src="/hero-bg.webp"
          alt=""
          fill
          priority
          quality={100}
          sizes="100vw"
          unoptimized
          style={{ objectFit: "cover", objectPosition: "left center" }}
        />
      </m.div>
      <div className="shell hero-layout">
        <m.div
          className="hero-content"
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          <m.div className="hero-brand" variants={heroBrand}>
            Uni<em>pad</em>
          </m.div>
          <m.p variants={heroLine}>
            Launch an NFT drop or mint one with UCT. Fair minting — no gas wars.
          </m.p>
          <m.div className="hero-actions" variants={heroActions}>
            <m.div whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} transition={springSnappy}>
              <Link href="/drops" className="btn btn-primary">
                Mint an NFT
              </Link>
            </m.div>
            <m.div whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} transition={springSnappy}>
              <Link href="/launch" className="btn btn-ghost on-orange">
                Create a drop
              </Link>
            </m.div>
          </m.div>
        </m.div>
      </div>
    </section>
  );
}

export function SectionReveal({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <m.div
      className={className}
      variants={fadeUp}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.2, margin: "0px 0px -8% 0px" }}
    >
      {children}
    </m.div>
  );
}

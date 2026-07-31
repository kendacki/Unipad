import type { Metadata } from "next";
import Link from "next/link";
import { DropGrid } from "@/components/DropGrid";
import { FaqSection } from "@/components/FaqSection";
import { HomeHero, SectionReveal } from "@/components/HomeHero";

export const metadata: Metadata = {
  title: "Unipad — Launch & mint NFTs on Unicity",
  description:
    "Create a drop or mint an NFT with UCT. Fair minting on Unicity — no gas wars.",
  openGraph: {
    title: "Unipad — Launch & mint NFTs on Unicity",
    description:
      "Create a drop or mint an NFT with UCT. Fair minting on Unicity — no gas wars.",
  },
};

export default function HomePage() {
  return (
    <>
      <HomeHero />

      <section className="section alt">
        <div className="shell">
          <SectionReveal>
            <div className="section-head">
              <div>
                <h2>Live drops</h2>
                <p>Open now — mint with UCT.</p>
              </div>
              <Link href="/drops" className="btn btn-ghost">
                See all
              </Link>
            </div>
          </SectionReveal>
          <DropGrid limit={3} defaultFilter="mintable" />
        </div>
      </section>

      <FaqSection />
    </>
  );
}

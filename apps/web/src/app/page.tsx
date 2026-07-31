import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { DropGrid } from "@/components/DropGrid";

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
      <section className="hero">
        <div className="hero-media" aria-hidden>
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
        </div>
        <div className="shell hero-layout">
          <div className="hero-content">
            <div className="hero-brand">
              Uni<em>pad</em>
            </div>
            <p>Launch an NFT drop or mint one with UCT. Fair minting — no gas wars.</p>
            <div className="hero-actions">
              <Link href="/drops" className="btn btn-primary">
                Mint an NFT
              </Link>
              <Link href="/launch" className="btn btn-ghost on-orange">
                Create a drop
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="section alt">
        <div className="shell">
          <div className="section-head">
            <div>
              <h2>Live drops</h2>
              <p>Open now — mint with UCT.</p>
            </div>
            <Link href="/drops" className="btn btn-ghost">
              See all
            </Link>
          </div>
          <DropGrid limit={3} defaultFilter="mintable" />
        </div>
      </section>
    </>
  );
}

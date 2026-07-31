import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { DropGrid } from "@/components/DropGrid";
import { CARTOON_CHARACTERS } from "@/lib/media";

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
        <div className="hero-media" aria-hidden />
        <div className="shell hero-layout">
          <div className="hero-character" aria-hidden>
            <Image
              src={CARTOON_CHARACTERS.hoodieAvatar}
              alt=""
              width={840}
              height={980}
              priority
              sizes="(max-width: 860px) 70vw, 420px"
              style={{ width: "100%", height: "auto" }}
            />
          </div>
          <div className="hero-content">
            <div className="hero-brand">
              Uni<em>pad</em>
            </div>
            <p>Launch an NFT drop or mint one with UCT. Fair minting — no gas wars.</p>
            <div className="hero-actions">
              <Link href="/drops" className="btn btn-signal">
                Mint an NFT
              </Link>
              <Link href="/launch" className="btn btn-ghost on-dark">
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

import Link from "next/link";
import { DropGrid } from "@/components/DropGrid";

export default function DropsPage() {
  return (
    <section className="section">
      <div className="shell">
        <div className="section-head">
          <div>
            <h2>Drops</h2>
            <p>Mint live NFTs with UCT — pay once, we finish the mint.</p>
          </div>
          <Link href="/launch" className="btn btn-signal">
            Create a drop
          </Link>
        </div>
        <DropGrid filterable defaultFilter="mintable" />
      </div>
    </section>
  );
}

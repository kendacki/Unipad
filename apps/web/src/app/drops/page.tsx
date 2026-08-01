import { Suspense } from "react";
import { DropsListing } from "@/components/DropsListing";

export default function DropsPage() {
  return (
    <section className="section drops-page">
      <div className="shell">
        <Suspense fallback={<div className="muted">Loading drops…</div>}>
          <DropsListing />
        </Suspense>
      </div>
    </section>
  );
}

import type { Collection, CollectionStatus } from "@unipad/shared";
import { formatUct } from "@unipad/shared";

export type DropFilter = "mintable" | "upcoming" | "all";

export function statusLabel(status: CollectionStatus): string {
  switch (status) {
    case "live":
      return "Live";
    case "scheduled":
      return "Upcoming";
    case "sold_out":
      return "Sold out";
    case "ended":
      return "Ended";
    case "draft":
      return "Draft";
    default:
      return status;
  }
}

export function isMintable(c: Collection): boolean {
  return c.status === "live" && c.remainingSupply > 0;
}

export function dropPriceLabel(c: Collection): string {
  const price = c.activePhase?.priceUct ?? c.phases[0]?.priceUct;
  return price ? `${formatUct(price)} UCT` : "—";
}

export function matchesFilter(c: Collection, filter: DropFilter): boolean {
  if (filter === "mintable") return isMintable(c);
  if (filter === "upcoming") return c.status === "scheduled";
  return true;
}

/** Live mintable first, then upcoming, then sold out / ended */
export function sortForStorefront(collections: Collection[]): Collection[] {
  const rank = (c: Collection) => {
    if (isMintable(c)) return 0;
    if (c.status === "scheduled") return 1;
    if (c.status === "live") return 2;
    if (c.status === "sold_out") return 3;
    return 4;
  };
  return [...collections].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    const aTime = a.launchAt ?? a.createdAt;
    const bTime = b.launchAt ?? b.createdAt;
    return bTime.localeCompare(aTime);
  });
}

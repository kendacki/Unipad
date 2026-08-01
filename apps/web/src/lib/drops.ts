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

/**
 * Drop blurbs for UI: strip mint/Unipad marketing suffixes and a duplicated
 * "by {creator}" clause when the creator line is shown separately.
 */
export function cleanDropDescription(
  description: string | null | undefined,
  creatorName?: string | null,
): string {
  let text = (description || "").trim();
  if (!text) return "";

  text = text.replace(
    /\s*[—–-]\s*(?:mint|live mint|fair mint|pay once|settle)\b.*$/i,
    "",
  );
  text = text.replace(/\s+on\s+(?:Unipad|Unicity)\.?$/i, "");
  text = text.replace(/\s*[—–-]\s*mint (?:from|with)\b.*$/i, "");

  const creator = creatorName?.trim();
  if (creator) {
    const escaped = creator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`\\s*by\\s+${escaped}\\b`, "ig"), "");
  }

  text = text.replace(/\s{2,}/g, " ").replace(/\s*[—–,-]\s*$/g, "").trim();
  return text;
}

/** Live mintable first, then upcoming (soonest), then sold out / ended */
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
    // Upcoming: soonest open first. Live / rest: newest first.
    if (a.status === "scheduled" && b.status === "scheduled") {
      return aTime.localeCompare(bTime);
    }
    return bTime.localeCompare(aTime);
  });
}

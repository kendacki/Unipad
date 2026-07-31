import type { Collection, CollectionPhase } from "@unipad/shared";

type CollectionRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  creator_principal: string;
  creator_display_name: string;
  cover_url: string | null;
  status: Collection["status"];
  total_supply: number;
  minted_count: number;
  royalty_bps: number;
  launch_at: Date | null;
  created_at: Date;
};

type PhaseRow = {
  id: string;
  collection_id: string;
  type: CollectionPhase["type"];
  name: string;
  price_uct: string;
  max_per_wallet: number;
  starts_at: Date | null;
  ends_at: Date | null;
  supply_cap: number | null;
  sort_order: number;
};

export function mapPhase(row: PhaseRow): CollectionPhase {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    priceUct: row.price_uct,
    maxPerWallet: row.max_per_wallet,
    startsAt: row.starts_at?.toISOString() ?? null,
    endsAt: row.ends_at?.toISOString() ?? null,
    supplyCap: row.supply_cap,
  };
}

export function pickActivePhase(phases: CollectionPhase[], now = Date.now()): CollectionPhase | null {
  const timed = phases.filter((p) => {
    const startOk = !p.startsAt || new Date(p.startsAt).getTime() <= now;
    const endOk = !p.endsAt || new Date(p.endsAt).getTime() > now;
    return startOk && endOk;
  });
  if (!timed.length) return phases.find((p) => p.type === "public") ?? phases[0] ?? null;
  // Prefer narrower phases when windows overlap (creator > allowlist > public)
  const rank = (t: CollectionPhase["type"]) =>
    t === "creator" ? 0 : t === "allowlist" ? 1 : 2;
  return [...timed].sort((a, b) => rank(a.type) - rank(b.type))[0];
}

export function mapCollection(row: CollectionRow, phases: CollectionPhase[]): Collection {
  const remaining = Math.max(0, row.total_supply - row.minted_count);
  let status = row.status;
  if (remaining === 0 && row.minted_count > 0) status = "sold_out";
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    creatorPrincipal: row.creator_principal,
    creatorDisplayName: row.creator_display_name || row.creator_principal.slice(0, 12),
    coverUrl: row.cover_url,
    status,
    totalSupply: row.total_supply,
    mintedCount: row.minted_count,
    remainingSupply: remaining,
    royaltyBps: row.royalty_bps,
    phases,
    activePhase: pickActivePhase(phases),
    createdAt: row.created_at.toISOString(),
    launchAt: row.launch_at?.toISOString() ?? null,
  };
}

export type { CollectionRow, PhaseRow };

import type { Collection, CollectionPhase } from "@unipad/shared";
import { parseUct } from "@unipad/shared";

const COVER_HD = "auto=format&fit=crop&w=1200&q=85";
const cover = (id: string) => `https://images.unsplash.com/photo-${id}?${COVER_HD}`;

type SeedDrop = {
  slug: string;
  name: string;
  description: string;
  creatorPrincipal: string;
  creatorName: string;
  priceUct: string;
  supply: number;
  coverUrl: string;
};

/** Production storefront catalog when the Hono API / Postgres is not reachable. */
const SEED: SeedDrop[] = [
  {
    slug: "signal-001",
    name: "Signal Genesis",
    description: "Opening edition from North Signal — mint from 1 UCT on Unicity.",
    creatorPrincipal: "mock_creator_north_signal",
    creatorName: "North Signal Studio",
    priceUct: "1",
    supply: 100,
    coverUrl: cover("1699524826369-57870e627c43"),
  },
  {
    slug: "orbit-pulse",
    name: "Orbit Pulse",
    description: "Kinetic characters from Mira Vale — fair mint, settle in UCT.",
    creatorPrincipal: "mock_creator_mira_vale",
    creatorName: "Mira Vale",
    priceUct: "12",
    supply: 64,
    coverUrl: cover("1636622433525-127afdf3662d"),
  },
  {
    slug: "north-flare",
    name: "North Flare",
    description: "Lumen Collective’s night-sky drop on Unipad.",
    creatorPrincipal: "mock_creator_lumen",
    creatorName: "Lumen Collective",
    priceUct: "8",
    supply: 88,
    coverUrl: cover("1638803040283-7a5ffd48dad5"),
  },
  {
    slug: "amber-relay",
    name: "Amber Relay",
    description: "Warm-tone relics by Kai Rostova — pay once in UCT.",
    creatorPrincipal: "mock_creator_kai_rostova",
    creatorName: "Kai Rostova",
    priceUct: "15",
    supply: 120,
    coverUrl: cover("1639503611585-1054af5dbfab"),
  },
  {
    slug: "glass-harbor",
    name: "Glass Harbor",
    description: "Coastal figures from Harbor Atelier — live on Unicity.",
    creatorPrincipal: "mock_creator_harbor",
    creatorName: "Harbor Atelier",
    priceUct: "6",
    supply: 75,
    coverUrl: cover("1728729729215-00ae703063ff"),
  },
  {
    slug: "ember-kit",
    name: "Ember Kit",
    description: "Toy-form sculptures by Jun Park — mint with UCT.",
    creatorPrincipal: "mock_creator_jun_park",
    creatorName: "Jun Park",
    priceUct: "10",
    supply: 50,
    coverUrl: cover("1740252117012-bb53ad05e370"),
  },
  {
    slug: "private-circuit",
    name: "Private Circuit",
    description: "Curated edition by Elena Moss — mint with UCT on Unipad.",
    creatorPrincipal: "mock_creator_elena_moss",
    creatorName: "Elena Moss",
    priceUct: "20",
    supply: 40,
    coverUrl: cover("1740252117013-4fb21771e7ca"),
  },
  {
    slug: "volt-mascot",
    name: "Volt Mascot",
    description: "Electric softforms by Rio Quinn — fair mint on Unicity.",
    creatorPrincipal: "mock_creator_rio_quinn",
    creatorName: "Rio Quinn",
    priceUct: "9",
    supply: 96,
    coverUrl: cover("1740252117027-4275d3f84385"),
  },
  {
    slug: "nova-trinket",
    name: "Nova Trinket",
    description: "Playful fiends by Sol Varga — mint in UCT on Unipad.",
    creatorPrincipal: "mock_creator_sol_varga",
    creatorName: "Sol Varga",
    priceUct: "7",
    supply: 72,
    coverUrl: cover("1759950616527-15c2818f2f3c"),
  },
  {
    slug: "moss-guard",
    name: "Moss Guard",
    description: "Wall-peek guardians by Ivy Chen — live mint with UCT.",
    creatorPrincipal: "mock_creator_ivy_chen",
    creatorName: "Ivy Chen",
    priceUct: "11",
    supply: 60,
    coverUrl: cover("1759950616453-4f4a161c0c8d"),
  },
];

function toCollection(def: SeedDrop, index: number): Collection {
  const createdAt = new Date(Date.UTC(2026, 0, 15 + index, 12, 0, 0)).toISOString();
  const phase: CollectionPhase = {
    id: `phase-${def.slug}`,
    type: "public",
    name: "Public",
    priceUct: parseUct(def.priceUct),
    maxPerWallet: 3,
    startsAt: createdAt,
    endsAt: null,
    supplyCap: null,
  };
  return {
    id: `col-${def.slug}`,
    slug: def.slug,
    name: def.name,
    description: def.description,
    creatorPrincipal: def.creatorPrincipal,
    creatorDisplayName: def.creatorName,
    coverUrl: def.coverUrl,
    status: "live",
    totalSupply: def.supply,
    mintedCount: 0,
    remainingSupply: def.supply,
    royaltyBps: 500,
    phases: [phase],
    activePhase: phase,
    createdAt,
    launchAt: createdAt,
  };
}

const CATALOG = SEED.map(toCollection);

export function listCatalogCollections(status?: string | null): Collection[] {
  if (!status || status === "all") return CATALOG;
  return CATALOG.filter((c) => c.status === status);
}

export function getCatalogCollection(idOrSlug: string): Collection | null {
  const key = idOrSlug.toLowerCase();
  return (
    CATALOG.find((c) => c.id === idOrSlug || c.slug === idOrSlug || c.slug.toLowerCase() === key) ??
    null
  );
}

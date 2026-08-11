import { parseUct } from "@unipad/shared";
import { pool, query } from "./pool.js";

/** Random integer in [min, max] inclusive */
function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

type DropSeed = {
  slug: string;
  name: string;
  description: string;
  creatorPrincipal: string;
  creatorName: string;
  /** Fixed price, or null = random ≥ 2 UCT. First drop stays at 1 UCT. */
  priceUct: string | null;
  supply: number;
  coverUrl: string;
};

/** Homepage / listing sample drops with real-sounding collection + creator names */
const COVER_HD = "auto=format&fit=crop&w=1200&q=85";
const cover = (id: string) => `https://images.unsplash.com/photo-${id}?${COVER_HD}`;

const DROP_DEFS: DropSeed[] = [
  {
    slug: "signal-001",
    name: "Signal Genesis",
    description: "Opening edition from the North Signal series.",
    creatorPrincipal: "mock_creator_north_signal",
    creatorName: "North Signal Studio",
    priceUct: "1",
    supply: 100,
    coverUrl: "/covers/signal-genesis.png",
  },
  {
    slug: "orbit-pulse",
    name: "Orbit Pulse",
    description: "Kinetic characters built for motion.",
    creatorPrincipal: "mock_creator_mira_vale",
    creatorName: "Mira Vale",
    priceUct: null,
    supply: 64,
    coverUrl: cover("1636622433525-127afdf3662d"),
  },
  {
    slug: "north-flare",
    name: "North Flare",
    description: "A night-sky drop from the lumen edge.",
    creatorPrincipal: "mock_creator_lumen",
    creatorName: "Lumen Collective",
    priceUct: null,
    supply: 88,
    coverUrl: cover("1638803040283-7a5ffd48dad5"),
  },
  {
    slug: "amber-relay",
    name: "Amber Relay",
    description: "Warm-tone relics with a single settle.",
    creatorPrincipal: "mock_creator_kai_rostova",
    creatorName: "Kai Rostova",
    priceUct: null,
    supply: 120,
    coverUrl: cover("1639503611585-1054af5dbfab"),
  },
  {
    slug: "glass-harbor",
    name: "Glass Harbor",
    description: "Coastal figures from the atelier line.",
    creatorPrincipal: "mock_creator_harbor",
    creatorName: "Harbor Atelier",
    priceUct: null,
    supply: 75,
    coverUrl: cover("1728729729215-00ae703063ff"),
  },
  {
    slug: "ember-kit",
    name: "Ember Kit",
    description: "Toy-form sculptures ready to claim.",
    creatorPrincipal: "mock_creator_jun_park",
    creatorName: "Jun Park",
    priceUct: null,
    supply: 50,
    coverUrl: cover("1740252117012-bb53ad05e370"),
  },
  {
    slug: "private-circuit",
    name: "Private Circuit",
    description: "A curated private edition.",
    creatorPrincipal: "mock_creator_elena_moss",
    creatorName: "Elena Moss",
    priceUct: null,
    supply: 40,
    coverUrl: cover("1740252117013-4fb21771e7ca"),
  },
  {
    slug: "volt-mascot",
    name: "Volt Mascot",
    description: "Electric softforms with charge.",
    creatorPrincipal: "mock_creator_rio_quinn",
    creatorName: "Rio Quinn",
    priceUct: null,
    supply: 96,
    coverUrl: cover("1740252117027-4275d3f84385"),
  },
  {
    slug: "nova-trinket",
    name: "Nova Trinket",
    description: "Playful fiends for the shelf.",
    creatorPrincipal: "mock_creator_sol_varga",
    creatorName: "Sol Varga",
    priceUct: null,
    supply: 72,
    coverUrl: cover("1759950616527-15c2818f2f3c"),
  },
  {
    slug: "moss-guard",
    name: "Moss Guard",
    description: "Wall-peek guardians on watch.",
    creatorPrincipal: "mock_creator_ivy_chen",
    creatorName: "Ivy Chen",
    priceUct: null,
    supply: 60,
    coverUrl: cover("1759950616453-4f4a161c0c8d"),
  },
];

async function ensureCreator(principal: string, displayName: string) {
  await query(
    `INSERT INTO creators (principal, display_name)
     VALUES ($1, $2)
     ON CONFLICT (principal) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [principal, displayName],
  );
}

async function upsertDrop(def: DropSeed, priceDisplay: string) {
  const price = parseUct(priceDisplay);
  await ensureCreator(def.creatorPrincipal, def.creatorName);

  const existing = await query<{ id: string }>(
    `SELECT id FROM collections WHERE slug = $1`,
    [def.slug],
  );

  let id: string;
  if (existing.rows[0]) {
    id = existing.rows[0].id;
    await query(
      `UPDATE collections
       SET name = $2,
           description = $3,
           cover_url = $4,
           status = 'live',
           total_supply = $5,
           creator_principal = $6,
           launch_at = COALESCE(launch_at, now())
       WHERE id = $1`,
      [id, def.name, def.description, def.coverUrl, def.supply, def.creatorPrincipal],
    );
    const phase = await query<{ id: string }>(
      `SELECT id FROM collection_phases WHERE collection_id = $1 ORDER BY sort_order ASC LIMIT 1`,
      [id],
    );
    if (phase.rows[0]) {
      await query(
        `UPDATE collection_phases
         SET type = 'public', name = 'Public', price_uct = $2, max_per_wallet = 2, starts_at = COALESCE(starts_at, now())
         WHERE id = $1`,
        [phase.rows[0].id, price],
      );
    } else {
      await query(
        `INSERT INTO collection_phases (
           collection_id, type, name, price_uct, max_per_wallet, starts_at, sort_order
         ) VALUES ($1, 'public', 'Public', $2, 2, now(), 0)`,
        [id, price],
      );
    }
  } else {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO collections (
         slug, name, description, creator_principal, cover_url,
         status, total_supply, royalty_bps, launch_at
       ) VALUES ($1,$2,$3,$4,$5,'live',$6,500,now())
       RETURNING id`,
      [
        def.slug,
        def.name,
        def.description,
        def.creatorPrincipal,
        def.coverUrl,
        def.supply,
      ],
    );
    id = rows[0].id;
    await query(
      `INSERT INTO collection_phases (
         collection_id, type, name, price_uct, max_per_wallet, starts_at, sort_order
       ) VALUES ($1, 'public', 'Public', $2, 2, now(), 0)`,
      [id, price],
    );
  }

  return priceDisplay;
}

/** Rename leftover demo / placeholder collections so the homepage never shows them. */
async function cleanupPlaceholderDrops() {
  const renames: Array<{ slug: string; name: string; creator: string; creatorName: string }> = [
    {
      slug: "allowlist-only",
      name: "Private Circuit",
      creator: "mock_creator_elena_moss",
      creatorName: "Elena Moss",
    },
  ];

  for (const r of renames) {
    await ensureCreator(r.creator, r.creatorName);
    await query(
      `UPDATE collections c
       SET name = $2,
           creator_principal = $3,
           description = COALESCE(NULLIF(description, ''), $4)
       WHERE lower(c.slug) = $1 OR lower(c.name) IN ('allowlist only', 'allowlist-only')`,
      [
        r.slug,
        r.name,
        r.creator,
        "A curated private edition.",
      ],
    );
  }

  // Any creator still labeled "Demo Creator" gets a studio name
  await query(
    `UPDATE creators
     SET display_name = 'Studio Atlas'
     WHERE lower(display_name) IN ('demo creator', 'creator', '')`,
  );
}

/** Ensure the top public drops each get a distinct HD cartoon cover. */
async function refreshPublicCovers() {
  const covers = DROP_DEFS.map((d) => d.coverUrl);
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM collections
     WHERE status IN ('live', 'scheduled', 'sold_out', 'ended')
     ORDER BY COALESCE(launch_at, created_at) DESC
     LIMIT $1`,
    [covers.length],
  );
  for (let i = 0; i < rows.length; i++) {
    await query(`UPDATE collections SET cover_url = $2, updated_at = now() WHERE id = $1`, [
      rows[i].id,
      covers[i],
    ]);
  }
}

async function seed() {
  await cleanupPlaceholderDrops();

  // Existing live drops: enforce 2 mints per wallet (platform default for current listings).
  await query(
    `UPDATE collection_phases
     SET max_per_wallet = 2
     WHERE type IN ('public', 'allowlist', 'creator')`,
  );

  const results: Array<{ slug: string; name: string; creator: string; price: string }> = [];

  for (let i = 0; i < DROP_DEFS.length; i++) {
    const def = DROP_DEFS[i];
    const priceDisplay = def.priceUct ?? String(randInt(2, 42));
    const price = await upsertDrop(def, priceDisplay);
    results.push({
      slug: def.slug,
      name: def.name,
      creator: def.creatorName,
      price,
    });
  }

  await refreshPublicCovers();

  console.log("Seeded / updated drops:");
  for (const r of results) {
    console.log(`  - ${r.name} by ${r.creator} · ${r.price} UCT (${r.slug})`);
  }
  await pool.end();
}

seed().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});

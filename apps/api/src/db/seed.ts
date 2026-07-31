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
const DROP_DEFS: DropSeed[] = [
  {
    slug: "signal-001",
    name: "Signal Genesis",
    description: "Opening edition from North Signal — mint from 1 UCT on Unicity.",
    creatorPrincipal: "mock_creator_north_signal",
    creatorName: "North Signal Studio",
    priceUct: "1",
    supply: 100,
    coverUrl:
      "https://images.unsplash.com/photo-1699524826369-57870e627c43?auto=format&fit=crop&w=800&q=75",
  },
  {
    slug: "orbit-pulse",
    name: "Orbit Pulse",
    description: "Kinetic characters from Mira Vale — fair mint, settle in UCT.",
    creatorPrincipal: "mock_creator_mira_vale",
    creatorName: "Mira Vale",
    priceUct: null,
    supply: 64,
    coverUrl:
      "https://images.unsplash.com/photo-1592561199818-6b69d3d1d6e2?auto=format&fit=crop&w=800&q=75",
  },
  {
    slug: "north-flare",
    name: "North Flare",
    description: "Lumen Collective’s night-sky drop on Unipad.",
    creatorPrincipal: "mock_creator_lumen",
    creatorName: "Lumen Collective",
    priceUct: null,
    supply: 88,
    coverUrl:
      "https://images.unsplash.com/photo-1637858868799-7f26a0640eb6?auto=format&fit=crop&w=800&q=75",
  },
  {
    slug: "amber-relay",
    name: "Amber Relay",
    description: "Warm-tone relics by Kai Rostova — pay once in UCT.",
    creatorPrincipal: "mock_creator_kai_rostova",
    creatorName: "Kai Rostova",
    priceUct: null,
    supply: 120,
    coverUrl:
      "https://images.unsplash.com/photo-1628260412297-a3377e45006f?auto=format&fit=crop&w=800&q=75",
  },
  {
    slug: "glass-harbor",
    name: "Glass Harbor",
    description: "Coastal figures from Harbor Atelier — live on Unicity.",
    creatorPrincipal: "mock_creator_harbor",
    creatorName: "Harbor Atelier",
    priceUct: null,
    supply: 75,
    coverUrl:
      "https://images.unsplash.com/photo-1639628735078-ed2f038a193e?auto=format&fit=crop&w=800&q=75",
  },
  {
    slug: "ember-kit",
    name: "Ember Kit",
    description: "Toy-form sculptures by Jun Park — mint with UCT.",
    creatorPrincipal: "mock_creator_jun_park",
    creatorName: "Jun Park",
    priceUct: null,
    supply: 50,
    coverUrl:
      "https://images.unsplash.com/photo-1620428268482-cf1851a36764?auto=format&fit=crop&w=800&q=75",
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
         SET type = 'public', name = 'Public', price_uct = $2, max_per_wallet = 3, starts_at = COALESCE(starts_at, now())
         WHERE id = $1`,
        [phase.rows[0].id, price],
      );
    } else {
      await query(
        `INSERT INTO collection_phases (
           collection_id, type, name, price_uct, max_per_wallet, starts_at, sort_order
         ) VALUES ($1, 'public', 'Public', $2, 3, now(), 0)`,
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
       ) VALUES ($1, 'public', 'Public', $2, 3, now(), 0)`,
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
        "Curated edition by Elena Moss — mint with UCT on Unipad.",
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

async function seed() {
  await cleanupPlaceholderDrops();

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

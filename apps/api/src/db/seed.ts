import { parseUct } from "@unipad/shared";
import { pool, query } from "./pool.js";

/** Random integer in [min, max] inclusive */
function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Homepage / listing drops: first is always 1 UCT; others random ≥ 1 */
const DROP_DEFS = [
  {
    slug: "signal-001",
    name: "Signal 001",
    description: "Genesis drop on Unipad — mint from 1 UCT.",
    priceUct: "1",
    supply: 100,
  },
  {
    slug: "orbit-pulse",
    name: "Orbit Pulse",
    description: "A live Unicity drop with a randomized UCT price.",
    priceUct: null as string | null, // filled at runtime
    supply: 64,
  },
  {
    slug: "north-flare",
    name: "North Flare",
    description: "Fair mint, pay with UCT, settled on Unicity.",
    priceUct: null as string | null,
    supply: 88,
  },
];

async function upsertDrop(params: {
  creator: string;
  slug: string;
  name: string;
  description: string;
  coverUrl: string;
  supply: number;
  priceDisplay: string;
}) {
  const price = parseUct(params.priceDisplay);
  const existing = await query<{ id: string }>(
    `SELECT id FROM collections WHERE slug = $1`,
    [params.slug],
  );

  let id: string;
  if (existing.rows[0]) {
    id = existing.rows[0].id;
    await query(
      `UPDATE collections
       SET name = $2, description = $3, cover_url = $4, status = 'live',
           total_supply = $5, launch_at = COALESCE(launch_at, now())
       WHERE id = $1`,
      [id, params.name, params.description, params.coverUrl, params.supply],
    );
    await query(`DELETE FROM collection_phases WHERE collection_id = $1`, [id]);
  } else {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO collections (
         slug, name, description, creator_principal, cover_url,
         status, total_supply, royalty_bps, launch_at
       ) VALUES ($1,$2,$3,$4,$5,'live',$6,500,now())
       RETURNING id`,
      [
        params.slug,
        params.name,
        params.description,
        params.creator,
        params.coverUrl,
        params.supply,
      ],
    );
    id = rows[0].id;
  }

  await query(
    `INSERT INTO collection_phases (
       collection_id, type, name, price_uct, max_per_wallet, starts_at, sort_order
     ) VALUES ($1, 'public', 'Public', $2, 3, now(), 0)`,
    [id, price],
  );

  return { id, priceDisplay: params.priceDisplay };
}

async function seed() {
  const creator = "mock_seed_creator";
  await query(
    `INSERT INTO creators (principal, display_name)
     VALUES ($1, $2)
     ON CONFLICT (principal) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [creator, "North Signal Studio"],
  );

  // Avoid importing web media paths that may break API resolve — use Unsplash URLs inline
  const covers = [
    "https://images.unsplash.com/photo-1699524826369-57870e627c43?auto=format&fit=crop&w=800&q=75",
    "https://images.unsplash.com/photo-1592561199818-6b69d3d1d6e2?auto=format&fit=crop&w=800&q=75",
    "https://images.unsplash.com/photo-1637858868799-7f26a0640eb6?auto=format&fit=crop&w=800&q=75",
  ];

  const results = [];
  for (let i = 0; i < DROP_DEFS.length; i++) {
    const def = DROP_DEFS[i];
    // Minimum mint price on homepage is 1 UCT; remaining drops get a random price ≥ 1
    const priceDisplay = def.priceUct ?? String(randInt(2, 42));
    const saved = await upsertDrop({
      creator,
      slug: def.slug,
      name: def.name,
      description: def.description,
      coverUrl: covers[i % covers.length],
      supply: def.supply,
      priceDisplay,
    });
    results.push({ slug: def.slug, priceUct: saved.priceDisplay });
  }

  console.log("Seeded / updated live drops (min 1 UCT):");
  for (const r of results) {
    console.log(`  - ${r.slug}: ${r.priceUct} UCT`);
  }
  await pool.end();
}

seed().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});

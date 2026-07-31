import { parseUct } from "@unipad/shared";
import { pool, query } from "./pool.js";

async function seed() {
  const creator = "mock_seed_creator";
  await query(
    `INSERT INTO creators (principal, display_name)
     VALUES ($1, $2)
     ON CONFLICT (principal) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [creator, "North Signal Studio"],
  );

  const existing = await query(`SELECT id FROM collections WHERE slug = 'signal-001'`);
  if (existing.rows.length) {
    console.log("Seed already present.");
    await pool.end();
    return;
  }

  const { rows } = await query<{ id: string }>(
    `INSERT INTO collections (
       slug, name, description, creator_principal, cover_url,
       status, total_supply, royalty_bps, launch_at
     ) VALUES (
       'signal-001',
       'Signal 001',
       'A genesis drop on Unipad — self-authenticating art settled in UCT on Unicity.',
       $1,
       'https://images.unsplash.com/photo-1699524826369-57870e627c43?auto=format&fit=crop&w=1600&q=80',
       'live',
       100,
       500,
       now()
     ) RETURNING id`,
    [creator],
  );

  const id = rows[0].id;
  await query(
    `INSERT INTO collection_phases (
       collection_id, type, name, price_uct, max_per_wallet, starts_at, sort_order
     ) VALUES
       ($1, 'public', 'Public', $2, 3, now(), 0)`,
    [id, parseUct("25")],
  );

  console.log("Seeded collection signal-001");
  await pool.end();
}

seed().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});

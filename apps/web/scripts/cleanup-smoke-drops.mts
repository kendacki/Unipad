/**
 * Remove leftover smoke-test drops (and related ledger rows) from Supabase.
 *   pnpm exec tsx scripts/cleanup-smoke-drops.mts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && process.env[k] == null) process.env[k] = v;
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));
loadEnvFile(resolve(process.cwd(), "../../.env"));

function isSmokeListing(row: {
  id?: string;
  slug?: string;
  name?: string;
  description?: string;
  creatorDisplayName?: string;
}) {
  const slug = (row.slug || "").toLowerCase();
  const name = (row.name || "").toLowerCase();
  const desc = (row.description || "").toLowerCase();
  const creator = (row.creatorDisplayName || "").toLowerCase();
  const id = (row.id || "").toLowerCase();
  return (
    slug.startsWith("smoke-") ||
    id.startsWith("col-smoke-") ||
    name.startsWith("smoke drop") ||
    desc === "smoke test drop" ||
    creator === "@smoke"
  );
}

async function main() {
  const {
    isPersistentStoreConfigured,
    usesSupabaseStore,
    getJson,
    putJson,
    listJsonUnder,
    listPathnames,
    removeObject,
  } = await import("../src/lib/objectStore.ts");

  if (!isPersistentStoreConfigured()) throw new Error("persistent store not configured");
  if (!usesSupabaseStore()) throw new Error("expected Supabase store");

  const removed: string[] = [];
  const collections = await listJsonUnder<{
    id: string;
    slug: string;
    name?: string;
    description?: string;
    creatorDisplayName?: string;
    creatorPrincipal?: string;
  }>("listings/collections/");

  const smoke = collections.filter(isSmokeListing);
  console.log(
    "found smoke listings:",
    smoke.map((c) => ({ id: c.id, slug: c.slug, name: c.name })),
  );

  const registryPath = "listings/public-registry.json";
  const registry = (await getJson<{
    updatedAt?: string;
    byId?: Record<string, unknown>;
  }>(registryPath)) || { updatedAt: new Date().toISOString(), byId: {} };
  const byId = { ...(registry.byId || {}) };

  for (const listing of smoke) {
    const id = listing.id;
    const slug = listing.slug;
    const principal = listing.creatorPrincipal || "";

    const paths = [
      `listings/collections/${id}.json`,
      `listings/slugs/${slug.toLowerCase()}.json`,
    ];
    if (principal) {
      paths.push(
        `listings/creators/${encodeURIComponent(principal).slice(0, 120)}/${id}.json`,
      );
    }

    for (const p of [
      ...(await listPathnames(`mints/tokens/${id}/`)).map((x) => x.pathname),
      ...(await listPathnames(`mints/reservations/`)).map((x) => x.pathname),
    ]) {
      if (p.includes(id) || p.includes("smoke")) paths.push(p);
    }

    // wallet index rows that reference this collection
    for (const w of await listPathnames("mints/wallets/")) {
      if (w.pathname.includes(`${id}-`)) paths.push(w.pathname);
    }

    // earnings tied to smoke creator principals used by the script
    if (principal) {
      for (const e of await listPathnames(
        `earnings/creators/${encodeURIComponent(principal).slice(0, 120)}/`,
      )) {
        paths.push(e.pathname);
      }
    }

    for (const p of [...new Set(paths)]) {
      try {
        await removeObject(p);
        removed.push(p);
      } catch (err) {
        console.warn("skip", p, err instanceof Error ? err.message : err);
      }
    }

    if (byId[id]) delete byId[id];
  }

  // Also strip any smoke entries left only in the registry
  for (const [id, entry] of Object.entries(byId)) {
    if (isSmokeListing({ id, ...(entry as object) })) {
      delete byId[id];
      removed.push(`registry:${id}`);
    }
  }

  await putJson(registryPath, {
    updatedAt: new Date().toISOString(),
    byId,
  });

  // leftover exclusive reservation smoke keys
  for (const p of await listPathnames("mints/reservations/smoke/")) {
    try {
      await removeObject(p.pathname);
      removed.push(p.pathname);
    } catch {
      /* ignore */
    }
  }

  // smoke media files in storage (best-effort via pathnames table only — media is in bucket)
  console.log(
    JSON.stringify(
      {
        ok: true,
        smokeCount: smoke.length,
        removedCount: removed.length,
        removed,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error("CLEANUP_FAIL", e instanceof Error ? e.message : e);
  process.exit(1);
});

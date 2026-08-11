/**
 * One-off repair: restore creator cover images for Hdoanh + Genesis Collection.
 * Run: pnpm --filter @unipad/web exec tsx scripts/repair-cover-urls.mts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

loadEnv(resolve(process.cwd(), "../../.env"));
loadEnv(resolve(process.cwd(), ".env.local"));
loadEnv(resolve(process.cwd(), ".env"));

const base = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(
  /\/$/,
  "",
);
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!base || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");

const headers: Record<string, string> = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const FIXES: Record<string, string> = {
  // Exact file Everest uploaded ~17s before publishing Hdoanh (orphaned by a bad cover link overwrite).
  "col-hdoanh":
    `${base}/storage/v1/object/public/unipad-media/covers/1786437540987-wqm13q.png`,
  // Genesis used a Google-search wrapper; unwrap to the Unsplash image in that link.
  "col-genesis-collection":
    "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1600&q=85",
};

const PATHS = [
  "listings/collections/col-hdoanh.json",
  "listings/creators/0353aa6695fcad949ad8120a76e37d77d6784e50e641fb8720983daf34de0a4b5a/col-hdoanh.json",
  "mints/tokens/col-hdoanh/1.json",
  "mints/wallets/0353aa6695fcad949ad8120a76e37d77d6784e50e641fb8720983daf34de0a4b5a/col-hdoanh-1.json",
  "listings/collections/col-genesis-collection.json",
  "listings/creators/0213e941a222e522de3ed30232205a7b63e8b55211149ffe1c09e35a9cb2ee977b/col-genesis-collection.json",
  "mints/tokens/col-genesis-collection/1.json",
  "mints/wallets/0213e941a222e522de3ed30232205a7b63e8b55211149ffe1c09e35a9cb2ee977b/col-genesis-collection-1.json",
];

function fixForPath(pathname: string, body: Record<string, unknown>): string | null {
  const id = String(body.collectionId || body.id || "");
  if (pathname.includes("hdoanh") || id.includes("hdoanh")) return FIXES["col-hdoanh"]!;
  if (pathname.includes("genesis") || id.includes("genesis")) {
    return FIXES["col-genesis-collection"]!;
  }
  return null;
}

async function getByPath(pathname: string) {
  const url =
    `${base}/rest/v1/unipad_objects?pathname=eq.${encodeURIComponent(pathname)}&select=pathname,body`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`get ${pathname}: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as Array<{ pathname: string; body: unknown }>;
  return rows[0] ?? null;
}

async function put(pathname: string, body: unknown) {
  const res = await fetch(
    `${base}/rest/v1/unipad_objects?pathname=eq.${encodeURIComponent(pathname)}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ body, updated_at: new Date().toISOString() }),
    },
  );
  if (!res.ok) throw new Error(`patch ${pathname}: ${res.status} ${await res.text()}`);
}

for (const pathname of PATHS) {
  const row = await getByPath(pathname);
  if (!row) {
    console.log("MISSING", pathname);
    continue;
  }
  const body = (
    typeof row.body === "string" ? JSON.parse(row.body) : row.body
  ) as Record<string, unknown>;
  const fix = fixForPath(pathname, body);
  if (!fix) {
    console.log("NO FIX", pathname);
    continue;
  }
  const before = body.coverUrl;
  body.coverUrl = fix;
  await put(pathname, body);
  console.log("FIXED", pathname);
  console.log("  from:", before);
  console.log("  to:  ", fix);
}

const regRow = await getByPath("listings/public-registry.json");
if (regRow) {
  const reg = (
    typeof regRow.body === "string" ? JSON.parse(regRow.body) : regRow.body
  ) as { byId?: Record<string, { coverUrl?: string | null }> };
  for (const [id, cover] of Object.entries(FIXES)) {
    if (reg.byId?.[id]) {
      console.log("REGISTRY", id, reg.byId[id].coverUrl, "->", cover);
      reg.byId[id].coverUrl = cover;
    }
  }
  await put("listings/public-registry.json", reg);
  console.log("FIXED public-registry");
}

for (const id of Object.keys(FIXES)) {
  const row = await getByPath(`listings/collections/${id}.json`);
  const body = (
    typeof row!.body === "string" ? JSON.parse(row!.body as string) : row!.body
  ) as { coverUrl?: string };
  console.log("VERIFY", id, body.coverUrl);
}

/**
 * Sync minted Signal Genesis token covers to the current catalog artwork.
 * Run: pnpm --filter @unipad/web exec tsx scripts/repair-signal-genesis-covers.mts
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

const COVER = "/covers/signal-genesis.png";
const headers: Record<string, string> = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function listSignalPaths(): Promise<string[]> {
  const url =
    `${base}/rest/v1/unipad_objects?or=(pathname.like.mints/tokens/col-signal-001/*,pathname.like.mints/wallets/*/col-signal-001-*)&select=pathname`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`list failed: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as Array<{ pathname: string }>;
  return rows.map((r) => r.pathname);
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

const paths = await listSignalPaths();
console.log("found", paths.length, "signal-001 mint objects");

for (const pathname of paths) {
  const row = await getByPath(pathname);
  if (!row) continue;
  const body = (
    typeof row.body === "string" ? JSON.parse(row.body) : row.body
  ) as Record<string, unknown>;
  const before = body.coverUrl;
  if (before === COVER) {
    console.log("ok", pathname);
    continue;
  }
  body.coverUrl = COVER;
  await put(pathname, body);
  console.log("FIXED", pathname);
  console.log("  from:", before);
  console.log("  to:  ", COVER);
}

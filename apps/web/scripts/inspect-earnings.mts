/**
 * Inspect earnings ledger (and optional mark-paid for a creator).
 *   pnpm exec tsx scripts/inspect-earnings.mts [principalHex]
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

async function main() {
  const filter = (process.argv[2] || "").trim().toLowerCase();
  const { listPathnames, getJson } = await import("../src/lib/objectStore.ts");
  const { getCreatorEarnings } = await import("../src/lib/earningsStore.ts");

  const paths = await listPathnames("earnings/");
  console.log("paths", paths.length);
  for (const p of paths) {
    const body = await getJson(p.pathname);
    const creator = (body as { creatorPrincipal?: string })?.creatorPrincipal || "";
    if (filter && !p.pathname.includes(filter) && !creator.includes(filter)) continue;
    console.log(p.pathname, JSON.stringify(body));
  }

  if (filter && /^[0-9a-f]{66}$/.test(filter)) {
    console.log("summary", await getCreatorEarnings(filter));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

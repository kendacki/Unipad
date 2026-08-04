/**
 * Inspect / backfill earnings for a collection (e.g. col-tellebubs).
 *   pnpm exec tsx scripts/backfill-mint-earnings.mts [collectionIdOrSlug]
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
  const key = (process.argv[2] || "tellebubs").trim();
  const { listJsonUnder, listPathnames, getJson } = await import("../src/lib/objectStore.ts");
  const { getResolvedCollection, getStoredListing } = await import("../src/lib/listingStore.ts");
  const { recordMintSale, getCreatorEarnings } = await import("../src/lib/earningsStore.ts");

  const listing =
    (await getStoredListing(key)) ||
    (await getResolvedCollection(key));
  if (!listing) throw new Error(`collection not found: ${key}`);

  const id = listing.id;
  const creator = listing.creatorPrincipal;
  console.log("collection", {
    id,
    slug: listing.slug,
    name: listing.name,
    creator,
    price: listing.activePhase?.priceUct || listing.phases?.[0]?.priceUct,
  });

  const tokens = await listJsonUnder<{
    collectionId: string;
    tokenId: number;
    ownerPrincipal: string;
    idempotencyKey?: string;
    paymentRef?: string;
    mintTxRef?: string;
  }>(`mints/tokens/${id}/`);
  console.log("tokens", tokens.length, tokens);

  const earnPaths = await listPathnames("earnings/");
  console.log(
    "earnings paths sample",
    earnPaths.map((p) => p.pathname).slice(0, 40),
  );

  const price =
    listing.activePhase?.priceUct ||
    listing.phases?.[0]?.priceUct ||
    "0";

  const recorded: unknown[] = [];
  for (const t of tokens) {
    const saleId =
      t.idempotencyKey ||
      t.paymentRef ||
      t.mintTxRef ||
      `${id}-${t.tokenId}`;
    const sale = await recordMintSale({
      creatorPrincipal: creator,
      collectionId: id,
      collectionName: listing.name,
      saleId,
      grossUct: price,
      buyerPrincipal: t.ownerPrincipal,
      tokenId: t.tokenId,
    });
    recorded.push(sale);
  }

  const earnings = await getCreatorEarnings(creator);
  console.log(
    JSON.stringify(
      {
        recorded,
        summary: earnings.summary,
        entries: earnings.entries,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error("FAIL", e instanceof Error ? e.message : e);
  process.exit(1);
});

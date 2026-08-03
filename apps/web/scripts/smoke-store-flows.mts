/**
 * Smoke-test publish / mint-ledger NFT transfer / earnings against Supabase.
 * Run from apps/web with .env.local loaded:
 *   pnpm exec tsx scripts/smoke-store-flows.mts
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
  const {
    isPersistentStoreConfigured,
    usesSupabaseStore,
    putJson,
    getJson,
    listJsonUnder,
    removeObject,
    putJsonExclusive,
    uploadMediaFile,
  } = await import("../src/lib/objectStore.ts");
  const {
    createListing,
    publishListing,
    listPublicCollections,
    getResolvedCollection,
  } = await import("../src/lib/listingStore.ts");
  const { transferToken, listWalletTokens } = await import("../src/lib/mintStore.ts");
  const { recordMintSale, getCreatorEarnings, applyCreatorPayout } = await import(
    "../src/lib/earningsStore.ts"
  );

  if (!isPersistentStoreConfigured()) throw new Error("persistent store not configured");
  if (!usesSupabaseStore()) throw new Error("expected Supabase store to be active");

  const stamp = Date.now().toString(36);
  const principal = "02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const recipient = "03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const slug = `smoke-${stamp}`;
  const results: string[] = [];

  // --- objectStore exclusive write ---
  const exclusivePath = `mints/reservations/smoke/${stamp}.json`;
  await putJsonExclusive(exclusivePath, { ok: true });
  let exclusiveFailed = false;
  try {
    await putJsonExclusive(exclusivePath, { ok: false });
  } catch {
    exclusiveFailed = true;
  }
  if (!exclusiveFailed) throw new Error("putJsonExclusive should reject duplicates");
  await removeObject(exclusivePath);
  results.push("objectStore exclusive ok");

  // --- media upload ---
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const media = await uploadMediaFile({
    filename: `smoke-${stamp}.png`,
    bytes: png,
    contentType: "image/png",
  });
  if (!media.url?.startsWith("http")) throw new Error("media url missing");
  results.push(`media upload ok (${media.url.slice(0, 48)}…)`);

  // --- publish flow ---
  const draft = await createListing(principal, {
    name: `Smoke Drop ${stamp}`,
    slug,
    description: "smoke test drop",
    totalSupply: 5,
    royaltyBps: 250,
    creatorDisplayName: "@smoke",
    coverUrl: media.url,
    phases: [
      {
        type: "public",
        name: "Public",
        priceUct: "1000000000000000000",
        maxPerWallet: 2,
      },
    ],
  });
  if (draft.status !== "draft") throw new Error("expected draft");

  const published = await publishListing(principal, draft.id);
  if (published.status !== "live") throw new Error(`expected live, got ${published.status}`);

  const listed = await listPublicCollections("all");
  if (!listed.some((c) => c.id === published.id)) {
    throw new Error("published drop missing from public list");
  }
  const resolved = await getResolvedCollection(slug);
  if (!resolved || resolved.status === "draft") {
    throw new Error("resolved collection missing/draft");
  }
  results.push("publish + listPublicCollections ok");

  // --- NFT ledger transfer ---
  const tokenPath = `mints/tokens/${published.id}/1.json`;
  const walletPath = `mints/wallets/${encodeURIComponent(principal).slice(0, 120)}/${published.id}-1.json`;
  const tokenRow = {
    collectionId: published.id,
    collectionName: published.name,
    slug: published.slug,
    coverUrl: published.coverUrl,
    tokenId: 1,
    ownerPrincipal: principal,
    mintTxRef: `smoke:${stamp}`,
    paymentRef: `smoke-pay:${stamp}`,
    mintedAt: new Date().toISOString(),
    idempotencyKey: `smoke-key-${stamp}`,
  };
  await putJson(tokenPath, tokenRow);
  await putJson(walletPath, tokenRow);

  const before = await listWalletTokens(principal);
  if (!before.some((t) => t.collectionId === published.id && t.tokenId === 1)) {
    throw new Error("mint not visible in sender wallet before transfer");
  }

  const moved = await transferToken({
    fromPrincipal: principal,
    collectionId: published.id,
    tokenId: 1,
    toRecipient: recipient,
  });
  if (moved.ownerPrincipal !== recipient) throw new Error("transfer owner mismatch");

  const afterSender = await listWalletTokens(principal);
  if (afterSender.some((t) => t.collectionId === published.id && t.tokenId === 1)) {
    throw new Error("mint still in sender wallet after transfer");
  }
  const afterRecipient = await listWalletTokens(recipient);
  if (!afterRecipient.some((t) => t.collectionId === published.id && t.tokenId === 1)) {
    throw new Error("mint missing from recipient wallet after transfer");
  }
  results.push("NFT transfer + inventory ok");

  // --- earnings ledger (UCT payout recording after Sphere send) ---
  const sale = await recordMintSale({
    creatorPrincipal: principal,
    collectionId: published.id,
    collectionName: published.name,
    saleId: `smoke-sale-${stamp}`,
    grossUct: "2000000000000000000",
    buyerPrincipal: recipient,
    tokenId: 1,
  });
  if (!sale) throw new Error("recordMintSale returned null");

  const beforeEarn = await getCreatorEarnings(principal);
  if (BigInt(beforeEarn.summary.accruedUct || "0") <= 0n) {
    throw new Error("expected accrued earnings");
  }

  const payout = await applyCreatorPayout(principal, {
    amountUct: beforeEarn.summary.accruedUct,
    recipient: "@smoke-recipient",
    paymentRef: `sphere-smoke:${stamp}`,
    senderNametag: "@smoke",
  });
  if (BigInt(payout.paidUct || "0") <= 0n) throw new Error("payout paidUct empty");
  if (BigInt(payout.summary.accruedUct || "0") !== 0n) {
    throw new Error("expected accrued cleared after full payout");
  }
  results.push("earnings record + payout ledger ok");

  // cleanup smoke listing rows (best-effort)
  const paths = [
    `listings/collections/${published.id}.json`,
    `listings/slugs/${slug}.json`,
    `listings/creators/${encodeURIComponent(principal).slice(0, 120)}/${published.id}.json`,
    tokenPath,
    `mints/wallets/${encodeURIComponent(recipient).slice(0, 120)}/${published.id}-1.json`,
  ];
  for (const p of paths) {
    try {
      await removeObject(p);
    } catch {
      /* ignore */
    }
  }
  // leave public-registry entry; next publish overwrites / list tolerates orphans

  console.log(JSON.stringify({ ok: true, store: "supabase", results }, null, 2));
}

main().catch((e) => {
  console.error("SMOKE_FAIL", e instanceof Error ? e.message : e);
  process.exit(1);
});

/**
 * Seller earnings ledger for primary mint sales.
 * Gross mint price → 2.5% platform fee (@cryptzarr) → remainder credited to seller.
 */
import { list, put } from "@vercel/blob";
import { nanoid } from "nanoid";
import type { RoyaltyEntry, RoyaltySummary } from "@unipad/shared";

export type StoredSale = RoyaltyEntry & {
  creatorPrincipal: string;
  buyerPrincipal: string;
  tokenId: number;
};

type MemoryDb = {
  byId: Map<string, StoredSale>;
};

declare global {
  // eslint-disable-next-line no-var
  var __unipadEarningsMemory: MemoryDb | undefined;
}

function memory(): MemoryDb {
  if (!globalThis.__unipadEarningsMemory) {
    globalThis.__unipadEarningsMemory = { byId: new Map() };
  }
  return globalThis.__unipadEarningsMemory;
}

function useBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function platformFeeBps(): number {
  const n = Number(process.env.PLATFORM_FEE_BPS ?? 250);
  if (!Number.isFinite(n) || n < 0 || n > 10_000) return 250;
  return Math.floor(n);
}

export function splitMintProceeds(grossUct: string, feeBps = platformFeeBps()) {
  const gross = BigInt(grossUct || "0");
  if (gross < 0n) throw new Error("Invalid gross");
  const platformFeeUct = (gross * BigInt(feeBps)) / 10000n;
  const creatorNetUct = gross - platformFeeUct;
  return {
    grossUct: gross.toString(),
    platformFeeUct: platformFeeUct.toString(),
    creatorNetUct: creatorNetUct.toString(),
    feeBps,
  };
}

function salePath(id: string) {
  return `earnings/sales/${id}.json`;
}

function creatorSalePath(principal: string, id: string) {
  const safe = encodeURIComponent(principal.trim().toLowerCase()).slice(0, 120);
  return `earnings/creators/${safe}/${id}.json`;
}

async function putJson(pathname: string, data: unknown) {
  await put(pathname, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
}

async function listJsonUnder<T>(prefix: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({
      prefix,
      cursor,
      limit: 1000,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    for (const blob of page.blobs) {
      if (!blob.pathname.endsWith(".json")) continue;
      const res = await fetch(blob.url, { cache: "no-store" });
      if (!res.ok) continue;
      out.push((await res.json()) as T);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

async function saveSale(sale: StoredSale) {
  if (!useBlob()) {
    memory().byId.set(sale.id, sale);
    return;
  }
  await putJson(salePath(sale.id), sale);
  await putJson(creatorSalePath(sale.creatorPrincipal, sale.id), sale);
}

export async function recordMintSale(input: {
  creatorPrincipal: string;
  collectionId: string;
  collectionName: string;
  saleId: string;
  grossUct: string;
  buyerPrincipal: string;
  tokenId: number;
}): Promise<StoredSale> {
  const split = splitMintProceeds(input.grossUct);
  const id = `earn-${nanoid(14)}`;
  const sale: StoredSale = {
    id,
    saleId: input.saleId,
    collectionId: input.collectionId,
    collectionName: input.collectionName,
    grossUct: split.grossUct,
    platformFeeUct: split.platformFeeUct,
    creatorNetUct: split.creatorNetUct,
    // Credited to seller earnings balance (net after platform fee).
    payoutStatus: "accrued",
    createdAt: new Date().toISOString(),
    creatorPrincipal: input.creatorPrincipal,
    buyerPrincipal: input.buyerPrincipal,
    tokenId: input.tokenId,
  };
  await saveSale(sale);
  return sale;
}

export async function getCreatorEarnings(principal: string): Promise<{
  summary: RoyaltySummary;
  entries: RoyaltyEntry[];
}> {
  const key = principal.trim().toLowerCase();
  let sales: StoredSale[] = [];

  if (!useBlob()) {
    sales = [...memory().byId.values()].filter(
      (s) => s.creatorPrincipal.trim().toLowerCase() === key,
    );
  } else {
    const safe = encodeURIComponent(key).slice(0, 120);
    sales = await listJsonUnder<StoredSale>(`earnings/creators/${safe}/`);
  }

  sales = sales
    .filter((s) => s && s.id && s.creatorNetUct)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 200);

  let accrued = 0n;
  let paid = 0n;
  let gross = 0n;
  let fees = 0n;
  for (const s of sales) {
    const net = BigInt(s.creatorNetUct || "0");
    gross += BigInt(s.grossUct || "0");
    fees += BigInt(s.platformFeeUct || "0");
    if (s.payoutStatus === "paid") paid += net;
    else accrued += net;
  }

  const entries: RoyaltyEntry[] = sales.map((s) => ({
    id: s.id,
    saleId: s.saleId,
    collectionId: s.collectionId,
    collectionName: s.collectionName,
    grossUct: s.grossUct,
    platformFeeUct: s.platformFeeUct,
    creatorNetUct: s.creatorNetUct,
    payoutStatus: s.payoutStatus,
    createdAt: s.createdAt,
  }));

  return {
    summary: {
      accruedUct: accrued.toString(),
      paidUct: paid.toString(),
      platformFeeBps: platformFeeBps(),
      grossSalesUct: gross.toString(),
      platformFeesUct: fees.toString(),
      saleCount: sales.length,
    },
    entries,
  };
}

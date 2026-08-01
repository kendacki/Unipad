/**
 * Seller earnings ledger for primary mint sales.
 * Uses shared split/summary helpers so storefront + API stay in sync.
 */
import { list, put } from "@vercel/blob";
import { nanoid } from "nanoid";
import {
  DEFAULT_PLATFORM_FEE_BPS,
  normalizePlatformFeeBps,
  splitMintProceeds,
  summarizeRoyaltyLedger,
  type RoyaltyEntry,
  type RoyaltySummary,
} from "@unipad/shared";

export type StoredSale = RoyaltyEntry & {
  creatorPrincipal: string;
  buyerPrincipal: string;
  tokenId: number;
};

type MemoryDb = {
  byId: Map<string, StoredSale>;
  bySaleId: Map<string, string>;
};

declare global {
  // eslint-disable-next-line no-var
  var __unipadEarningsMemory: MemoryDb | undefined;
}

function memory(): MemoryDb {
  if (!globalThis.__unipadEarningsMemory) {
    globalThis.__unipadEarningsMemory = {
      byId: new Map(),
      bySaleId: new Map(),
    };
  }
  return globalThis.__unipadEarningsMemory;
}

function useBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function platformFeeBps(): number {
  return normalizePlatformFeeBps(process.env.PLATFORM_FEE_BPS ?? DEFAULT_PLATFORM_FEE_BPS);
}

function normalizeOwnerKey(principal: string) {
  return principal.trim().toLowerCase();
}

function salePath(id: string) {
  return `earnings/sales/${id}.json`;
}

function saleIdPath(saleId: string) {
  const safe = encodeURIComponent(saleId.trim()).slice(0, 160);
  return `earnings/by-sale/${safe}.json`;
}

function creatorSalePath(principal: string, id: string) {
  const safe = encodeURIComponent(normalizeOwnerKey(principal)).slice(0, 120);
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

async function getJson<T>(pathname: string): Promise<T | null> {
  const { blobs } = await list({
    prefix: pathname,
    limit: 1,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  const hit = blobs.find((b) => b.pathname === pathname);
  if (!hit) return null;
  const res = await fetch(hit.url, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as T;
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
    memory().bySaleId.set(sale.saleId, sale.id);
    return;
  }
  await putJson(salePath(sale.id), sale);
  await putJson(saleIdPath(sale.saleId), { id: sale.id });
  await putJson(creatorSalePath(sale.creatorPrincipal, sale.id), sale);
}

async function findSaleBySaleId(saleId: string): Promise<StoredSale | null> {
  if (!useBlob()) {
    const id = memory().bySaleId.get(saleId);
    return id ? memory().byId.get(id) ?? null : null;
  }
  const ptr = await getJson<{ id: string }>(saleIdPath(saleId));
  if (!ptr?.id) return null;
  return getJson<StoredSale>(salePath(ptr.id));
}

/** Idempotent: one earnings row per mint intent / saleId. */
export async function recordMintSale(input: {
  creatorPrincipal: string;
  collectionId: string;
  collectionName: string;
  saleId: string;
  grossUct: string;
  buyerPrincipal: string;
  tokenId: number;
}): Promise<StoredSale> {
  const existing = await findSaleBySaleId(input.saleId);
  if (existing) return existing;

  const split = splitMintProceeds(input.grossUct, platformFeeBps());
  const id = `earn-${nanoid(14)}`;
  const sale: StoredSale = {
    id,
    saleId: input.saleId,
    collectionId: input.collectionId,
    collectionName: input.collectionName,
    grossUct: split.grossUct,
    platformFeeUct: split.platformFeeUct,
    creatorNetUct: split.creatorNetUct,
    payoutStatus: "accrued",
    createdAt: new Date().toISOString(),
    creatorPrincipal: normalizeOwnerKey(input.creatorPrincipal),
    buyerPrincipal: normalizeOwnerKey(input.buyerPrincipal),
    tokenId: input.tokenId,
  };
  await saveSale(sale);
  return sale;
}

function dedupeSales(sales: StoredSale[]): StoredSale[] {
  const bySale = new Map<string, StoredSale>();
  for (const s of sales) {
    if (!s?.id || !s.saleId || !s.creatorNetUct) continue;
    const prev = bySale.get(s.saleId);
    if (!prev || s.createdAt > prev.createdAt) bySale.set(s.saleId, s);
  }
  return [...bySale.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getCreatorEarnings(principal: string): Promise<{
  summary: RoyaltySummary;
  entries: RoyaltyEntry[];
}> {
  const key = normalizeOwnerKey(principal);
  let sales: StoredSale[] = [];

  if (!useBlob()) {
    sales = [...memory().byId.values()].filter(
      (s) => normalizeOwnerKey(s.creatorPrincipal) === key,
    );
  } else {
    const safe = encodeURIComponent(key).slice(0, 120);
    sales = await listJsonUnder<StoredSale>(`earnings/creators/${safe}/`);
  }

  const all = dedupeSales(sales);
  const summary = summarizeRoyaltyLedger(all, platformFeeBps());

  const entries: RoyaltyEntry[] = all.slice(0, 200).map((s) => ({
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

  return { summary, entries };
}

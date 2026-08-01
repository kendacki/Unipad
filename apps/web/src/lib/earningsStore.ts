/**
 * Seller earnings ledger for primary mint sales.
 * Uses shared split/summary helpers so storefront + API stay in sync.
 */
import { list, put } from "@vercel/blob";
import { nanoid } from "nanoid";
import {
  DEFAULT_PLATFORM_FEE_BPS,
  formatUct,
  normalizePlatformFeeBps,
  normalizeSphereRecipient,
  splitMintProceeds,
  summarizeRoyaltyLedger,
  type RoyaltyEntry,
  type RoyaltySummary,
} from "@unipad/shared";

export type StoredSale = RoyaltyEntry & {
  creatorPrincipal: string;
  buyerPrincipal: string;
  tokenId: number;
  payoutRef?: string | null;
};

export class EarningsHttpError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

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
  memory().byId.set(sale.id, sale);
  memory().bySaleId.set(sale.saleId, sale.id);
  if (!useBlob()) return;
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

/** Idempotent: one earnings row per mint intent / saleId. Seller net only. */
export async function recordMintSale(input: {
  creatorPrincipal: string;
  collectionId: string;
  collectionName: string;
  saleId: string;
  grossUct: string;
  buyerPrincipal: string;
  tokenId: number;
}): Promise<StoredSale | null> {
  const creator = normalizeOwnerKey(input.creatorPrincipal);
  const buyer = normalizeOwnerKey(input.buyerPrincipal);

  // Seed / demo catalog creators are not seller accounts.
  if (!creator || creator.startsWith("mock_")) return null;
  // Self-mints are not seller sales.
  if (creator === buyer) return null;

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
    creatorPrincipal: creator,
    buyerPrincipal: buyer,
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
    const fromBlob = await listJsonUnder<StoredSale>(`earnings/creators/${safe}/`);
    const byId = new Map<string, StoredSale>();
    for (const s of fromBlob) {
      if (s?.id) byId.set(s.id, s);
    }
    for (const s of memory().byId.values()) {
      if (normalizeOwnerKey(s.creatorPrincipal) === key) byId.set(s.id, s);
    }
    sales = [...byId.values()];
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
    paidAt: s.paidAt ?? null,
    payoutRecipient: s.payoutRecipient ?? null,
  }));

  return { summary, entries };
}

/**
 * Pay out accrued sale credits only (earnings ledger — not Sphere wallet balance).
 * Caps amount to accrued UCT from sales; supports partial payout via FIFO split.
 */
export async function applyCreatorPayout(
  principal: string,
  input: {
    amountUct: string;
    recipient: string;
    paymentRef?: string | null;
  },
): Promise<{ summary: RoyaltySummary; entries: RoyaltyEntry[]; paidUct: string }> {
  const key = normalizeOwnerKey(principal);

  // Amount must be a non-negative integer string of base units (no floats / scientific).
  if (!/^\d+$/.test(String(input.amountUct || "").trim())) {
    throw new EarningsHttpError(
      "Payout amount must be a valid UCT value from your earnings balance",
      400,
      "UPAD_VALIDATION",
    );
  }
  let amount: bigint;
  try {
    amount = BigInt(String(input.amountUct).trim());
  } catch {
    throw new EarningsHttpError("Invalid payout amount", 400, "UPAD_VALIDATION");
  }
  if (amount <= 0n) {
    throw new EarningsHttpError("Enter an amount greater than zero", 400, "UPAD_VALIDATION");
  }

  let recipient: string;
  try {
    recipient = normalizeSphereRecipient(input.recipient);
  } catch {
    throw new EarningsHttpError(
      "Recipient must be a Sphere @nametag or wallet",
      400,
      "UPAD_VALIDATION",
    );
  }
  if (normalizeOwnerKey(recipient) === key) {
    throw new EarningsHttpError("Send to a different user", 400, "UPAD_VALIDATION");
  }

  const { summary: before } = await getCreatorEarnings(principal);
  const accrued = BigInt(before.accruedUct || "0");

  if (accrued <= 0n || before.saleCount <= 0) {
    throw new EarningsHttpError(
      "No earnings balance available. Payouts use sales credits only — not your Sphere wallet.",
      400,
      "UPAD_VALIDATION",
    );
  }
  if (amount > accrued) {
    throw new EarningsHttpError(
      `Amount exceeds your earnings balance (${accrued.toString()} base units from sales). Sphere wallet balance cannot be used here.`,
      400,
      "UPAD_VALIDATION",
    );
  }

  const keySafe = encodeURIComponent(key).slice(0, 120);
  let sales: StoredSale[] = [];
  if (!useBlob()) {
    sales = [...memory().byId.values()].filter(
      (s) => normalizeOwnerKey(s.creatorPrincipal) === key,
    );
  } else {
    const fromBlob = await listJsonUnder<StoredSale>(`earnings/creators/${keySafe}/`);
    const byId = new Map<string, StoredSale>();
    for (const s of fromBlob) {
      if (s?.id) byId.set(s.id, s);
    }
    for (const s of memory().byId.values()) {
      if (normalizeOwnerKey(s.creatorPrincipal) === key) byId.set(s.id, s);
    }
    sales = [...byId.values()];
  }

  const accruedSales = dedupeSales(sales)
    .filter((s) => s.payoutStatus !== "paid" && BigInt(s.creatorNetUct || "0") > 0n)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (!accruedSales.length) {
    throw new EarningsHttpError(
      "No credited sales left to pay out",
      400,
      "UPAD_VALIDATION",
    );
  }

  const allocatable = accruedSales.reduce((sum, s) => sum + BigInt(s.creatorNetUct || "0"), 0n);
  if (amount > allocatable) {
    throw new EarningsHttpError(
      "Amount exceeds credited sales available to pay out",
      400,
      "UPAD_VALIDATION",
    );
  }

  let remaining = amount;
  const now = new Date().toISOString();
  const paymentRef =
    input.paymentRef?.trim() || `earnings-ledger:${nanoid(12)}`;

  for (const sale of accruedSales) {
    if (remaining <= 0n) break;
    const net = BigInt(sale.creatorNetUct || "0");
    if (net <= 0n) continue;

    if (remaining >= net) {
      const next: StoredSale = {
        ...sale,
        payoutStatus: "paid",
        paidAt: now,
        payoutRecipient: recipient,
        payoutRef: paymentRef,
      };
      await saveSale(next);
      remaining -= net;
      continue;
    }

    // Partial: mark this slice paid, leave remainder accrued as a new row.
    const paidNet = remaining;
    const leftNet = net - paidNet;
    const feeTotal = BigInt(sale.platformFeeUct || "0");
    const grossTotal = BigInt(sale.grossUct || "0");
    const paidFee = feeTotal > 0n && net > 0n ? (feeTotal * paidNet) / net : 0n;
    const paidGross = paidNet + paidFee;
    const leftFee = feeTotal - paidFee;
    const leftGross = grossTotal - paidGross;

    const paidRow: StoredSale = {
      ...sale,
      id: `${sale.id}-p${nanoid(6)}`,
      saleId: `${sale.saleId}:payout:${nanoid(8)}`,
      grossUct: paidGross.toString(),
      platformFeeUct: paidFee.toString(),
      creatorNetUct: paidNet.toString(),
      payoutStatus: "paid",
      paidAt: now,
      payoutRecipient: recipient,
      payoutRef: paymentRef,
      createdAt: sale.createdAt,
    };
    const leftRow: StoredSale = {
      ...sale,
      grossUct: leftGross > 0n ? leftGross.toString() : "0",
      platformFeeUct: leftFee > 0n ? leftFee.toString() : "0",
      creatorNetUct: leftNet.toString(),
      payoutStatus: "accrued",
      paidAt: null,
      payoutRecipient: null,
      payoutRef: null,
    };
    await saveSale(paidRow);
    await saveSale(leftRow);
    remaining = 0n;
  }

  if (remaining > 0n) {
    throw new EarningsHttpError("Could not allocate full payout amount", 500, "UPAD_UNKNOWN");
  }

  const result = await getCreatorEarnings(principal);
  return { ...result, paidUct: amount.toString() };
}

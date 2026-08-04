/**
 * Seller earnings ledger for primary mint sales + inbound peer payouts.
 * Uses shared split/summary helpers so storefront + API stay in sync.
 * Persists via objectStore (Supabase preferred; Blob fallback).
 *
 * Rules:
 * - Drop sales credit Balance + Earned.
 * - Peer transfers (inbound) credit Balance only — never Earned.
 * - Send payout draws from Balance (sales + inbound accrued).
 */
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
import {
  getJson,
  isPersistentStoreConfigured,
  listJsonUnder,
  putJson,
} from "@/lib/objectStore";

export type StoredSale = RoyaltyEntry & {
  creatorPrincipal: string;
  buyerPrincipal: string;
  tokenId: number;
  payoutRef?: string | null;
  /** Recipient nametag for inbound rows waiting to be claimed by principal. */
  inboundNametag?: string | null;
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
  byPayoutRef: Map<string, string>;
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
      byPayoutRef: new Map(),
    };
  }
  return globalThis.__unipadEarningsMemory;
}

function useBlob(): boolean {
  return isPersistentStoreConfigured();
}

export function platformFeeBps(): number {
  return normalizePlatformFeeBps(process.env.PLATFORM_FEE_BPS ?? DEFAULT_PLATFORM_FEE_BPS);
}

function normalizeOwnerKey(principal: string) {
  return principal.trim().toLowerCase().replace(/^0x/, "");
}

function salePath(id: string) {
  return `earnings/sales/${id}.json`;
}

function saleIdPath(saleId: string) {
  const safe = encodeURIComponent(saleId.trim()).slice(0, 160);
  return `earnings/by-sale/${safe}.json`;
}

function payoutRefPath(paymentRef: string) {
  const safe = encodeURIComponent(paymentRef.trim()).slice(0, 160);
  return `earnings/by-payout-ref/${safe}.json`;
}

function creatorSalePath(principal: string, id: string) {
  const safe = encodeURIComponent(normalizeOwnerKey(principal)).slice(0, 120);
  return `earnings/creators/${safe}/${id}.json`;
}

function inboundPath(nametag: string, id: string) {
  const tag = normalizeSphereRecipient(nametag);
  const safe = encodeURIComponent(tag).slice(0, 120);
  return `earnings/inbound/${safe}/${id}.json`;
}

function inboundPrefix(nametag: string) {
  const tag = normalizeSphereRecipient(nametag);
  const safe = encodeURIComponent(tag).slice(0, 120);
  return `earnings/inbound/${safe}/`;
}

async function saveSale(sale: StoredSale) {
  memory().byId.set(sale.id, sale);
  memory().bySaleId.set(sale.saleId, sale.id);
  if (sale.payoutRef) memory().byPayoutRef.set(sale.payoutRef, sale.id);
  if (!useBlob()) return;
  await putJson(salePath(sale.id), sale);
  await putJson(saleIdPath(sale.saleId), { id: sale.id });
  if (sale.payoutRef) {
    await putJson(payoutRefPath(sale.payoutRef), { id: sale.id });
  }
  if (sale.creatorPrincipal) {
    await putJson(creatorSalePath(sale.creatorPrincipal, sale.id), sale);
  }
  if (sale.entryKind === "inbound" && sale.inboundNametag) {
    await putJson(inboundPath(sale.inboundNametag, sale.id), sale);
  }
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

async function findByPayoutRef(paymentRef: string): Promise<StoredSale | null> {
  const ref = paymentRef.trim();
  if (!ref) return null;
  if (!useBlob()) {
    const id = memory().byPayoutRef.get(ref);
    return id ? memory().byId.get(id) ?? null : null;
  }
  const ptr = await getJson<{ id: string }>(payoutRefPath(ref));
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
    entryKind: "sale",
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

function asEntry(s: StoredSale): RoyaltyEntry {
  return {
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
    payoutSender: s.payoutSender ?? null,
    entryKind: s.entryKind === "inbound" ? "inbound" : "sale",
  };
}

function buildSummary(rows: StoredSale[]): RoyaltySummary {
  const sales = rows.filter((r) => r.entryKind !== "inbound");
  const salesSummary = summarizeRoyaltyLedger(sales, platformFeeBps());
  const allSummary = summarizeRoyaltyLedger(rows, platformFeeBps());
  const earned =
    BigInt(salesSummary.accruedUct || "0") + BigInt(salesSummary.paidUct || "0");
  return {
    // Balance = everything still accrued (sales + received transfers).
    accruedUct: allSummary.accruedUct,
    paidUct: allSummary.paidUct,
    platformFeeBps: salesSummary.platformFeeBps,
    grossSalesUct: salesSummary.grossSalesUct,
    platformFeesUct: salesSummary.platformFeesUct,
    saleCount: salesSummary.saleCount,
    earnedFromSalesUct: earned.toString(),
  };
}

async function loadCreatorRows(principal: string): Promise<StoredSale[]> {
  const key = normalizeOwnerKey(principal);
  if (!useBlob()) {
    return [...memory().byId.values()].filter(
      (s) => normalizeOwnerKey(s.creatorPrincipal) === key,
    );
  }
  const safe = encodeURIComponent(key).slice(0, 120);
  const fromBlob = await listJsonUnder<StoredSale>(`earnings/creators/${safe}/`);
  const byId = new Map<string, StoredSale>();
  for (const s of fromBlob) {
    if (s?.id) byId.set(s.id, s);
  }
  for (const s of memory().byId.values()) {
    if (normalizeOwnerKey(s.creatorPrincipal) === key) byId.set(s.id, s);
  }
  return [...byId.values()];
}

/** Claim inbound nametag credits onto this wallet principal (Balance only). */
async function claimInboundForNametag(
  principal: string,
  nametag: string | null | undefined,
): Promise<StoredSale[]> {
  if (!nametag?.trim() || !useBlob()) return [];
  let tag: string;
  try {
    tag = normalizeSphereRecipient(nametag);
  } catch {
    return [];
  }
  const key = normalizeOwnerKey(principal);
  const pending = await listJsonUnder<StoredSale>(inboundPrefix(tag));
  const claimed: StoredSale[] = [];
  for (const row of pending) {
    if (!row?.id) continue;
    if (row.payoutStatus === "paid") {
      claimed.push({ ...row, creatorPrincipal: row.creatorPrincipal || key });
      continue;
    }
    const next: StoredSale = {
      ...row,
      creatorPrincipal: key,
      inboundNametag: tag,
      entryKind: "inbound",
    };
    await saveSale(next);
    claimed.push(next);
  }
  return claimed;
}

/**
 * Credit a peer payout to the recipient's Balance (not Earned).
 * Keyed by @nametag until they open Earnings while signed in.
 */
export async function creditInboundTransfer(input: {
  recipientNametag: string;
  amountUct: string;
  paymentRef: string;
  senderPrincipal: string;
  senderNametag?: string | null;
}): Promise<StoredSale | null> {
  const amount = BigInt(input.amountUct);
  if (amount <= 0n) return null;
  let tag: string;
  try {
    tag = normalizeSphereRecipient(input.recipientNametag);
  } catch {
    return null;
  }

  const existing = await findByPayoutRef(`inbound:${input.paymentRef}`);
  if (existing) return existing;

  const id = `in-${nanoid(14)}`;
  const saleId = `inbound:${input.paymentRef}`;
  const row: StoredSale = {
    id,
    saleId,
    collectionId: "transfer-in",
    collectionName: "Received transfer",
    grossUct: amount.toString(),
    platformFeeUct: "0",
    creatorNetUct: amount.toString(),
    payoutStatus: "accrued",
    createdAt: new Date().toISOString(),
    creatorPrincipal: "",
    buyerPrincipal: normalizeOwnerKey(input.senderPrincipal),
    tokenId: 0,
    entryKind: "inbound",
    inboundNametag: tag,
    payoutSender: input.senderNametag || null,
    payoutRecipient: tag,
    payoutRef: `inbound:${input.paymentRef}`,
  };
  await saveSale(row);
  return row;
}

export async function getCreatorEarnings(
  principal: string,
  nametag?: string | null,
): Promise<{
  summary: RoyaltySummary;
  entries: RoyaltyEntry[];
}> {
  const key = normalizeOwnerKey(principal);
  const claimed = await claimInboundForNametag(key, nametag);
  let sales = await loadCreatorRows(key);
  if (claimed.length) {
    const byId = new Map(sales.map((s) => [s.id, s]));
    for (const c of claimed) byId.set(c.id, c);
    sales = [...byId.values()];
  }

  const all = dedupeSales(sales);
  const summary = buildSummary(all);
  const entries: RoyaltyEntry[] = all.slice(0, 200).map(asEntry);
  return { summary, entries };
}

/**
 * Mark accrued credits paid after a successful Sphere UCT send to the recipient.
 * Caps amount to Balance (sales + received transfers); supports partial payout via FIFO.
 */
export async function applyCreatorPayout(
  principal: string,
  input: {
    amountUct: string;
    recipient: string;
    paymentRef?: string | null;
    /** Seller Sphere @nametag for transaction description (not the drop name). */
    senderNametag?: string | null;
  },
): Promise<{ summary: RoyaltySummary; entries: RoyaltyEntry[]; paidUct: string }> {
  const key = normalizeOwnerKey(principal);

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

  let payoutSender: string | null = null;
  if (input.senderNametag?.trim()) {
    try {
      payoutSender = normalizeSphereRecipient(input.senderNametag);
    } catch {
      const raw = input.senderNametag.trim();
      payoutSender = raw.startsWith("@") ? raw : `@${raw}`;
    }
  }

  const paymentRef = input.paymentRef?.trim();
  if (!paymentRef) {
    throw new EarningsHttpError(
      "Sphere payment required before recording payout",
      400,
      "UPAD_PAYMENT_REQUIRED",
    );
  }

  // Idempotent retry after Sphere already moved funds.
  const prior = await findByPayoutRef(paymentRef);
  if (prior) {
    const result = await getCreatorEarnings(principal, payoutSender);
    return { ...result, paidUct: amount.toString() };
  }

  await claimInboundForNametag(key, payoutSender);

  const { summary: before } = await getCreatorEarnings(principal, payoutSender);
  const accrued = BigInt(before.accruedUct || "0");

  if (accrued <= 0n) {
    throw new EarningsHttpError(
      "No earnings balance available. Payouts use Balance credits only — not your Sphere wallet.",
      400,
      "UPAD_VALIDATION",
    );
  }
  if (amount > accrued) {
    throw new EarningsHttpError(
      `Amount exceeds your earnings balance of ${formatUct(accrued.toString())} UCT.`,
      400,
      "UPAD_VALIDATION",
    );
  }

  let sales = await loadCreatorRows(key);
  const accruedRows = dedupeSales(sales)
    .filter((s) => s.payoutStatus !== "paid" && BigInt(s.creatorNetUct || "0") > 0n)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (!accruedRows.length) {
    throw new EarningsHttpError(
      "No credited balance left to pay out",
      400,
      "UPAD_VALIDATION",
    );
  }

  const allocatable = accruedRows.reduce((sum, s) => sum + BigInt(s.creatorNetUct || "0"), 0n);
  if (amount > allocatable) {
    throw new EarningsHttpError(
      "Amount exceeds credited balance available to pay out",
      400,
      "UPAD_VALIDATION",
    );
  }

  let remaining = amount;
  const now = new Date().toISOString();

  for (const sale of accruedRows) {
    if (remaining <= 0n) break;
    const net = BigInt(sale.creatorNetUct || "0");
    if (net <= 0n) continue;
    const isInbound = sale.entryKind === "inbound";

    if (remaining >= net) {
      const next: StoredSale = {
        ...sale,
        payoutStatus: "paid",
        paidAt: now,
        payoutRecipient: recipient,
        payoutSender,
        payoutRef: paymentRef,
      };
      await saveSale(next);
      remaining -= net;
      continue;
    }

    const paidNet = remaining;
    const leftNet = net - paidNet;
    const feeTotal = BigInt(sale.platformFeeUct || "0");
    const grossTotal = BigInt(sale.grossUct || "0");
    const paidFee = !isInbound && feeTotal > 0n && net > 0n ? (feeTotal * paidNet) / net : 0n;
    const paidGross = isInbound ? paidNet : paidNet + paidFee;
    const leftFee = feeTotal - paidFee;
    const leftGross = isInbound ? leftNet : grossTotal - paidGross;

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
      payoutSender,
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
      payoutRecipient: isInbound ? sale.payoutRecipient : null,
      payoutSender: isInbound ? sale.payoutSender : null,
      payoutRef: null,
    };
    await saveSale(paidRow);
    await saveSale(leftRow);
    remaining = 0n;
  }

  if (remaining > 0n) {
    throw new EarningsHttpError("Could not allocate full payout amount", 500, "UPAD_UNKNOWN");
  }

  // Recipient Balance credit (never Earned) — claimable when they open Earnings.
  try {
    await creditInboundTransfer({
      recipientNametag: recipient,
      amountUct: amount.toString(),
      paymentRef,
      senderPrincipal: key,
      senderNametag: payoutSender,
    });
  } catch (err) {
    console.error("creditInboundTransfer failed", err);
  }

  const result = await getCreatorEarnings(principal, payoutSender);
  return { ...result, paidUct: amount.toString() };
}

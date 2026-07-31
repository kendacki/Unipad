/**
 * Serverless mint settlement for the Vercel storefront.
 * Persists intents + ledger in Vercel Blob when configured; otherwise in-memory
 * (local Next without BLOB_READ_WRITE_TOKEN).
 */
import { del, list, put } from "@vercel/blob";
import { nanoid } from "nanoid";
import {
  DEFAULT_TREASURY_PRINCIPAL,
  UCT_COIN_ID,
  normalizeSphereRecipient,
  type Collection,
  type MintIntentResponse,
  type MintResult,
  type MintStatus,
} from "@unipad/shared";
import { getCatalogCollection } from "@/lib/catalog";

export type StoredIntent = {
  idempotencyKey: string;
  collectionId: string;
  phaseId: string;
  walletPrincipal: string;
  priceUct: string;
  paymentMemo: string;
  status: MintStatus;
  expiresAt: string;
  paymentRef?: string;
  tokenId?: number;
  mintTxRef?: string;
  reason?: string;
  createdAt: string;
};

export type StoredToken = {
  collectionId: string;
  collectionName: string;
  slug: string;
  coverUrl: string | null;
  tokenId: number;
  ownerPrincipal: string;
  mintTxRef: string;
  paymentRef: string;
  mintedAt: string;
  idempotencyKey: string;
};

type MemoryDb = {
  intents: Map<string, StoredIntent>;
  tokens: Map<string, StoredToken>;
  payments: Map<string, string>;
};

declare global {
  // eslint-disable-next-line no-var
  var __unipadMintMemory: MemoryDb | undefined;
}

function memory(): MemoryDb {
  if (!globalThis.__unipadMintMemory) {
    globalThis.__unipadMintMemory = {
      intents: new Map(),
      tokens: new Map(),
      payments: new Map(),
    };
  }
  return globalThis.__unipadMintMemory;
}

function useBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function assertPersistentLedger() {
  if (process.env.VERCEL && !useBlob()) {
    throw new MintHttpError(
      "Mint storage is not configured on this deployment",
      503,
      "UPAD_UNAVAILABLE",
    );
  }
}

const CHAIN_PUBKEY_RE = /^[0-9a-f]{66}$/i;

/** Recipient for Unipad ledger transfers: 66-hex chain pubkey or @nametag. */
export function normalizeTransferRecipient(raw: string): string {
  const value = raw.trim();
  if (!value) {
    throw new MintHttpError("Recipient required", 400, "UPAD_VALIDATION");
  }
  if (CHAIN_PUBKEY_RE.test(value)) return value.toLowerCase();
  if (/^[0-9a-f]{64}$/i.test(value)) {
    throw new MintHttpError(
      "Use the full 66-char Sphere chain pubkey (starts with 02 or 03)",
      400,
      "UPAD_VALIDATION",
    );
  }
  const tag = normalizeSphereRecipient(value);
  if (!tag.startsWith("@") || tag.length < 4 || tag.length > 34) {
    throw new MintHttpError(
      "Recipient must be a @nametag (e.g. @alice) or a 66-char chain pubkey",
      400,
      "UPAD_VALIDATION",
    );
  }
  return tag;
}

function ownersMatch(
  storedOwner: string,
  principal: string,
  nametag?: string | null,
): boolean {
  const stored = storedOwner.trim();
  const owner = normalizePrincipal(principal);
  if (normalizePrincipal(stored) === owner) return true;
  if (!nametag) return false;
  try {
    return normalizeSphereRecipient(stored) === normalizeSphereRecipient(nametag);
  } catch {
    return false;
  }
}

function dedupeTokens(tokens: StoredToken[]): StoredToken[] {
  const map = new Map<string, StoredToken>();
  for (const t of tokens) {
    map.set(`${t.collectionId}:${t.tokenId}`, t);
  }
  return [...map.values()].sort((a, b) => b.mintedAt.localeCompare(a.mintedAt));
}

function treasuryPrincipal(): string {
  return normalizeSphereRecipient(
    process.env.TREASURY_PRINCIPAL?.trim() || DEFAULT_TREASURY_PRINCIPAL,
  );
}

function uctCoinIdHex(): string {
  const configured = process.env.NEXT_PUBLIC_UCT_COIN_ID?.trim().toLowerCase();
  if (configured && /^[0-9a-f]{64}$/.test(configured)) return configured;
  return UCT_COIN_ID;
}

function intentPath(key: string) {
  return `mints/intents/${key}.json`;
}

function tokenPath(collectionId: string, tokenId: number) {
  return `mints/tokens/${collectionId}/${tokenId}.json`;
}

function paymentPath(paymentRef: string) {
  const safe = encodeURIComponent(paymentRef).slice(0, 180);
  return `mints/payments/${safe}.json`;
}

function walletTokenPath(principal: string, collectionId: string, tokenId: number) {
  const safe = encodeURIComponent(principal.toLowerCase()).slice(0, 120);
  return `mints/wallets/${safe}/${collectionId}-${tokenId}.json`;
}

function normalizePrincipal(principal: string) {
  return principal.trim().toLowerCase();
}

async function putJson(pathname: string, data: unknown, opts?: { overwrite?: boolean }) {
  await put(pathname, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: opts?.overwrite ?? true,
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

export class MintHttpError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function countMinted(collectionId: string): Promise<number> {
  if (!useBlob()) {
    let n = 0;
    for (const t of memory().tokens.values()) {
      if (t.collectionId === collectionId) n += 1;
    }
    return n;
  }
  let n = 0;
  let cursor: string | undefined;
  do {
    const page = await list({
      prefix: `mints/tokens/${collectionId}/`,
      cursor,
      limit: 1000,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    n += page.blobs.filter((b) => b.pathname.endsWith(".json")).length;
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return n;
}

export async function withLiveSupply(collection: Collection): Promise<Collection> {
  const mintedCount = await countMinted(collection.id);
  const remainingSupply = Math.max(0, collection.totalSupply - mintedCount);
  let status = collection.status;
  if (remainingSupply === 0 && mintedCount > 0) status = "sold_out";
  return { ...collection, mintedCount, remainingSupply, status };
}

async function countOwned(collectionId: string, walletPrincipal: string): Promise<number> {
  const tokens = await listWalletTokens(walletPrincipal);
  return tokens.filter((t) => t.collectionId === collectionId).length;
}

async function saveIntent(intent: StoredIntent) {
  if (!useBlob()) {
    memory().intents.set(intent.idempotencyKey, intent);
    return;
  }
  await putJson(intentPath(intent.idempotencyKey), intent, { overwrite: true });
}

async function loadIntent(key: string): Promise<StoredIntent | null> {
  if (!useBlob()) return memory().intents.get(key) ?? null;
  return getJson<StoredIntent>(intentPath(key));
}

async function paymentUsed(paymentRef: string): Promise<boolean> {
  if (!useBlob()) return memory().payments.has(paymentRef);
  const existing = await getJson<{ idempotencyKey: string }>(paymentPath(paymentRef));
  return Boolean(existing);
}

async function markPayment(paymentRef: string, idempotencyKey: string) {
  if (!useBlob()) {
    if (memory().payments.has(paymentRef)) {
      throw new MintHttpError("paymentRef already used", 409, "UPAD_PAYMENT_USED");
    }
    memory().payments.set(paymentRef, idempotencyKey);
    return;
  }
  try {
    await putJson(
      paymentPath(paymentRef),
      { paymentRef, idempotencyKey, createdAt: new Date().toISOString() },
      { overwrite: false },
    );
  } catch {
    throw new MintHttpError("paymentRef already used", 409, "UPAD_PAYMENT_USED");
  }
}

async function saveToken(token: StoredToken) {
  if (!useBlob()) {
    memory().tokens.set(`${token.collectionId}:${token.tokenId}`, token);
    return;
  }
  await putJson(tokenPath(token.collectionId, token.tokenId), token, { overwrite: false });
  await putJson(
    walletTokenPath(token.ownerPrincipal, token.collectionId, token.tokenId),
    token,
    { overwrite: true },
  );
}

async function loadToken(collectionId: string, tokenId: number): Promise<StoredToken | null> {
  if (!useBlob()) {
    return memory().tokens.get(`${collectionId}:${tokenId}`) ?? null;
  }
  return getJson<StoredToken>(tokenPath(collectionId, tokenId));
}

async function removeWalletIndex(owner: string, collectionId: string, tokenId: number) {
  if (!useBlob()) return;
  const pathname = walletTokenPath(owner, collectionId, tokenId);
  try {
    await del(pathname, { token: process.env.BLOB_READ_WRITE_TOKEN });
  } catch {
    /* index may already be gone */
  }
}

export async function createMintIntent(
  walletPrincipal: string,
  collectionIdOrSlug: string,
): Promise<MintIntentResponse> {
  assertPersistentLedger();
  const principal = normalizePrincipal(walletPrincipal);
  const base = getCatalogCollection(collectionIdOrSlug);
  if (!base) throw new MintHttpError("Collection not found", 404, "UPAD_NOT_FOUND");

  const collection = await withLiveSupply(base);
  if (collection.status !== "live") {
    throw new MintHttpError(
      collection.status === "scheduled" ? "Minting has not opened yet" : "Collection is not mintable",
      400,
      collection.status === "scheduled" ? "UPAD_NO_PHASE" : "UPAD_NOT_MINTABLE",
    );
  }
  if (collection.remainingSupply <= 0) {
    throw new MintHttpError("Sold out", 409, "UPAD_SOLD_OUT");
  }

  const phase = collection.activePhase ?? collection.phases[0];
  if (!phase) throw new MintHttpError("No active mint phase", 400, "UPAD_NO_PHASE");

  const owned = await countOwned(collection.id, principal);
  if (owned >= phase.maxPerWallet) {
    throw new MintHttpError("Wallet mint cap reached for this phase", 403, "UPAD_MINT_CAP");
  }

  const idempotencyKey = nanoid(28);
  const paymentMemo = `unipad:${idempotencyKey}`;
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const intent: StoredIntent = {
    idempotencyKey,
    collectionId: collection.id,
    phaseId: phase.id,
    walletPrincipal: principal,
    priceUct: phase.priceUct,
    paymentMemo,
    status: "awaiting_payment",
    expiresAt,
    createdAt: new Date().toISOString(),
  };

  await saveIntent(intent);

  return {
    idempotencyKey,
    collectionId: collection.id,
    phaseId: phase.id,
    priceUct: phase.priceUct,
    payment: {
      coinId: "UCT",
      coinIdHex: uctCoinIdHex(),
      amount: phase.priceUct,
      recipient: treasuryPrincipal(),
      memo: paymentMemo,
    },
    expiresAt,
    nonce: nanoid(16),
  };
}

export async function submitMint(params: {
  walletPrincipal: string;
  collectionIdOrSlug: string;
  idempotencyKey: string;
  paymentRef: string;
}): Promise<MintResult> {
  assertPersistentLedger();
  const walletPrincipal = normalizePrincipal(params.walletPrincipal);
  const { collectionIdOrSlug, idempotencyKey, paymentRef } = params;

  const intent = await loadIntent(idempotencyKey);
  if (!intent) throw new MintHttpError("Unknown mint intent", 404, "UPAD_NOT_FOUND");
  if (normalizePrincipal(intent.walletPrincipal) !== walletPrincipal) {
    throw new MintHttpError("Intent belongs to another wallet", 403, "UPAD_FORBIDDEN");
  }
  if (intent.status === "confirmed" && intent.tokenId != null) {
    return {
      status: "confirmed",
      idempotencyKey,
      tokenId: intent.tokenId,
      mintTxRef: intent.mintTxRef,
    };
  }

  if (intent.expiresAt && Date.parse(intent.expiresAt) < Date.now()) {
    throw new MintHttpError("Mint intent expired — tap Mint again", 400, "UPAD_VALIDATION");
  }

  if (!paymentRef?.trim()) {
    throw new MintHttpError("paymentRef required", 400, "UPAD_PAYMENT_REQUIRED");
  }

  const allowMock = process.env.UNIPAD_DEV_MOCK === "true";
  if (paymentRef.startsWith("mock-uct:") && !allowMock) {
    throw new MintHttpError("Mock payments disabled", 400, "UPAD_PAYMENT_MISMATCH");
  }
  if (paymentRef.startsWith("mock-uct:") && !paymentRef.includes(intent.paymentMemo)) {
    throw new MintHttpError("Payment memo mismatch", 400, "UPAD_PAYMENT_MISMATCH");
  }
  if (paymentRef.startsWith("sphere-pending:") && !paymentRef.includes(intent.paymentMemo)) {
    throw new MintHttpError("Payment memo mismatch", 400, "UPAD_PAYMENT_MISMATCH");
  }

  const requested = getCatalogCollection(collectionIdOrSlug);
  const collectionBase = getCatalogCollection(intent.collectionId);
  if (!collectionBase) throw new MintHttpError("Collection not found", 404, "UPAD_NOT_FOUND");
  if (
    requested &&
    requested.id !== collectionBase.id &&
    collectionIdOrSlug !== collectionBase.id &&
    collectionIdOrSlug !== collectionBase.slug
  ) {
    throw new MintHttpError("Collection not found", 404, "UPAD_NOT_FOUND");
  }

  const collection = await withLiveSupply(collectionBase);
  if (collection.remainingSupply <= 0) {
    intent.status = "rejected";
    intent.reason = "sold_out";
    await saveIntent(intent);
    return { status: "rejected", idempotencyKey, reason: "sold_out" };
  }

  if (await paymentUsed(paymentRef)) {
    throw new MintHttpError("paymentRef already used", 409, "UPAD_PAYMENT_USED");
  }

  const phase = collection.activePhase ?? collection.phases[0];
  const owned = await countOwned(collection.id, walletPrincipal);
  if (phase && owned >= phase.maxPerWallet) {
    throw new MintHttpError("Wallet mint cap reached for this phase", 403, "UPAD_MINT_CAP");
  }

  const tokenId = collection.mintedCount + 1;
  const mintTxRef = `uct-mint:${collection.id}:${tokenId}:${nanoid(10)}`;
  const mintedAt = new Date().toISOString();

  const token: StoredToken = {
    collectionId: collection.id,
    collectionName: collection.name,
    slug: collection.slug,
    coverUrl: collection.coverUrl,
    tokenId,
    ownerPrincipal: walletPrincipal,
    mintTxRef,
    paymentRef,
    mintedAt,
    idempotencyKey,
  };

  await markPayment(paymentRef, idempotencyKey);
  try {
    await saveToken(token);
  } catch {
    // Rare race on token path — retry next id once
    const retryId = tokenId + 1;
    if (retryId > collection.totalSupply) {
      throw new MintHttpError("Sold out", 409, "UPAD_SOLD_OUT");
    }
    token.tokenId = retryId;
    token.mintTxRef = `uct-mint:${collection.id}:${retryId}:${nanoid(10)}`;
    await saveToken(token);
  }

  intent.status = "confirmed";
  intent.paymentRef = paymentRef;
  intent.tokenId = token.tokenId;
  intent.mintTxRef = token.mintTxRef;
  await saveIntent(intent);

  return {
    status: "confirmed",
    idempotencyKey,
    tokenId: token.tokenId,
    mintTxRef: token.mintTxRef,
  };
}

export async function getMintStatus(
  idempotencyKey: string,
  walletPrincipal: string,
): Promise<MintResult> {
  const intent = await loadIntent(idempotencyKey);
  if (!intent) throw new MintHttpError("Not found", 404, "UPAD_NOT_FOUND");
  if (normalizePrincipal(intent.walletPrincipal) !== normalizePrincipal(walletPrincipal)) {
    throw new MintHttpError("Forbidden", 403, "UPAD_FORBIDDEN");
  }
  return {
    status: intent.status,
    idempotencyKey,
    tokenId: intent.tokenId,
    mintTxRef: intent.mintTxRef,
    reason: intent.reason,
  };
}

export async function listWalletTokens(
  principal: string,
  opts?: { nametag?: string | null; forceScan?: boolean },
): Promise<StoredToken[]> {
  const owner = normalizePrincipal(principal);
  const nametag = opts?.nametag?.trim() || null;

  if (!useBlob()) {
    return dedupeTokens(
      [...memory().tokens.values()].filter((t) =>
        ownersMatch(t.ownerPrincipal, owner, nametag),
      ),
    );
  }

  const prefixes = new Set<string>();
  prefixes.add(`mints/wallets/${encodeURIComponent(owner).slice(0, 120)}/`);
  if (nametag) {
    try {
      const tag = normalizeSphereRecipient(nametag);
      prefixes.add(`mints/wallets/${encodeURIComponent(tag).slice(0, 120)}/`);
    } catch {
      /* ignore bad nametag */
    }
  }

  let indexed: StoredToken[] = [];
  for (const prefix of prefixes) {
    try {
      indexed = indexed.concat(await listJsonUnder<StoredToken>(prefix));
    } catch {
      /* continue other prefixes */
    }
  }
  indexed = indexed.filter((t) => ownersMatch(t.ownerPrincipal, owner, nametag));

  // Always scan token files for this owner when asked (My mints) or when index empty.
  // Fixes missing wallet-index blobs after successful mint.
  if (opts?.forceScan || indexed.length === 0) {
    let all: StoredToken[] = [];
    try {
      all = await listJsonUnder<StoredToken>("mints/tokens/");
    } catch {
      all = [];
    }
    const owned = all.filter((t) => ownersMatch(t.ownerPrincipal, owner, nametag));
    for (const t of owned) {
      try {
        await putJson(
          walletTokenPath(t.ownerPrincipal, t.collectionId, t.tokenId),
          t,
          { overwrite: true },
        );
      } catch {
        /* best-effort repair */
      }
    }
    return dedupeTokens([...indexed, ...owned]);
  }

  return dedupeTokens(indexed);
}

/**
 * Move Unipad ledger ownership to another wallet (@nametag or chain pubkey).
 * This is launchpad inventory transfer — not an on-chain NFT protocol move.
 */
export async function transferToken(params: {
  fromPrincipal: string;
  fromNametag?: string | null;
  collectionId: string;
  tokenId: number;
  toRecipient: string;
}): Promise<StoredToken> {
  assertPersistentLedger();

  const from = normalizePrincipal(params.fromPrincipal);
  const to = normalizeTransferRecipient(params.toRecipient);
  const tokenId = Number(params.tokenId);

  if (!Number.isInteger(tokenId) || tokenId < 1) {
    throw new MintHttpError("Invalid token id", 400, "UPAD_VALIDATION");
  }
  if (!params.collectionId?.trim()) {
    throw new MintHttpError("collectionId required", 400, "UPAD_VALIDATION");
  }

  if (CHAIN_PUBKEY_RE.test(to) && normalizePrincipal(to) === from) {
    throw new MintHttpError("Cannot transfer to yourself", 400, "UPAD_VALIDATION");
  }
  if (
    params.fromNametag &&
    !CHAIN_PUBKEY_RE.test(to) &&
    normalizeSphereRecipient(params.fromNametag) === to
  ) {
    throw new MintHttpError("Cannot transfer to yourself", 400, "UPAD_VALIDATION");
  }

  const existing = await loadToken(params.collectionId, tokenId);
  if (!existing) {
    throw new MintHttpError("Mint not found", 404, "UPAD_NOT_FOUND");
  }
  if (!ownersMatch(existing.ownerPrincipal, from, params.fromNametag)) {
    throw new MintHttpError("You don’t own this mint", 403, "UPAD_FORBIDDEN");
  }

  const previousOwner = existing.ownerPrincipal;
  const updated: StoredToken = {
    ...existing,
    ownerPrincipal: to,
  };

  if (!useBlob()) {
    memory().tokens.set(`${updated.collectionId}:${updated.tokenId}`, updated);
    return updated;
  }

  await putJson(tokenPath(updated.collectionId, updated.tokenId), updated, {
    overwrite: true,
  });
  await putJson(
    walletTokenPath(updated.ownerPrincipal, updated.collectionId, updated.tokenId),
    updated,
    { overwrite: true },
  );
  if (normalizePrincipal(previousOwner) !== normalizePrincipal(to)) {
    await removeWalletIndex(previousOwner, updated.collectionId, updated.tokenId);
  }

  return updated;
}

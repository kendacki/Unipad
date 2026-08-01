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
import {
  assertAllowlisted,
  getResolvedCollection,
  ListingHttpError,
  pickActivePhase,
} from "@/lib/listingStore";
import { recordMintSale } from "@/lib/earningsStore";

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
  const safe = encodeURIComponent(principal.trim().toLowerCase()).slice(0, 120);
  return `mints/wallets/${safe}/${collectionId}-${tokenId}.json`;
}

function nametagPath(nametag: string) {
  const tag = normalizeSphereRecipient(nametag);
  return `mints/nametags/${encodeURIComponent(tag).slice(0, 120)}.json`;
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
  return {
    ...collection,
    mintedCount,
    remainingSupply,
    status,
    activePhase: pickActivePhase(collection.phases),
  };
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
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  try {
    await del(pathname, { token });
  } catch {
    try {
      const { blobs } = await list({ prefix: pathname, limit: 10, token });
      for (const blob of blobs) {
        if (blob.pathname === pathname || blob.pathname.startsWith(pathname)) {
          await del(blob.url, { token });
        }
      }
    } catch {
      /* best-effort */
    }
  }
}

/** Register Sphere nametag → chain pubkey so transfers can land on hex inventory. */
export async function bindNametag(nametag: string, chainPubkey: string) {
  const tag = normalizeSphereRecipient(nametag);
  const pubkey = normalizePrincipal(chainPubkey);
  if (!tag.startsWith("@") || !CHAIN_PUBKEY_RE.test(pubkey)) return;
  if (!useBlob()) return;
  await putJson(
    nametagPath(tag),
    { nametag: tag, chainPubkey: pubkey, updatedAt: new Date().toISOString() },
    { overwrite: true },
  );
}

async function resolveNametagToPubkey(nametag: string): Promise<string | null> {
  if (!useBlob()) return null;
  const tag = normalizeSphereRecipient(nametag);
  if (!tag.startsWith("@")) return null;
  const row = await getJson<{ chainPubkey?: string }>(nametagPath(tag));
  const pubkey = row?.chainPubkey?.trim().toLowerCase();
  return pubkey && CHAIN_PUBKEY_RE.test(pubkey) ? pubkey : null;
}

/**
 * Resolve transfer recipient to a chain pubkey when we already know the nametag binding.
 * Otherwise keep @nametag (claimed later when the recipient opens My mints).
 */
async function resolveTransferOwner(to: string): Promise<string> {
  if (CHAIN_PUBKEY_RE.test(to)) return to.toLowerCase();
  const resolved = await resolveNametagToPubkey(to);
  return resolved ?? to;
}

/** Move tokens still owned by @nametag onto this wallet’s hex principal. */
export async function claimNametagTokens(
  chainPubkey: string,
  nametag: string | null | undefined,
): Promise<number> {
  if (!nametag?.trim() || !useBlob()) return 0;
  const pubkey = normalizePrincipal(chainPubkey);
  if (!CHAIN_PUBKEY_RE.test(pubkey)) return 0;

  const tag = normalizeSphereRecipient(nametag);
  await bindNametag(tag, pubkey);

  let claimed = 0;
  let all: StoredToken[] = [];
  try {
    all = await listJsonUnder<StoredToken>("mints/tokens/");
  } catch {
    return 0;
  }

  for (const token of all) {
    let storedTag: string;
    try {
      storedTag = normalizeSphereRecipient(token.ownerPrincipal);
    } catch {
      continue;
    }
    if (storedTag !== tag) continue;
    if (normalizePrincipal(token.ownerPrincipal) === pubkey) continue;

    const previousOwner = token.ownerPrincipal;
    const updated: StoredToken = { ...token, ownerPrincipal: pubkey };
    await putJson(tokenPath(updated.collectionId, updated.tokenId), updated, {
      overwrite: true,
    });
    await putJson(
      walletTokenPath(pubkey, updated.collectionId, updated.tokenId),
      updated,
      { overwrite: true },
    );
    await removeWalletIndex(previousOwner, updated.collectionId, updated.tokenId);
    claimed += 1;
  }
  return claimed;
}

export async function createMintIntent(
  walletPrincipal: string,
  collectionIdOrSlug: string,
): Promise<MintIntentResponse> {
  assertPersistentLedger();
  const principal = normalizePrincipal(walletPrincipal);
  const base = await getResolvedCollection(collectionIdOrSlug);
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

  const now = Date.now();
  const timed = collection.phases.filter((p) => {
    const startOk = !p.startsAt || new Date(p.startsAt).getTime() <= now;
    const endOk = !p.endsAt || new Date(p.endsAt).getTime() > now;
    return startOk && endOk;
  });
  const ranked = [...(timed.length ? timed : collection.phases)].sort((a, b) => {
    const rank = (t: string) => (t === "creator" ? 0 : t === "allowlist" ? 1 : 2);
    return rank(a.type) - rank(b.type);
  });

  let phase = null as (typeof collection.phases)[number] | null;
  let phaseCap = 1;
  let lastAllowlistError: ListingHttpError | null = null;
  for (const candidate of ranked) {
    try {
      const al = await assertAllowlisted(collection.id, principal, candidate);
      phase = candidate;
      phaseCap = al ? Math.min(candidate.maxPerWallet, al.maxMints) : candidate.maxPerWallet;
      break;
    } catch (err) {
      if (err instanceof ListingHttpError && err.code === "UPAD_NOT_ALLOWLISTED") {
        lastAllowlistError = err;
        continue;
      }
      if (err instanceof ListingHttpError) {
        throw new MintHttpError(err.message, err.status, err.code);
      }
      throw err;
    }
  }
  if (!phase) {
    if (lastAllowlistError) {
      throw new MintHttpError(
        lastAllowlistError.message,
        lastAllowlistError.status,
        lastAllowlistError.code,
      );
    }
    throw new MintHttpError("No active mint phase", 400, "UPAD_NO_PHASE");
  }

  const owned = await countOwned(collection.id, principal);
  if (owned >= phaseCap) {
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
    try {
      const collection = await getResolvedCollection(intent.collectionId);
      if (collection) {
        await recordMintSale({
          creatorPrincipal: collection.creatorPrincipal,
          collectionId: collection.id,
          collectionName: collection.name,
          saleId: intent.idempotencyKey,
          grossUct: intent.priceUct,
          buyerPrincipal: walletPrincipal,
          tokenId: intent.tokenId,
        });
      }
    } catch {
      // Earnings heal is best-effort; mint is already confirmed.
    }
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

  const requested = await getResolvedCollection(collectionIdOrSlug);
  const collectionBase = await getResolvedCollection(intent.collectionId);
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

  const phase =
    collection.phases.find((p) => p.id === intent.phaseId) ??
    collection.activePhase ??
    collection.phases[0];
  let phaseCap = phase?.maxPerWallet ?? 1;
  if (phase) {
    try {
      const al = await assertAllowlisted(collection.id, walletPrincipal, phase);
      if (al) phaseCap = Math.min(phaseCap, al.maxMints);
    } catch (err) {
      if (err instanceof ListingHttpError) {
        throw new MintHttpError(err.message, err.status, err.code);
      }
      throw err;
    }
  }
  const owned = await countOwned(collection.id, walletPrincipal);
  if (phase && owned >= phaseCap) {
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

  try {
    await recordMintSale({
      creatorPrincipal: collection.creatorPrincipal,
      collectionId: collection.id,
      collectionName: collection.name,
      saleId: intent.idempotencyKey,
      grossUct: intent.priceUct,
      buyerPrincipal: walletPrincipal,
      tokenId: token.tokenId,
    });
  } catch {
    // Mint already settled — earnings ledger is best-effort accounting.
  }

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

  if (nametag && useBlob() && CHAIN_PUBKEY_RE.test(owner)) {
    try {
      await claimNametagTokens(owner, nametag);
    } catch {
      /* claim is best-effort before list */
    }
  }

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
      /* continue */
    }
  }

  // Always include a full token-file scan so stale wallet indexes can't hide transfers.
  let all: StoredToken[] = [];
  try {
    all = await listJsonUnder<StoredToken>("mints/tokens/");
  } catch {
    all = [];
  }

  const byKey = new Map<string, StoredToken>();
  for (const t of [...indexed, ...all]) {
    byKey.set(`${t.collectionId}:${t.tokenId}`, t);
  }

  const owned: StoredToken[] = [];
  for (const t of byKey.values()) {
    // Canonical file is source of truth (wallet index may be stale after transfer).
    const canonical = (await loadToken(t.collectionId, t.tokenId)) ?? t;
    if (!ownersMatch(canonical.ownerPrincipal, owner, nametag)) {
      // Drop stale sender index copies that still sit under this wallet prefix.
      if (
        indexed.some(
          (i) => i.collectionId === t.collectionId && i.tokenId === t.tokenId,
        )
      ) {
        await removeWalletIndex(owner, t.collectionId, t.tokenId);
      }
      continue;
    }
    owned.push(canonical);
    try {
      await putJson(
        walletTokenPath(canonical.ownerPrincipal, canonical.collectionId, canonical.tokenId),
        canonical,
        { overwrite: true },
      );
    } catch {
      /* best-effort index repair */
    }
  }

  return dedupeTokens(owned);
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
  const toRaw = normalizeTransferRecipient(params.toRecipient);
  const to = await resolveTransferOwner(toRaw);
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
    normalizeSphereRecipient(params.fromNametag) === normalizeSphereRecipient(to)
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

  // Always clear sender indexes (hex session + previous owner key / nametag key).
  const removeOwners = new Set<string>([previousOwner, from]);
  if (params.fromNametag) {
    try {
      removeOwners.add(normalizeSphereRecipient(params.fromNametag));
    } catch {
      /* ignore */
    }
  }
  for (const o of removeOwners) {
    if (normalizePrincipal(o) === normalizePrincipal(to)) continue;
    await removeWalletIndex(o, updated.collectionId, updated.tokenId);
  }

  return updated;
}

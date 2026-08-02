/**
 * Serverless mint settlement for the storefront.
 * Persists intents + ledger via objectStore (Supabase preferred; Blob fallback);
 * otherwise in-memory for local Next without persistent env.
 */
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
import {
  getJson,
  isPersistentStoreConfigured,
  listJsonUnder,
  listPathnames,
  putJson as putObjectJson,
  putJsonExclusive,
  removeObject,
} from "@/lib/objectStore";

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
  /** Atomically claimed supply slot held until mint confirms or intent expires. */
  reservedTokenId?: number;
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

type ReservationRow = {
  collectionId: string;
  tokenId: number;
  idempotencyKey: string;
  expiresAt: string;
  createdAt: string;
};

type MemoryDb = {
  intents: Map<string, StoredIntent>;
  tokens: Map<string, StoredToken>;
  payments: Map<string, string>;
  reservations: Map<string, ReservationRow>;
};

declare global {
  // eslint-disable-next-line no-var
  var __unipadMintMemory: MemoryDb | undefined;
  // eslint-disable-next-line no-var
  var __unipadMintClaimLocks: Map<string, Promise<unknown>> | undefined;
}

function memory(): MemoryDb {
  if (!globalThis.__unipadMintMemory) {
    globalThis.__unipadMintMemory = {
      intents: new Map(),
      tokens: new Map(),
      payments: new Map(),
      reservations: new Map(),
    };
  }
  return globalThis.__unipadMintMemory;
}

function claimLocks(): Map<string, Promise<unknown>> {
  if (!globalThis.__unipadMintClaimLocks) {
    globalThis.__unipadMintClaimLocks = new Map();
  }
  return globalThis.__unipadMintClaimLocks;
}

/** Serialize slot claims per collection within one serverless instance. */
async function withCollectionClaimLock<T>(collectionId: string, fn: () => Promise<T>): Promise<T> {
  const locks = claimLocks();
  const prev = locks.get(collectionId) ?? Promise.resolve();
  let release!: () => void;
  const hold = new Promise<void>((r) => {
    release = r;
  });
  const tail = prev.then(() => hold);
  locks.set(collectionId, tail.catch(() => undefined));
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

function useBlob(): boolean {
  return isPersistentStoreConfigured();
}

function assertPersistentLedger() {
  if (process.env.VERCEL && !useBlob()) {
    throw new MintHttpError(
      "Mint storage is not configured (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)",
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

/** True when this wallet owns the row, including @nametag bound to their pubkey. */
async function ownersMatchResolved(
  storedOwner: string,
  principal: string,
  nametag?: string | null,
): Promise<boolean> {
  if (ownersMatch(storedOwner, principal, nametag)) return true;
  const stored = storedOwner.trim();
  if (!stored.startsWith("@")) return false;
  try {
    const bound = await resolveNametagToPubkey(stored);
    return Boolean(bound && bound === normalizePrincipal(principal));
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

function reservationPath(collectionId: string, tokenId: number) {
  return `mints/reservations/${collectionId}/${tokenId}.json`;
}

function reservationMemKey(collectionId: string, tokenId: number) {
  return `${collectionId}:${tokenId}`;
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
  if (opts?.overwrite === false) {
    await putJsonExclusive(pathname, data);
    return;
  }
  await putObjectJson(pathname, data);
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
  const paths = await listPathnames(`mints/tokens/${collectionId}/`);
  return paths.filter((p) => p.pathname.endsWith(".json")).length;
}

async function tokenExists(collectionId: string, tokenId: number): Promise<boolean> {
  if (!useBlob()) {
    return memory().tokens.has(`${collectionId}:${tokenId}`);
  }
  return Boolean(await getJson(tokenPath(collectionId, tokenId)));
}

async function loadReservation(
  collectionId: string,
  tokenId: number,
): Promise<ReservationRow | null> {
  const mem = memory().reservations.get(reservationMemKey(collectionId, tokenId));
  if (!useBlob()) return mem ?? null;
  const row = await getJson<ReservationRow>(reservationPath(collectionId, tokenId));
  return row ?? mem ?? null;
}

async function releaseReservation(
  collectionId: string,
  tokenId: number,
  idempotencyKey: string,
): Promise<void> {
  const key = reservationMemKey(collectionId, tokenId);
  const row = await loadReservation(collectionId, tokenId);
  if (row && row.idempotencyKey !== idempotencyKey) return;
  memory().reservations.delete(key);
  if (!useBlob()) return;
  try {
    await removeObject(reservationPath(collectionId, tokenId));
  } catch {
    /* missing is fine */
  }
}

/** Atomically claim one supply slot (Blob put overwrite:false / memory map). */
async function tryClaimSlot(
  collectionId: string,
  tokenId: number,
  idempotencyKey: string,
  expiresAt: string,
): Promise<boolean> {
  if (tokenId < 1) return false;
  if (await tokenExists(collectionId, tokenId)) return false;

  const existing = await loadReservation(collectionId, tokenId);
  if (existing) {
    if (existing.idempotencyKey === idempotencyKey) return true;
    if (Date.parse(existing.expiresAt) > Date.now()) return false;
    // Expired reservation — reclaim.
  }

  const row: ReservationRow = {
    collectionId,
    tokenId,
    idempotencyKey,
    expiresAt,
    createdAt: new Date().toISOString(),
  };

  if (!useBlob()) {
    const key = reservationMemKey(collectionId, tokenId);
    const cur = memory().reservations.get(key);
    if (cur && cur.idempotencyKey !== idempotencyKey && Date.parse(cur.expiresAt) > Date.now()) {
      return false;
    }
    memory().reservations.set(key, row);
    return true;
  }

  try {
    await putJson(reservationPath(collectionId, tokenId), row, {
      overwrite: Boolean(existing && Date.parse(existing.expiresAt) <= Date.now()),
    });
    memory().reservations.set(reservationMemKey(collectionId, tokenId), row);
    return true;
  } catch {
    const again = await loadReservation(collectionId, tokenId);
    return again?.idempotencyKey === idempotencyKey;
  }
}

/**
 * Claim the next free token id for this collection.
 * Survives multi-instance races via Blob overwrite:false on each slot file.
 */
async function claimNextSlot(
  collectionId: string,
  totalSupply: number,
  idempotencyKey: string,
  expiresAt: string,
): Promise<number | null> {
  return withCollectionClaimLock(collectionId, async () => {
    const minted = await countMinted(collectionId);
    if (minted >= totalSupply) return null;

    const tryIds: number[] = [];
    for (let id = minted + 1; id <= totalSupply; id++) tryIds.push(id);
    for (let id = 1; id <= minted; id++) tryIds.push(id);

    for (const id of tryIds) {
      if (await tryClaimSlot(collectionId, id, idempotencyKey, expiresAt)) {
        return id;
      }
    }
    return null;
  });
}

async function countActiveReservations(collectionId: string): Promise<number> {
  const now = Date.now();
  if (!useBlob()) {
    let n = 0;
    for (const row of memory().reservations.values()) {
      if (row.collectionId === collectionId && Date.parse(row.expiresAt) > now) n += 1;
    }
    return n;
  }
  let n = 0;
  try {
    const rows = await listJsonUnder<ReservationRow>(`mints/reservations/${collectionId}/`);
    for (const row of rows) {
      if (row && Date.parse(row.expiresAt) > now) n += 1;
    }
  } catch {
    /* ignore */
  }
  return n;
}

export async function withLiveSupply(collection: Collection): Promise<Collection> {
  const mintedCount = await countMinted(collection.id);
  const reserved = await countActiveReservations(collection.id);
  const remainingSupply = Math.max(0, collection.totalSupply - mintedCount - reserved);
  let status = collection.status;
  if (remainingSupply === 0 && mintedCount > 0) status = "sold_out";
  else if (remainingSupply === 0 && reserved > 0 && collection.status === "live") {
    // All remaining units are held by in-flight mints.
    status = "live";
  }
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
  try {
    await removeObject(pathname);
  } catch {
    /* best-effort */
  }
}

/** Register Sphere nametag → chain pubkey so transfers can land on hex inventory.
 * Never steals an existing binding owned by a different pubkey.
 */
export async function bindNametag(nametag: string, chainPubkey: string): Promise<boolean> {
  const tag = normalizeSphereRecipient(nametag);
  const pubkey = normalizePrincipal(chainPubkey);
  if (!tag.startsWith("@") || !CHAIN_PUBKEY_RE.test(pubkey)) return false;
  if (!useBlob()) return false;

  const existing = await getJson<{ chainPubkey?: string }>(nametagPath(tag));
  const bound = existing?.chainPubkey?.trim().toLowerCase();
  if (bound && CHAIN_PUBKEY_RE.test(bound) && bound !== pubkey) {
    // Another wallet already owns this nametag binding — do not overwrite.
    return false;
  }

  await putJson(
    nametagPath(tag),
    { nametag: tag, chainPubkey: pubkey, updatedAt: new Date().toISOString() },
    { overwrite: true },
  );
  return true;
}

async function resolveNametagToPubkey(nametag: string): Promise<string | null> {
  if (!useBlob()) return null;
  const tag = normalizeSphereRecipient(nametag);
  if (!tag.startsWith("@")) return null;
  const row = await getJson<{ chainPubkey?: string }>(nametagPath(tag));
  const pubkey = row?.chainPubkey?.trim().toLowerCase();
  return pubkey && CHAIN_PUBKEY_RE.test(pubkey) ? pubkey : null;
}

/** Resolve @nametag → bound chain pubkey (for allowlist + transfers). */
export async function lookupNametagPubkey(nametag: string): Promise<string | null> {
  try {
    return await resolveNametagToPubkey(nametag);
  } catch {
    return null;
  }
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

/** Move tokens still owned by @nametag onto this wallet’s hex principal.
 * Only claims when the nametag is unbound or already bound to this pubkey.
 */
export async function claimNametagTokens(
  chainPubkey: string,
  nametag: string | null | undefined,
): Promise<number> {
  if (!nametag?.trim() || !useBlob()) return 0;
  const pubkey = normalizePrincipal(chainPubkey);
  if (!CHAIN_PUBKEY_RE.test(pubkey)) return 0;

  const tag = normalizeSphereRecipient(nametag);
  const existingBound = await resolveNametagToPubkey(tag);
  if (existingBound && existingBound !== pubkey) {
    // Nametag belongs to someone else — never rewrite their inventory onto this wallet.
    return 0;
  }

  const bound = await bindNametag(tag, pubkey);
  if (!bound && existingBound !== pubkey) return 0;

  let claimed = 0;
  let all: StoredToken[] = [];
  try {
    all = await listJsonUnder<StoredToken>("mints/tokens/");
  } catch {
    all = [];
  }
  try {
    const tagged = await listJsonUnder<StoredToken>(
      `mints/wallets/${encodeURIComponent(tag).slice(0, 120)}/`,
    );
    all = [...all, ...tagged];
  } catch {
    /* index scan is best-effort */
  }

  const seen = new Set<string>();
  for (const token of all) {
    const key = `${token.collectionId}:${token.tokenId}`;
    if (seen.has(key)) continue;
    seen.add(key);

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
  opts?: { nametag?: string | null },
): Promise<MintIntentResponse> {
  assertPersistentLedger();
  const principal = normalizePrincipal(walletPrincipal);
  const tag = opts?.nametag?.trim();
  if (tag) {
    try {
      await bindNametag(tag, principal);
    } catch {
      /* binding is best-effort before allowlist match */
    }
  }
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
  // Never invent phases outside their window — empty window means closed.
  if (!timed.length) {
    throw new MintHttpError("No active mint phase", 400, "UPAD_NO_PHASE");
  }

  const ranked = [...timed].sort((a, b) => {
    const rank = (t: string) => (t === "creator" ? 0 : t === "allowlist" ? 1 : 2);
    return rank(a.type) - rank(b.type);
  });

  const allowlistActive = ranked.some((p) => p.type === "allowlist");

  let phase = null as (typeof collection.phases)[number] | null;
  let phaseCap = 1;
  let lastAllowlistError: ListingHttpError | null = null;
  for (const candidate of ranked) {
    // While an allowlist phase is open, do not fall through to public for
    // wallets that failed the guest list — only listed users may mint.
    if (allowlistActive && candidate.type !== "allowlist" && lastAllowlistError) {
      break;
    }
    if (candidate.type === "creator") {
      const owner = normalizePrincipal(collection.creatorPrincipal);
      if (principal !== owner) continue;
    }
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
        "Only allowlisted @nametags or wallets can mint right now",
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

  // Claim a real supply slot before the buyer pays — prevents oversell under load.
  const reservedTokenId = await claimNextSlot(
    collection.id,
    collection.totalSupply,
    idempotencyKey,
    expiresAt,
  );
  if (reservedTokenId == null) {
    throw new MintHttpError("Sold out", 409, "UPAD_SOLD_OUT");
  }

  const intent: StoredIntent = {
    idempotencyKey,
    collectionId: collection.id,
    phaseId: phase.id,
    walletPrincipal: principal,
    priceUct: phase.priceUct,
    paymentMemo,
    status: "awaiting_payment",
    expiresAt,
    reservedTokenId,
    createdAt: new Date().toISOString(),
  };

  try {
    await saveIntent(intent);
  } catch (err) {
    await releaseReservation(collection.id, reservedTokenId, idempotencyKey);
    throw err;
  }

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

  if (intent.status === "refund_pending") {
    return {
      status: "refund_pending",
      idempotencyKey,
      reason: intent.reason || "sold_out",
    };
  }

  const expired = Boolean(intent.expiresAt && Date.parse(intent.expiresAt) < Date.now());
  if (expired && intent.status === "awaiting_payment") {
    if (intent.reservedTokenId != null) {
      await releaseReservation(intent.collectionId, intent.reservedTokenId, idempotencyKey);
    }
    intent.status = "rejected";
    intent.reason = "expired";
    delete intent.reservedTokenId;
    await saveIntent(intent);
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

  if (await paymentUsed(paymentRef)) {
    const existingIntent = intent.paymentRef === paymentRef ? intent : null;
    if (existingIntent?.status === "confirmed" && existingIntent.tokenId != null) {
      return {
        status: "confirmed",
        idempotencyKey,
        tokenId: existingIntent.tokenId,
        mintTxRef: existingIntent.mintTxRef,
      };
    }
    throw new MintHttpError("paymentRef already used", 409, "UPAD_PAYMENT_USED");
  }

  const phase =
    collectionBase.phases.find((p) => p.id === intent.phaseId) ??
    collectionBase.activePhase ??
    collectionBase.phases[0];
  let phaseCap = phase?.maxPerWallet ?? 1;
  if (phase) {
    try {
      const al = await assertAllowlisted(collectionBase.id, walletPrincipal, phase);
      if (al) phaseCap = Math.min(phaseCap, al.maxMints);
    } catch (err) {
      if (err instanceof ListingHttpError) {
        throw new MintHttpError(err.message, err.status, err.code);
      }
      throw err;
    }
  }
  const owned = await countOwned(collectionBase.id, walletPrincipal);
  if (phase && owned >= phaseCap) {
    // Cap hit after pay — auto-cancel slot and flag refund.
    if (intent.reservedTokenId != null) {
      await releaseReservation(intent.collectionId, intent.reservedTokenId, idempotencyKey);
    }
    try {
      await markPayment(paymentRef, idempotencyKey);
    } catch {
      /* already tracked */
    }
    intent.status = "refund_pending";
    intent.reason = "mint_cap";
    intent.paymentRef = paymentRef;
    delete intent.reservedTokenId;
    await saveIntent(intent);
    return { status: "refund_pending", idempotencyKey, reason: "mint_cap" };
  }

  // Ensure we still hold a supply slot (re-claim if missing / expired after pay).
  let reservedTokenId = intent.reservedTokenId ?? null;
  if (reservedTokenId != null) {
    const held = await tryClaimSlot(
      intent.collectionId,
      reservedTokenId,
      idempotencyKey,
      intent.expiresAt,
    );
    if (!held) reservedTokenId = null;
  }
  if (reservedTokenId == null) {
    reservedTokenId = await claimNextSlot(
      intent.collectionId,
      collectionBase.totalSupply,
      idempotencyKey,
      new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    );
  }

  if (reservedTokenId == null) {
    // Paid but no supply left — automatic refund path.
    try {
      await markPayment(paymentRef, idempotencyKey);
    } catch {
      /* already tracked */
    }
    intent.status = "refund_pending";
    intent.reason = "sold_out";
    intent.paymentRef = paymentRef;
    delete intent.reservedTokenId;
    await saveIntent(intent);
    return { status: "refund_pending", idempotencyKey, reason: "sold_out" };
  }

  const mintTxRef = `uct-mint:${collectionBase.id}:${reservedTokenId}:${nanoid(10)}`;
  const mintedAt = new Date().toISOString();

  const token: StoredToken = {
    collectionId: collectionBase.id,
    collectionName: collectionBase.name,
    slug: collectionBase.slug,
    coverUrl: collectionBase.coverUrl,
    tokenId: reservedTokenId,
    ownerPrincipal: walletPrincipal,
    mintTxRef,
    paymentRef,
    mintedAt,
    idempotencyKey,
  };

  try {
    await markPayment(paymentRef, idempotencyKey);
  } catch (err) {
    if (err instanceof MintHttpError && err.code === "UPAD_PAYMENT_USED") throw err;
    throw err;
  }

  try {
    await saveToken(token);
  } catch {
    // Slot race on token write — release and refund rather than oversell.
    await releaseReservation(intent.collectionId, reservedTokenId, idempotencyKey);
    intent.status = "refund_pending";
    intent.reason = "sold_out";
    intent.paymentRef = paymentRef;
    delete intent.reservedTokenId;
    await saveIntent(intent);
    return { status: "refund_pending", idempotencyKey, reason: "sold_out" };
  }

  intent.status = "confirmed";
  intent.paymentRef = paymentRef;
  intent.tokenId = token.tokenId;
  intent.reservedTokenId = reservedTokenId;
  intent.mintTxRef = token.mintTxRef;
  await saveIntent(intent);
  await releaseReservation(intent.collectionId, reservedTokenId, idempotencyKey);

  try {
    await recordMintSale({
      creatorPrincipal: collectionBase.creatorPrincipal,
      collectionId: collectionBase.id,
      collectionName: collectionBase.name,
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

/**
 * List mint inventory for a wallet.
 * Read-only: does not claim nametags or delete indexes (those run only on
 * authenticated claim / explicit transfer). Listing must never erase ownership.
 */
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
  let indexScanOk = false;
  for (const prefix of prefixes) {
    try {
      indexed = indexed.concat(await listJsonUnder<StoredToken>(prefix));
      indexScanOk = true;
    } catch {
      /* continue */
    }
  }

  // Full token-file scan so a missing/stale wallet index cannot hide owned mints.
  let all: StoredToken[] = [];
  let fullScanOk = false;
  try {
    all = await listJsonUnder<StoredToken>("mints/tokens/");
    fullScanOk = true;
  } catch {
    all = [];
  }

  // Both scans failed — surface empty would look like a wipe; prefer indexed-only
  // we already have (possibly empty) rather than throwing from this layer.
  if (!indexScanOk && !fullScanOk) {
    return [];
  }

  const byKey = new Map<string, StoredToken>();
  for (const t of [...indexed, ...all]) {
    byKey.set(`${t.collectionId}:${t.tokenId}`, t);
  }

  const owned: StoredToken[] = [];
  for (const t of byKey.values()) {
    // Canonical file is source of truth (wallet index may be stale after transfer).
    const canonical = await loadToken(t.collectionId, t.tokenId);
    if (!canonical) {
      // Blob read can flake — keep the indexed row rather than dropping ownership.
      if (await ownersMatchResolved(t.ownerPrincipal, owner, nametag)) {
        owned.push(t);
      }
      continue;
    }
    if (!(await ownersMatchResolved(canonical.ownerPrincipal, owner, nametag))) {
      // Stale index under this wallet — skip only. Never delete on list;
      // transferToken clears sender indexes after a confirmed move.
      continue;
    }
    owned.push(canonical);
    try {
      await putJson(
        walletTokenPath(canonical.ownerPrincipal, canonical.collectionId, canonical.tokenId),
        canonical,
        { overwrite: true },
      );
      // Also keep a hex wallet index when ownership is still a bound @nametag.
      if (
        !CHAIN_PUBKEY_RE.test(canonical.ownerPrincipal) &&
        CHAIN_PUBKEY_RE.test(owner)
      ) {
        await putJson(
          walletTokenPath(owner, canonical.collectionId, canonical.tokenId),
          canonical,
          { overwrite: true },
        );
      }
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

  // Canonical first, then recipient index — never clear the sender index until
  // the recipient copy is durable (avoids NFTs vanishing into a missing index).
  await putJson(tokenPath(updated.collectionId, updated.tokenId), updated, {
    overwrite: true,
  });
  // Recipient wallet index must exist before sender indexes are cleared.
  // Write twice — Vercel Blob get-after-put can lag, so we don't gate on a read.
  await putJson(
    walletTokenPath(updated.ownerPrincipal, updated.collectionId, updated.tokenId),
    updated,
    { overwrite: true },
  );
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

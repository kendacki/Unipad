/**
 * Creator drop listings for the Vercel storefront.
 * Persists drafts → publish in Blob (same token as mints); merges with static catalog.
 */
import { list, put } from "@vercel/blob";
import { nanoid } from "nanoid";
import {
  normalizeSphereRecipient,
  type Collection,
  type CollectionPhase,
  type CollectionStatus,
  type CreateCollectionInput,
  type PhaseType,
} from "@unipad/shared";
import { getCatalogCollection, listCatalogCollections } from "@/lib/catalog";

export type AllowlistRow = {
  phaseId: string;
  walletPrincipal: string;
  maxMints: number;
};

export type StoredListing = Collection & {
  allowlist: AllowlistRow[];
  updatedAt: string;
};

type MemoryDb = {
  byId: Map<string, StoredListing>;
};

declare global {
  // eslint-disable-next-line no-var
  var __unipadListingsMemory: MemoryDb | undefined;
}

function memory(): MemoryDb {
  if (!globalThis.__unipadListingsMemory) {
    globalThis.__unipadListingsMemory = { byId: new Map() };
  }
  return globalThis.__unipadListingsMemory;
}

function useBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export class ListingHttpError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function assertPersistentStore() {
  if (process.env.VERCEL && !useBlob()) {
    throw new ListingHttpError(
      "Listing storage is not configured on this deployment",
      503,
      "UPAD_UNAVAILABLE",
    );
  }
}

function collectionPath(id: string) {
  return `listings/collections/${id}.json`;
}

function slugPath(slug: string) {
  return `listings/slugs/${slug.toLowerCase()}.json`;
}

function creatorIndexPath(principal: string, id: string) {
  const safe = encodeURIComponent(principal.trim().toLowerCase()).slice(0, 120);
  return `listings/creators/${safe}/${id}.json`;
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

export function pickActivePhase(
  phases: CollectionPhase[],
  now = Date.now(),
): CollectionPhase | null {
  const timed = phases.filter((p) => {
    const startOk = !p.startsAt || new Date(p.startsAt).getTime() <= now;
    const endOk = !p.endsAt || new Date(p.endsAt).getTime() > now;
    return startOk && endOk;
  });
  if (!timed.length) return phases.find((p) => p.type === "public") ?? phases[0] ?? null;
  const rank = (t: PhaseType) => (t === "creator" ? 0 : t === "allowlist" ? 1 : 2);
  return [...timed].sort((a, b) => rank(a.type) - rank(b.type))[0];
}

function creatorDisplayName(principal: string): string {
  const p = principal.trim();
  if (p.startsWith("@")) return p;
  if (p.startsWith("mock_")) return "Atlas Works";
  if (/^[0-9a-f]{64,66}$/i.test(p)) return `0x${p.slice(0, 8)}`;
  return p.length > 20 ? `${p.slice(0, 12)}…` : p;
}

function normalizeWalletKey(raw: string): string {
  const value = raw.trim();
  if (!value) return value;
  try {
    return normalizeSphereRecipient(value).toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function refreshListing(listing: StoredListing, persist = false): StoredListing {
  let status: CollectionStatus = listing.status;
  if (
    status === "scheduled" &&
    listing.launchAt &&
    Date.parse(listing.launchAt) <= Date.now()
  ) {
    status = "live";
  }
  const next: StoredListing = {
    ...listing,
    status,
    activePhase: pickActivePhase(listing.phases),
    updatedAt: listing.updatedAt,
  };
  if (persist && status !== listing.status && useBlob()) {
    void saveListing(next).catch(() => undefined);
  }
  return next;
}

function toPublic(listing: StoredListing): Collection {
  const { allowlist: _a, updatedAt: _u, ...collection } = listing;
  return collection;
}

async function saveListing(listing: StoredListing) {
  if (!useBlob()) {
    memory().byId.set(listing.id, listing);
    return;
  }
  await putJson(collectionPath(listing.id), listing);
  await putJson(slugPath(listing.slug), { id: listing.id });
  await putJson(creatorIndexPath(listing.creatorPrincipal, listing.id), {
    id: listing.id,
  });
}

async function loadListingById(id: string): Promise<StoredListing | null> {
  if (!useBlob()) return memory().byId.get(id) ?? null;
  return getJson<StoredListing>(collectionPath(id));
}

async function loadAllListings(): Promise<StoredListing[]> {
  if (!useBlob()) return [...memory().byId.values()];
  const rows = await listJsonUnder<StoredListing>("listings/collections/");
  return rows.filter((r) => r && typeof r.id === "string" && Array.isArray(r.phases));
}

function validateCreateInput(input: CreateCollectionInput) {
  const name = input.name?.trim() ?? "";
  if (name.length < 2 || name.length > 80) {
    throw new ListingHttpError("Name must be 2–80 characters", 400, "UPAD_VALIDATION");
  }
  const slug = input.slug?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 2 || slug.length > 64) {
    throw new ListingHttpError(
      "Slug must be lowercase letters, numbers, and hyphens",
      400,
      "UPAD_VALIDATION",
    );
  }
  if (!Number.isInteger(input.totalSupply) || input.totalSupply < 1 || input.totalSupply > 100_000) {
    throw new ListingHttpError("Supply must be 1–100000", 400, "UPAD_VALIDATION");
  }
  if (!Number.isInteger(input.royaltyBps) || input.royaltyBps < 0 || input.royaltyBps > 2000) {
    throw new ListingHttpError("Royalty must be 0–20%", 400, "UPAD_VALIDATION");
  }
  if (!input.phases?.length) {
    throw new ListingHttpError("Add at least one mint phase", 400, "UPAD_VALIDATION");
  }
  for (const p of input.phases) {
    if (!["creator", "allowlist", "public"].includes(p.type)) {
      throw new ListingHttpError("Invalid phase type", 400, "UPAD_VALIDATION");
    }
    if (!p.name?.trim()) {
      throw new ListingHttpError("Phase name required", 400, "UPAD_VALIDATION");
    }
    if (!/^\d+$/.test(p.priceUct) || BigInt(p.priceUct) <= 0n) {
      throw new ListingHttpError("Phase price must be > 0 UCT", 400, "UPAD_VALIDATION");
    }
    if (!Number.isInteger(p.maxPerWallet) || p.maxPerWallet < 1 || p.maxPerWallet > 50) {
      throw new ListingHttpError("Max per wallet must be 1–50", 400, "UPAD_VALIDATION");
    }
  }
  return { name, slug };
}

export async function createListing(
  principal: string,
  input: CreateCollectionInput,
): Promise<Collection> {
  assertPersistentStore();
  const { name, slug } = validateCreateInput(input);

  if (getCatalogCollection(slug) || getCatalogCollection(`col-${slug}`)) {
    throw new ListingHttpError("That slug is already used", 409, "UPAD_CONFLICT");
  }

  const existing = await getStoredListing(slug);
  if (existing) {
    throw new ListingHttpError("That slug is already used", 409, "UPAD_CONFLICT");
  }

  const id = `col-${slug}`;
  const now = new Date().toISOString();
  const launchAt = input.launchAt ?? null;
  const phases: CollectionPhase[] = input.phases.map((p, i) => ({
    id: `phase-${slug}-${p.type}-${i}`,
    type: p.type,
    name: p.name.trim(),
    priceUct: p.priceUct,
    maxPerWallet: p.maxPerWallet,
    startsAt: p.startsAt ?? launchAt ?? now,
    endsAt: p.endsAt ?? null,
    supplyCap: p.supplyCap ?? null,
  }));

  const listing: StoredListing = {
    id,
    slug,
    name,
    description: (input.description ?? "").slice(0, 2000),
    creatorPrincipal: principal,
    creatorDisplayName:
      input.creatorDisplayName?.trim().slice(0, 80) || creatorDisplayName(principal),
    coverUrl: input.coverUrl?.trim() || null,
    status: "draft",
    totalSupply: input.totalSupply,
    mintedCount: 0,
    remainingSupply: input.totalSupply,
    royaltyBps: input.royaltyBps,
    phases,
    activePhase: pickActivePhase(phases),
    createdAt: now,
    launchAt,
    allowlist: [],
    updatedAt: now,
  };

  await saveListing(listing);
  return toPublic(listing);
}

export async function listCreatorListings(principal: string): Promise<Collection[]> {
  const all = await loadAllListings();
  const key = principal.trim().toLowerCase();
  return all
    .filter((l) => l.creatorPrincipal.trim().toLowerCase() === key)
    .map((l) => toPublic(refreshListing(l)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getStoredListing(idOrSlug: string): Promise<StoredListing | null> {
  const key = idOrSlug.trim();
  if (!key) return null;

  let listing = await loadListingById(key);
  if (!listing && useBlob()) {
    const ptr = await getJson<{ id: string }>(slugPath(key));
    if (ptr?.id) listing = await loadListingById(ptr.id);
  }
  if (!listing && !useBlob()) {
    listing =
      [...memory().byId.values()].find(
        (l) => l.id === key || l.slug === key || l.slug.toLowerCase() === key.toLowerCase(),
      ) ?? null;
  }
  if (!listing) {
    const rows = await loadAllListings();
    listing =
      rows.find(
        (l) =>
          l.id === key ||
          l.slug === key ||
          l.slug.toLowerCase() === key.toLowerCase(),
      ) ?? null;
  }
  return listing ? refreshListing(listing, true) : null;
}

/** Seed catalog + published creator listings (excludes drafts). */
export async function listPublicCollections(status?: string | null): Promise<Collection[]> {
  const seed = listCatalogCollections(status === "draft" ? "all" : status);
  const listed = (await loadAllListings()).map((l) => refreshListing(l, true));

  const publicListed = listed
    .filter((c) => c.status !== "draft")
    .filter((c) => !status || status === "all" || c.status === status)
    .map(toPublic);

  if (status === "draft") {
    return listed.filter((c) => c.status === "draft").map(toPublic);
  }

  const byId = new Map<string, Collection>();
  for (const c of seed) byId.set(c.id, c);
  for (const c of publicListed) byId.set(c.id, c);
  return [...byId.values()];
}

export async function getResolvedCollection(idOrSlug: string): Promise<Collection | null> {
  const seed = getCatalogCollection(idOrSlug);
  if (seed) return seed;
  const listed = await getStoredListing(idOrSlug);
  if (!listed || listed.status === "draft") return null;
  return toPublic(listed);
}

export async function publishListing(principal: string, idOrSlug: string): Promise<Collection> {
  assertPersistentStore();
  const listing = await getStoredListing(idOrSlug);
  if (!listing || listing.creatorPrincipal.trim().toLowerCase() !== principal.trim().toLowerCase()) {
    throw new ListingHttpError("Collection not found", 404, "UPAD_NOT_FOUND");
  }
  if (listing.status !== "draft" && listing.status !== "scheduled") {
    throw new ListingHttpError("Only drafts can be published", 400, "UPAD_VALIDATION");
  }

  const launchAt = listing.launchAt ?? new Date().toISOString();
  const now = Date.now();
  const status: CollectionStatus =
    Date.parse(launchAt) > now ? "scheduled" : "live";

  const phases = listing.phases.map((p) => ({
    ...p,
    startsAt: p.startsAt ?? launchAt,
  }));

  const next: StoredListing = {
    ...listing,
    launchAt,
    status,
    phases,
    activePhase: pickActivePhase(phases),
    updatedAt: new Date().toISOString(),
  };
  await saveListing(next);
  return toPublic(next);
}

export async function upsertListingAllowlist(
  principal: string,
  idOrSlug: string,
  phaseId: string,
  entries: Array<{ walletPrincipal: string; maxMints?: number }>,
): Promise<AllowlistRow[]> {
  assertPersistentStore();
  const listing = await getStoredListing(idOrSlug);
  if (!listing || listing.creatorPrincipal.trim().toLowerCase() !== principal.trim().toLowerCase()) {
    throw new ListingHttpError("Collection not found", 404, "UPAD_NOT_FOUND");
  }
  const phase = listing.phases.find((p) => p.id === phaseId);
  if (!phase) throw new ListingHttpError("Phase not found", 404, "UPAD_NOT_FOUND");
  if (phase.type !== "allowlist") {
    throw new ListingHttpError("Phase is not an allowlist phase", 400, "UPAD_VALIDATION");
  }

  const byWallet = new Map<string, AllowlistRow>();
  for (const row of listing.allowlist.filter((e) => e.phaseId !== phaseId)) {
    byWallet.set(`${row.phaseId}:${normalizeWalletKey(row.walletPrincipal)}`, row);
  }
  for (const e of entries) {
    const wallet = normalizeWalletKey(e.walletPrincipal);
    if (!wallet) continue;
    const maxMints = Math.min(50, Math.max(1, e.maxMints ?? phase.maxPerWallet));
    byWallet.set(`${phaseId}:${wallet}`, {
      phaseId,
      walletPrincipal: wallet,
      maxMints,
    });
  }

  const allowlist = [...byWallet.values()];
  const next: StoredListing = {
    ...listing,
    allowlist,
    updatedAt: new Date().toISOString(),
  };
  await saveListing(next);
  return allowlist.filter((e) => e.phaseId === phaseId);
}

export async function listListingAllowlist(
  principal: string,
  idOrSlug: string,
  phaseId?: string,
): Promise<AllowlistRow[]> {
  const listing = await getStoredListing(idOrSlug);
  if (!listing || listing.creatorPrincipal.trim().toLowerCase() !== principal.trim().toLowerCase()) {
    throw new ListingHttpError("Collection not found", 404, "UPAD_NOT_FOUND");
  }
  return phaseId
    ? listing.allowlist.filter((e) => e.phaseId === phaseId)
    : listing.allowlist;
}

export async function replaceListingPhases(
  principal: string,
  idOrSlug: string,
  phasesInput: CreateCollectionInput["phases"],
): Promise<Collection> {
  assertPersistentStore();
  const listing = await getStoredListing(idOrSlug);
  if (!listing || listing.creatorPrincipal.trim().toLowerCase() !== principal.trim().toLowerCase()) {
    throw new ListingHttpError("Collection not found", 404, "UPAD_NOT_FOUND");
  }
  if (listing.status === "live" || listing.status === "sold_out") {
    throw new ListingHttpError("Cannot edit phases on a live drop", 400, "UPAD_VALIDATION");
  }
  validateCreateInput({
    name: listing.name,
    slug: listing.slug,
    description: listing.description,
    totalSupply: listing.totalSupply,
    royaltyBps: listing.royaltyBps,
    phases: phasesInput,
  });

  const phases: CollectionPhase[] = phasesInput.map((p, i) => ({
    id: `phase-${listing.slug}-${p.type}-${i}-${nanoid(6)}`,
    type: p.type,
    name: p.name.trim(),
    priceUct: p.priceUct,
    maxPerWallet: p.maxPerWallet,
    startsAt: p.startsAt ?? listing.launchAt,
    endsAt: p.endsAt ?? null,
    supplyCap: p.supplyCap ?? null,
  }));

  const next: StoredListing = {
    ...listing,
    phases,
    activePhase: pickActivePhase(phases),
    allowlist: [],
    updatedAt: new Date().toISOString(),
  };
  await saveListing(next);
  return toPublic(next);
}

/** Enforce allowlist when the active phase requires it. */
export async function assertAllowlisted(
  collectionId: string,
  walletPrincipal: string,
  phase: CollectionPhase,
): Promise<{ maxMints: number } | null> {
  if (phase.type !== "allowlist") return null;
  const listing = await getStoredListing(collectionId);
  if (!listing) {
    // Seed catalog has no allowlist data — treat as open.
    return null;
  }
  const key = normalizeWalletKey(walletPrincipal);
  const entry = listing.allowlist.find(
    (e) => e.phaseId === phase.id && normalizeWalletKey(e.walletPrincipal) === key,
  );
  if (!entry) {
    throw new ListingHttpError("Wallet not on allowlist", 403, "UPAD_NOT_ALLOWLISTED");
  }
  return { maxMints: entry.maxMints };
}

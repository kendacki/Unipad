/**
 * Creator drop listings for the Vercel storefront.
 * Persists drafts → publish via objectStore (Supabase preferred; Blob fallback).
 */
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
import { isDisplayableCoverUrl, normalizeCoverUrl } from "@/lib/media";
import {
  getJson,
  isPersistentStoreConfigured,
  listJsonUnder,
  putJson,
} from "@/lib/objectStore";

function normalizeStoredCoverUrl(raw: string | null | undefined): string | null {
  const normalized = normalizeCoverUrl(raw);
  return normalized && isDisplayableCoverUrl(normalized) ? normalized : null;
}

export type AllowlistRow = {
  phaseId: string;
  walletPrincipal: string;
  maxMints: number;
};

export type StoredListing = Collection & {
  allowlist: AllowlistRow[];
  updatedAt: string;
};

type PublicRegistryEntry = Collection & { updatedAt: string };

type PublicRegistry = {
  updatedAt: string;
  /** id → public Collection snapshot (non-draft only). */
  byId: Record<string, PublicRegistryEntry>;
};

type MemoryDb = {
  byId: Map<string, StoredListing>;
  /** Published (non-draft) snapshots — survives stale CDN reads of collection JSON. */
  publicById: Map<string, PublicRegistryEntry>;
};

declare global {
  // eslint-disable-next-line no-var
  var __unipadListingsMemory: MemoryDb | undefined;
}

function memory(): MemoryDb {
  if (!globalThis.__unipadListingsMemory) {
    globalThis.__unipadListingsMemory = {
      byId: new Map(),
      publicById: new Map(),
    };
  }
  // Older hot-reload shapes may lack publicById.
  if (!globalThis.__unipadListingsMemory.publicById) {
    globalThis.__unipadListingsMemory.publicById = new Map();
  }
  return globalThis.__unipadListingsMemory;
}

function useBlob(): boolean {
  return isPersistentStoreConfigured();
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
      "Listing storage is not configured (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)",
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
  const safe = encodeURIComponent(normalizePrincipalKey(principal)).slice(0, 120);
  return `listings/creators/${safe}/${id}.json`;
}

function publicRegistryPath() {
  return "listings/public-registry.json";
}

function normalizePrincipalKey(principal: string): string {
  return principal.trim().toLowerCase().replace(/^0x/, "");
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

function toRegistryEntry(listing: StoredListing): PublicRegistryEntry {
  return { ...toPublic(listing), updatedAt: listing.updatedAt };
}

async function loadPublicRegistry(): Promise<PublicRegistry> {
  if (!useBlob()) {
    const byId: Record<string, PublicRegistryEntry> = {};
    for (const [id, c] of memory().publicById) byId[id] = c;
    return { updatedAt: new Date().toISOString(), byId };
  }
  const fromBlob = await getJson<PublicRegistry>(publicRegistryPath());
  const byId: Record<string, PublicRegistryEntry> = { ...(fromBlob?.byId ?? {}) };
  // In-process publish wins over stale CDN registry bodies.
  for (const [id, c] of memory().publicById) {
    const existing = byId[id];
    if (!existing || (c.updatedAt || "") >= (existing.updatedAt || "")) {
      byId[id] = c;
    }
  }
  return { updatedAt: fromBlob?.updatedAt || new Date().toISOString(), byId };
}

async function writePublicRegistry(byId: Record<string, PublicRegistryEntry>) {
  const registry: PublicRegistry = {
    updatedAt: new Date().toISOString(),
    byId,
  };
  memory().publicById = new Map(Object.entries(byId));
  if (!useBlob()) return;
  await putJson(publicRegistryPath(), registry);
}

async function syncPublicRegistry(listing: StoredListing) {
  const pub = toRegistryEntry(refreshListing(listing));
  const registry = await loadPublicRegistry();
  if (pub.status === "draft") {
    delete registry.byId[pub.id];
    memory().publicById.delete(pub.id);
  } else {
    registry.byId[pub.id] = pub;
    memory().publicById.set(pub.id, pub);
  }
  await writePublicRegistry(registry.byId);
}

async function saveListing(listing: StoredListing) {
  // Always mirror in-process so publish → list on the same instance is instant.
  memory().byId.set(listing.id, listing);
  if (listing.status !== "draft") {
    memory().publicById.set(listing.id, toRegistryEntry(listing));
  } else {
    memory().publicById.delete(listing.id);
  }
  if (!useBlob()) return;
  await putJson(collectionPath(listing.id), listing);
  await putJson(slugPath(listing.slug), { id: listing.id });
  await putJson(creatorIndexPath(listing.creatorPrincipal, listing.id), {
    id: listing.id,
    status: listing.status,
    slug: listing.slug,
    updatedAt: listing.updatedAt,
  });
  // Durable non-draft index — storefront reads this when collection CDN is stale.
  await syncPublicRegistry(listing);
}

async function loadListingById(id: string): Promise<StoredListing | null> {
  const mem = memory().byId.get(id) ?? null;
  if (!useBlob()) return mem;
  const fromBlob = await getJson<StoredListing>(collectionPath(id));
  if (fromBlob) {
    // Stale CDN can still serve the pre-publish draft — prefer fresher memory / live.
    if (
      mem &&
      ((mem.updatedAt || "") >= (fromBlob.updatedAt || "") ||
        (fromBlob.status === "draft" && mem.status !== "draft"))
    ) {
      return mem;
    }
    memory().byId.set(fromBlob.id, fromBlob);
    return fromBlob;
  }
  return mem;
}

async function loadAllListings(): Promise<StoredListing[]> {
  if (!useBlob()) return [...memory().byId.values()];
  const rows = await listJsonUnder<StoredListing>("listings/collections/");
  const byId = new Map<string, StoredListing>();
  for (const r of rows) {
    if (r && typeof r.id === "string" && Array.isArray(r.phases)) byId.set(r.id, r);
  }
  // Prefer in-process writes (e.g. just-published) over potentially stale Blob CDN reads.
  for (const [id, listing] of memory().byId) {
    const existing = byId.get(id);
    if (
      !existing ||
      (listing.updatedAt || "") >= (existing.updatedAt || "") ||
      (existing.status === "draft" && listing.status !== "draft")
    ) {
      byId.set(id, listing);
    }
  }
  return [...byId.values()];
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
    creatorPrincipal: normalizePrincipalKey(principal),
    creatorDisplayName:
      input.creatorDisplayName?.trim().slice(0, 80) || creatorDisplayName(principal),
    coverUrl: normalizeStoredCoverUrl(input.coverUrl),
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
  const key = normalizePrincipalKey(principal);
  const byId = new Map<string, StoredListing>();

  // Prefer creator index (avoids missing rows when the global collection list lags).
  if (useBlob()) {
    try {
      const prefix = `listings/creators/${encodeURIComponent(key).slice(0, 120)}/`;
      const indexRows = await listJsonUnder<{ id?: string }>(prefix);
      for (const row of indexRows) {
        if (!row?.id) continue;
        const listing = await loadListingById(row.id);
        if (listing) byId.set(listing.id, listing);
      }
    } catch {
      /* fall through to full scan */
    }
  }

  for (const listing of await loadAllListings()) {
    if (normalizePrincipalKey(listing.creatorPrincipal) === key) {
      const existing = byId.get(listing.id);
      if (
        !existing ||
        (listing.updatedAt || "") >= (existing.updatedAt || "") ||
        (existing.status === "draft" && listing.status !== "draft")
      ) {
        byId.set(listing.id, listing);
      }
    }
  }

  for (const listing of memory().byId.values()) {
    if (normalizePrincipalKey(listing.creatorPrincipal) === key) {
      byId.set(listing.id, listing);
    }
  }

  return [...byId.values()]
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
  // Public registry can still expose a published snapshot when collection CDN is draft/stale.
  if (!listing || listing.status === "draft") {
    const registry = await loadPublicRegistry();
    const snap =
      (listing && registry.byId[listing.id]) ||
      registry.byId[key] ||
      Object.values(registry.byId).find(
        (c) => c.slug === key || c.slug.toLowerCase() === key.toLowerCase(),
      );
    if (snap && snap.status !== "draft") {
      const merged: StoredListing = {
        ...(listing ?? (snap as StoredListing)),
        ...snap,
        allowlist: listing?.allowlist ?? [],
        updatedAt: snap.updatedAt || listing?.updatedAt || new Date().toISOString(),
      };
      memory().byId.set(merged.id, merged);
      return refreshListing(merged, true);
    }
  }
  return listing ? refreshListing(listing, true) : null;
}

/** Seed catalog + published creator listings (excludes drafts). */
export async function listPublicCollections(status?: string | null): Promise<Collection[]> {
  const seed = listCatalogCollections(status === "draft" ? "all" : status);
  const listed: StoredListing[] = (await loadAllListings()).map((l) => refreshListing(l, true));
  const registry = await loadPublicRegistry();

  // Recover publishes whose collection JSON is still a stale draft on CDN but
  // whose creator-index / registry row already says live|scheduled|sold_out.
  if (useBlob()) {
    try {
      const pointers = await listJsonUnder<{
        id?: string;
        status?: string;
        slug?: string;
        updatedAt?: string;
      }>("listings/creators/");
      for (const ptr of pointers) {
        if (!ptr?.id || !ptr.status || ptr.status === "draft") continue;
        const existingIdx = listed.findIndex((l) => l.id === ptr.id);
        const existing = existingIdx >= 0 ? listed[existingIdx] : null;
        if (existing && existing.status !== "draft") continue;
        const body = existing ?? (await loadListingById(ptr.id));
        if (!body) continue;
        const recovered: StoredListing = {
          ...body,
          status: ptr.status as CollectionStatus,
          updatedAt: ptr.updatedAt || body.updatedAt,
        };
        const refreshed = refreshListing(recovered);
        if (existingIdx >= 0) listed[existingIdx] = refreshed;
        else listed.push(refreshed);
        registry.byId[recovered.id] = toRegistryEntry(recovered);
        memory().byId.set(recovered.id, recovered);
        memory().publicById.set(recovered.id, toRegistryEntry(recovered));
      }
    } catch {
      /* best-effort recovery */
    }
  }

  const byId = new Map<string, Collection>();
  for (const c of seed) byId.set(c.id, c);

  let registryDirty = false;
  for (const listing of listed) {
    // A draft that already has mints was published before — never hide it as unpublished.
    if (
      listing.status === "draft" &&
      (listing.mintedCount > 0 || listing.remainingSupply < listing.totalSupply)
    ) {
      listing.status = listing.remainingSupply <= 0 ? "sold_out" : "live";
      listing.updatedAt = new Date().toISOString();
      memory().byId.set(listing.id, listing);
      memory().publicById.set(listing.id, toRegistryEntry(listing));
      registry.byId[listing.id] = toRegistryEntry(listing);
      registryDirty = true;
      void saveListing(listing).catch(() => undefined);
    }
  }

  for (const listing of listed) {
    if (listing.status === "draft") continue;
    if (status && status !== "all" && listing.status !== status) continue;
    byId.set(listing.id, toPublic(listing));
    const snap = registry.byId[listing.id];
    if (!snap || (listing.updatedAt || "") > (snap.updatedAt || "")) {
      registry.byId[listing.id] = toRegistryEntry(listing);
      registryDirty = true;
    }
  }

  // Registry snapshots fill gaps when collection JSON is still a stale draft on CDN.
  for (const snap of Object.values(registry.byId)) {
    if (!snap?.id || snap.status === "draft") continue;
    if (status && status !== "all" && snap.status !== status) continue;
    const existing = byId.get(snap.id);
    if (
      !existing ||
      existing.status === "draft" ||
      (snap.updatedAt || "") >= ((existing as PublicRegistryEntry).updatedAt || "")
    ) {
      const { updatedAt: _u, ...pub } = snap;
      byId.set(snap.id, pub);
    }
  }

  if (registryDirty) {
    void writePublicRegistry(registry.byId).catch(() => undefined);
  }

  if (status === "draft") {
    return listed.filter((c) => c.status === "draft").map(toPublic);
  }

  return [...byId.values()];
}

export async function getResolvedCollection(
  idOrSlug: string,
  viewerPrincipal?: string | null,
): Promise<Collection | null> {
  const seed = getCatalogCollection(idOrSlug);
  if (seed) return seed;
  const listed = await getStoredListing(idOrSlug);
  if (!listed) return null;
  if (listed.status === "draft") {
    const viewer = viewerPrincipal ? normalizePrincipalKey(viewerPrincipal) : "";
    const owner = normalizePrincipalKey(listed.creatorPrincipal);
    // Creators may preview their own unpublished draft.
    if (viewer && viewer === owner) return toPublic(listed);
    return null;
  }
  return toPublic(listed);
}

export async function publishListing(principal: string, idOrSlug: string): Promise<Collection> {
  assertPersistentStore();
  const listing = await getStoredListing(idOrSlug);
  if (
    !listing ||
    normalizePrincipalKey(listing.creatorPrincipal) !== normalizePrincipalKey(principal)
  ) {
    throw new ListingHttpError("Collection not found", 404, "UPAD_NOT_FOUND");
  }
  if (listing.status !== "draft" && listing.status !== "scheduled") {
    throw new ListingHttpError("Only drafts can be published", 400, "UPAD_VALIDATION");
  }

  const nowIso = new Date().toISOString();
  const now = Date.now();
  const rawLaunch = listing.launchAt;
  const launchMs = rawLaunch ? Date.parse(rawLaunch) : NaN;
  const scheduled = Number.isFinite(launchMs) && launchMs > now;
  const launchAt = scheduled ? (rawLaunch as string) : nowIso;
  const status: CollectionStatus = scheduled ? "scheduled" : "live";

  const phases = listing.phases.map((p) => ({
    ...p,
    // Align phase windows with the published open time so storefront price/phase match catalog drops.
    startsAt: launchAt,
    endsAt: p.endsAt ?? null,
  }));

  const next: StoredListing = {
    ...listing,
    name: listing.name.trim(),
    description: listing.description?.trim() || "",
    creatorDisplayName: listing.creatorDisplayName?.trim() || creatorDisplayName(listing.creatorPrincipal),
    coverUrl: normalizeStoredCoverUrl(listing.coverUrl),
    launchAt,
    status,
    phases,
    activePhase: pickActivePhase(phases),
    remainingSupply: Math.max(0, listing.totalSupply - listing.mintedCount),
    updatedAt: nowIso,
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

  if (!entries?.length) {
    throw new ListingHttpError(
      "Add at least one @nametag or wallet to the allowlist",
      400,
      "UPAD_VALIDATION",
    );
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
  const phaseCount = allowlist.filter((e) => e.phaseId === phaseId).length;
  if (!phaseCount) {
    throw new ListingHttpError(
      "No valid allowlist entries — use @nametag or a wallet pubkey",
      400,
      "UPAD_VALIDATION",
    );
  }
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

/** Enforce allowlist when the phase requires it. Matches hex wallets and @nametags. */
export async function assertAllowlisted(
  collectionId: string,
  walletPrincipal: string,
  phase: CollectionPhase,
): Promise<{ maxMints: number } | null> {
  if (phase.type !== "allowlist") return null;

  const listing = await getStoredListing(collectionId);
  if (!listing) {
    // Creator listings always have blob rows. Missing data ⇒ deny allowlist mints.
    throw new ListingHttpError("Wallet not on allowlist", 403, "UPAD_NOT_ALLOWLISTED");
  }

  const phaseRows = listing.allowlist.filter((e) => e.phaseId === phase.id);
  if (!phaseRows.length) {
    throw new ListingHttpError(
      "Allowlist is empty — only guest-list users can mint this phase",
      403,
      "UPAD_NOT_ALLOWLISTED",
    );
  }

  const walletKey = normalizeWalletKey(walletPrincipal);
  const direct = phaseRows.find(
    (e) => normalizeWalletKey(e.walletPrincipal) === walletKey,
  );
  if (direct) return { maxMints: direct.maxMints };

  // Guest lists are usually @nametag; session principal is the chain pubkey.
  const { lookupNametagPubkey } = await import("@/lib/mintStore");
  for (const entry of phaseRows) {
    const entryKey = normalizeWalletKey(entry.walletPrincipal);
    if (!entryKey.startsWith("@")) continue;
    const bound = await lookupNametagPubkey(entryKey);
    if (bound && normalizeWalletKey(bound) === walletKey) {
      return { maxMints: entry.maxMints };
    }
  }

  throw new ListingHttpError("Wallet not on allowlist", 403, "UPAD_NOT_ALLOWLISTED");
}

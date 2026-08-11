/** Client-side mint inventory cache — bridges ledger lag / principal mismatches. */

export type CachedMint = {
  collectionId: string;
  collectionName: string;
  slug: string;
  coverUrl: string | null;
  tokenId: number;
  mintTxRef: string;
  mintedAt: string;
  ownerPrincipal: string;
};

const CACHE_KEY = "unipad.mints.cache.v2";

function readAll(): CachedMint[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CachedMint[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(rows: CachedMint[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(rows.slice(0, 100)));
  } catch {
    /* ignore quota */
  }
}

export function rememberMint(row: CachedMint) {
  const owner = row.ownerPrincipal.trim().toLowerCase();
  const next = [
    { ...row, ownerPrincipal: owner },
    ...readAll().filter(
      (t) => !(t.collectionId === row.collectionId && t.tokenId === row.tokenId),
    ),
  ];
  writeAll(next);
}

export function cachedMintsFor(principal: string | null | undefined): CachedMint[] {
  if (!principal) return [];
  const owner = principal.trim().toLowerCase();
  return readAll().filter((t) => t.ownerPrincipal === owner);
}

/** Remove a mint from cache for every owner (after a successful send). */
export function removeCachedMint(
  _principal: string,
  collectionId: string,
  tokenId: number,
) {
  writeAll(
    readAll().filter(
      (t) => !(t.collectionId === collectionId && t.tokenId === tokenId),
    ),
  );
}

/** Replace this wallet’s cache entries with the remote inventory (source of truth). */
export function replaceCachedMintsFor(principal: string, rows: CachedMint[]) {
  const owner = principal.trim().toLowerCase();
  const others = readAll().filter((t) => t.ownerPrincipal !== owner);
  const next = rows.map((r) => ({
    ...r,
    ownerPrincipal: (r.ownerPrincipal || owner).trim().toLowerCase(),
  }));
  writeAll([...next, ...others]);
}

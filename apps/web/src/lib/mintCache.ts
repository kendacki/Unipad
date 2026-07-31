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

const CACHE_KEY = "unipad.mints.cache.v1";

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
      (t) =>
        !(
          t.collectionId === row.collectionId &&
          t.tokenId === row.tokenId
        ),
    ),
  ];
  writeAll(next);
}

export function cachedMintsFor(principal: string | null | undefined): CachedMint[] {
  if (!principal) return [];
  const owner = principal.trim().toLowerCase();
  return readAll().filter((t) => t.ownerPrincipal === owner);
}

export function removeCachedMint(
  principal: string,
  collectionId: string,
  tokenId: number,
) {
  const owner = principal.trim().toLowerCase();
  writeAll(
    readAll().filter(
      (t) =>
        !(
          t.ownerPrincipal === owner &&
          t.collectionId === collectionId &&
          t.tokenId === tokenId
        ),
    ),
  );
}

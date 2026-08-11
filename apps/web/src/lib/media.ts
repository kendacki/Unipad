/** Curated free Unsplash 3D cartoon / NFT-style characters for drop covers */

const coverQ = "auto=format&fit=crop&w=1200&q=85";
const detailQ = "auto=format&fit=crop&w=1600&q=85";

function u(id: string, q = coverQ) {
  return `https://images.unsplash.com/photo-${id}?${q}`;
}

/** Homepage hero background — 4K UHD */
export const CARTOON_CHARACTERS = {
  heroBg: "/hero-bg.webp",
  heroBgPng: "/hero-bg.png",
} as const;

const COVER_IDS = [
  "1699524826369-57870e627c43",
  "1636622433525-127afdf3662d",
  "1638803040283-7a5ffd48dad5",
  "1639503611585-1054af5dbfab",
  "1728729729215-00ae703063ff",
  "1740252117012-bb53ad05e370",
  "1740252117013-4fb21771e7ca",
  "1740252117027-4275d3f84385",
  "1759950616527-15c2818f2f3c",
  "1759950616453-4f4a161c0c8d",
] as const;

/** Larger variants for drop detail hero — same 10, unique */
export const DROP_DETAIL_FALLBACKS = COVER_IDS.map((id) => u(id, detailQ));

/** Kept for hero / brand atmosphere (not drop cards) */
export const MEDIA_3D = {
  heroCubes:
    "https://images.unsplash.com/photo-1697388685394-9b241ec81374?auto=format&fit=crop&w=1600&q=70",
} as const;

/** Ten unique HD covers for See all / wallet / detail fallbacks */
export const DROP_COVER_FALLBACKS = COVER_IDS.map((id) => u(id, coverQ));

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|avif|svg)(\?|#|$)/i;

/**
 * Unwrap pasted Google/search/wrapper URLs to a direct image HTTPS URL when possible.
 * Keeps already-direct Supabase / Blob / Unsplash / CDN image links intact.
 */
export function normalizeCoverUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  let candidate = trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

    const host = parsed.hostname.toLowerCase();

    // Google image / search wrappers often embed the real image in query params.
    if (host.includes("google.") || host.includes("gstatic.com")) {
      const nested =
        parsed.searchParams.get("imgurl") ||
        parsed.searchParams.get("imgrefurl") ||
        parsed.searchParams.get("mediaurl") ||
        parsed.searchParams.get("url") ||
        parsed.searchParams.get("q");
      if (nested) {
        try {
          const inner = decodeURIComponent(nested);
          if (/^https?:\/\//i.test(inner)) {
            candidate = inner;
          } else {
            const photo = inner.match(/photo-([a-z0-9-]+)/i)?.[1];
            if (photo) {
              return `https://images.unsplash.com/photo-${photo}?${coverQ}`;
            }
          }
        } catch {
          /* keep candidate */
        }
      } else {
        const photo = trimmed.match(/photo-([a-z0-9-]+)/i)?.[1];
        if (photo) return `https://images.unsplash.com/photo-${photo}?${coverQ}`;
        return null;
      }
    }

    const url = new URL(candidate);
    const h = url.hostname.toLowerCase();

    // Wallet / agent pages are never cover images.
    if (h === "sphere.unicity.network" || url.pathname.includes("/agents/")) {
      return null;
    }

    if (h === "images.unsplash.com" || h === "unsplash.com") {
      const photo = url.pathname.match(/photo-([a-z0-9-]+)/i)?.[1];
      if (photo) return `https://images.unsplash.com/photo-${photo}?${coverQ}`;
    }

    return url.href;
  } catch {
    return null;
  }
}

/** True when the URL is usable as an <img>/Next Image src (direct image or known media host). */
export function isDisplayableCoverUrl(url: string | null | undefined): boolean {
  const normalized = normalizeCoverUrl(url);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    if (host === "images.unsplash.com") return true;
    if (host.endsWith(".supabase.co") && parsed.pathname.includes("/storage/v1/object/public/")) {
      return true;
    }
    if (
      host.endsWith(".blob.vercel-storage.com") ||
      host.endsWith(".public.blob.vercel-storage.com")
    ) {
      return true;
    }
    if (host === "ipfs.io") return true;
    return IMAGE_EXT_RE.test(parsed.pathname);
  } catch {
    return false;
  }
}

/** Unsplash can go through the Next image optimizer; uploaded covers should not. */
export function isOptimizableCoverUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "images.unsplash.com";
  } catch {
    return false;
  }
}

/** Prefer creator cover (normalized); fall back to curated art when missing/invalid. */
export function resolveCoverUrl(
  url: string | null | undefined,
  fallback: string,
): string {
  const normalized = normalizeCoverUrl(url);
  if (normalized && isDisplayableCoverUrl(normalized)) return normalized;
  return fallback;
}

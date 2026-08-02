import type { Collection } from "@unipad/shared";

export const LAUNCH_CHECKPOINT_KEY = "unipad.launch.checkpoint";
export const PUBLISHED_DROP_STASH_KEY = "unipad.drops.published.stash";
/** Durable client overlay so a published drop stays visible across refreshes. */
export const PUBLISHED_DROP_STASH_LS_KEY = "unipad.drops.published.stash.v2";
const STASH_TTL_MS = 30 * 60 * 1000;

export type LaunchCheckpoint = {
  step: 0 | 1 | 2 | 3 | 4;
  createdId: string;
  createdSlug: string;
  name: string;
  slug: string;
  ownerName: string;
  description: string;
  totalSupply: number;
  mintLimit: number;
  phases: unknown[];
  allowlistText: string;
  launchMode: string;
  schedulePreset: string;
  customDate: string;
  customHour: number;
  customMinute: number;
};

type StashedDrop = {
  collection: Collection;
  savedAt: number;
};

export function saveLaunchCheckpoint(data: LaunchCheckpoint) {
  try {
    sessionStorage.setItem(LAUNCH_CHECKPOINT_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

export function loadLaunchCheckpoint(): LaunchCheckpoint | null {
  try {
    const raw = sessionStorage.getItem(LAUNCH_CHECKPOINT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LaunchCheckpoint;
  } catch {
    return null;
  }
}

export function clearLaunchCheckpoint() {
  try {
    sessionStorage.removeItem(LAUNCH_CHECKPOINT_KEY);
  } catch {
    /* ignore */
  }
}

/** Stash a just-published drop so the storefront can show it before Blob list catches up. */
export function stashPublishedDrop(collection: Collection) {
  const payload: StashedDrop = { collection, savedAt: Date.now() };
  try {
    sessionStorage.setItem(PUBLISHED_DROP_STASH_KEY, JSON.stringify(collection));
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(PUBLISHED_DROP_STASH_LS_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

/**
 * Read published-drop overlay without deleting it.
 * Cleared once the API returns the same id as non-draft (or after TTL).
 */
export function peekPublishedDropStash(): Collection | null {
  try {
    const rawLs = localStorage.getItem(PUBLISHED_DROP_STASH_LS_KEY);
    if (rawLs) {
      const parsed = JSON.parse(rawLs) as StashedDrop | Collection;
      if (parsed && typeof parsed === "object" && "collection" in parsed) {
        const row = parsed as StashedDrop;
        if (Date.now() - row.savedAt > STASH_TTL_MS) {
          localStorage.removeItem(PUBLISHED_DROP_STASH_LS_KEY);
        } else if (row.collection?.id) {
          return row.collection;
        }
      } else if ((parsed as Collection)?.id) {
        return parsed as Collection;
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const raw = sessionStorage.getItem(PUBLISHED_DROP_STASH_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Collection;
  } catch {
    return null;
  }
}

/** @deprecated use peekPublishedDropStash — kept for one release compatibility */
export function takePublishedDropStash(): Collection | null {
  return peekPublishedDropStash();
}

/** Drop the client overlay once the storefront API includes the published collection. */
export function clearPublishedDropStashIfPresent(collections: Collection[]) {
  const stashed = peekPublishedDropStash();
  if (!stashed) return;
  const found = collections.some(
    (c) => c.id === stashed.id && c.status !== "draft",
  );
  if (!found) return;
  try {
    sessionStorage.removeItem(PUBLISHED_DROP_STASH_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(PUBLISHED_DROP_STASH_LS_KEY);
  } catch {
    /* ignore */
  }
}

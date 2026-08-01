import type { Collection } from "@unipad/shared";

export const LAUNCH_CHECKPOINT_KEY = "unipad.launch.checkpoint";
export const PUBLISHED_DROP_STASH_KEY = "unipad.drops.published.stash";

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
  try {
    sessionStorage.setItem(PUBLISHED_DROP_STASH_KEY, JSON.stringify(collection));
  } catch {
    /* ignore */
  }
}

export function takePublishedDropStash(): Collection | null {
  try {
    const raw = sessionStorage.getItem(PUBLISHED_DROP_STASH_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PUBLISHED_DROP_STASH_KEY);
    return JSON.parse(raw) as Collection;
  } catch {
    return null;
  }
}

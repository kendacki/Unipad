"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Collection } from "@unipad/shared";
import { api } from "@/lib/api";
import { DROP_COVER_FALLBACKS } from "@/lib/media";
import {
  dropPriceLabel,
  isMintable,
  matchesFilter,
  sortForStorefront,
  statusLabel,
  type DropFilter,
} from "@/lib/drops";

type Props = {
  limit?: number;
  filterable?: boolean;
  defaultFilter?: DropFilter;
  excludeId?: string;
  excludeIds?: string[];
  /** Shared list from parent (avoids a second fetch on /drops) */
  collections?: Collection[] | null;
  error?: string | null;
};

export function DropGrid({
  limit,
  filterable = false,
  defaultFilter = "mintable",
  excludeId,
  excludeIds,
  collections: collectionsProp,
  error: errorProp,
}: Props) {
  const [collectionsLocal, setCollectionsLocal] = useState<Collection[] | null>(null);
  const [errorLocal, setErrorLocal] = useState<string | null>(null);
  const [filter, setFilter] = useState<DropFilter>(defaultFilter);

  const controlled = collectionsProp !== undefined;
  const collections = controlled ? collectionsProp : collectionsLocal;
  const error = controlled ? (errorProp ?? null) : errorLocal;

  useEffect(() => {
    if (controlled) return;
    let cancelled = false;
    api
      .listCollections()
      .then((r) => {
        if (cancelled) return;
        setCollectionsLocal(sortForStorefront(r.collections));
      })
      .catch((e) => {
        if (!cancelled) setErrorLocal(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [controlled]);

  const counts = useMemo(() => {
    if (!collections) return { mintable: 0, upcoming: 0, all: 0 };
    return {
      mintable: collections.filter((c) => isMintable(c)).length,
      upcoming: collections.filter((c) => c.status === "scheduled").length,
      all: collections.length,
    };
  }, [collections]);

  const visible = useMemo(() => {
    if (!collections) return [];
    const filtered = filterable
      ? collections.filter((c) => matchesFilter(c, filter))
      : collections.filter((c) => matchesFilter(c, defaultFilter));
    const skip = new Set([...(excludeIds ?? []), ...(excludeId ? [excludeId] : [])]);
    const withoutFeatured = skip.size
      ? filtered.filter((c) => !skip.has(c.id))
      : filtered;
    return limit ? withoutFeatured.slice(0, limit) : withoutFeatured;
  }, [collections, filter, filterable, limit, defaultFilter, excludeId, excludeIds]);

  if (error) return <div className="flash error">{error}</div>;
  if (!collections) {
    return (
      <div className="grid-drops" aria-busy="true" aria-label="Loading drops">
        {Array.from({ length: limit ?? 3 }).map((_, i) => (
          <div key={i} className="drop-tile drop-skeleton" />
        ))}
      </div>
    );
  }

  return (
    <div className="drops-board">
      {filterable ? (
        <div className="drop-filters" role="tablist" aria-label="Filter drops">
          {(
            [
              ["mintable", "Live", counts.mintable],
              ["upcoming", "Upcoming", counts.upcoming],
              ["all", "All", counts.all],
            ] as const
          ).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              className={`drop-filter${filter === id ? " active" : ""}`}
              onClick={() => setFilter(id)}
            >
              {label}
              <span className="drop-filter-count">{count}</span>
            </button>
          ))}
        </div>
      ) : null}

      {!visible.length ? (
        <div className="flash">
          {filter === "mintable"
            ? "No live drops right now."
            : filter === "upcoming"
              ? "No upcoming drops yet."
              : "No drops yet."}{" "}
          <Link href="/launch" className="text-link">
            Create one
          </Link>
        </div>
      ) : (
        <div className="grid-drops">
          {visible.map((c, i) => {
            const cover = c.coverUrl || DROP_COVER_FALLBACKS[i % DROP_COVER_FALLBACKS.length];
            const mintedPct = Math.min(
              100,
              Math.round((c.mintedCount / Math.max(1, c.totalSupply)) * 100),
            );
            const mintable = isMintable(c);
            return (
              <Link key={c.id} href={`/drops/${c.slug}`} className="drop-tile">
                <div className="drop-media">
                  <Image
                    src={cover}
                    alt=""
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 360px"
                    loading={i < 3 ? "eager" : "lazy"}
                  />
                  <span className={`drop-badge status-${c.status}`}>
                    {statusLabel(c.status)}
                  </span>
                </div>
                <div className="drop-meta">
                  <div>
                    <h3>{c.name}</h3>
                    <div className="muted">by {c.creatorDisplayName || "Creator"}</div>
                  </div>
                  <div className="drop-price">{dropPriceLabel(c)}</div>
                </div>
                <div className="supply-bar" aria-hidden>
                  <span className="supply-fill" style={{ width: `${mintedPct}%` }} />
                </div>
                <div className="drop-footer">
                  <span className="muted drop-supply">
                    {c.remainingSupply} of {c.totalSupply} left
                  </span>
                  <span
                    className={
                      mintable ? "btn btn-primary drop-mint-btn" : "btn btn-ghost drop-mint-btn"
                    }
                  >
                    {mintable ? "Mint" : c.status === "scheduled" ? "Soon" : "View"}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

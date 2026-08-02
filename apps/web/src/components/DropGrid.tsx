"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, m } from "framer-motion";
import type { Collection } from "@unipad/shared";
import { api } from "@/lib/api";
import { DROP_COVER_FALLBACKS } from "@/lib/media";
import {
  dropPriceLabel,
  isMintable,
  matchesFilter,
  sortForStorefront,
  collectionStatusLabel,
  type DropFilter,
} from "@/lib/drops";
import { cardItem, fadeIn, springSnappy, staggerFast } from "@/lib/motion";

type Props = {
  limit?: number;
  filterable?: boolean;
  defaultFilter?: DropFilter;
  excludeId?: string;
  excludeIds?: string[];
  collections?: Collection[] | null;
  error?: string | null;
  highlightSlug?: string;
};

export function DropGrid({
  limit,
  filterable = false,
  defaultFilter = "mintable",
  excludeId,
  excludeIds,
  collections: collectionsProp,
  error: errorProp,
  highlightSlug,
}: Props) {
  const [collectionsLocal, setCollectionsLocal] = useState<Collection[] | null>(null);
  const [errorLocal, setErrorLocal] = useState<string | null>(null);
  const [filter, setFilter] = useState<DropFilter>(defaultFilter);

  useEffect(() => {
    setFilter(defaultFilter);
  }, [defaultFilter]);

  const controlled = collectionsProp !== undefined;
  const collections = controlled ? collectionsProp : collectionsLocal;
  const error = controlled ? (errorProp ?? null) : errorLocal;

  // If a highlighted drop isn't on Live (sold out / upcoming), switch to All so it stays visible.
  useEffect(() => {
    if (!highlightSlug || !collections?.length || !filterable) return;
    const target = collections.find(
      (c) =>
        c.slug.toLowerCase() === highlightSlug.toLowerCase() ||
        c.id.toLowerCase() === highlightSlug.toLowerCase(),
    );
    if (!target) {
      if (filter !== "all") setFilter("all");
      return;
    }
    if (filter === "mintable" && !isMintable(target)) {
      setFilter(target.status === "scheduled" ? "upcoming" : "all");
    }
  }, [highlightSlug, collections, filterable, filter]);

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

  if (error) {
    return (
      <m.div className="flash error" variants={fadeIn} initial="hidden" animate="show">
        {error}
      </m.div>
    );
  }
  if (!collections) {
    return (
      <div className="grid-drops" aria-busy="true" aria-label="Loading drops">
        {Array.from({ length: limit ?? 3 }).map((_, i) => (
          <m.div
            key={i}
            className="drop-tile drop-skeleton"
            initial={{ opacity: 0.35 }}
            animate={{ opacity: [0.35, 0.7, 0.35] }}
            transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.12 }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="drops-board">
      {filterable ? (
        <m.div
          className="drop-filters"
          role="tablist"
          aria-label="Filter drops"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springSnappy}
        >
          {(
            [
              ["mintable", "Live", counts.mintable],
              ["upcoming", "Upcoming", counts.upcoming],
              ["all", "All", counts.all],
            ] as const
          ).map(([id, label, count]) => (
            <m.button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              className={`drop-filter${filter === id ? " active" : ""}`}
              onClick={() => setFilter(id)}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.98 }}
              transition={springSnappy}
              layout
            >
              {label}
              <span className="drop-filter-count">{count}</span>
            </m.button>
          ))}
        </m.div>
      ) : null}

      <AnimatePresence mode="wait">
        {!visible.length ? (
          <m.div
            key="empty"
            className="flash"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {filter === "mintable"
              ? "No live drops right now."
              : filter === "upcoming"
                ? "No upcoming drops yet."
                : "No drops yet."}{" "}
            <Link href="/launch" className="text-link">
              Create one
            </Link>
          </m.div>
        ) : (
          <m.div
            key={`grid-${filter}`}
            className="grid-drops"
            variants={staggerFast}
            initial="hidden"
            animate="show"
          >
            {visible.map((c, i) => {
              const cover = c.coverUrl || DROP_COVER_FALLBACKS[i % DROP_COVER_FALLBACKS.length];
              const mintedPct = Math.min(
                100,
                Math.round((c.mintedCount / Math.max(1, c.totalSupply)) * 100),
              );
              const mintable = isMintable(c);
              const highlighted =
                Boolean(highlightSlug) &&
                (c.slug.toLowerCase() === highlightSlug || c.id.toLowerCase() === highlightSlug);
              return (
                <m.div
                  key={c.id}
                  id={`drop-${c.slug.toLowerCase()}`}
                  variants={cardItem}
                  whileHover={{ y: -6 }}
                  transition={springSnappy}
                  className={highlighted ? "drop-tile-wrap is-highlight" : "drop-tile-wrap"}
                >
                  <Link href={`/drops/${c.slug}`} className="drop-tile">
                    <div className="drop-media">
                      <Image
                        src={cover}
                        alt=""
                        fill
                        sizes="(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 360px"
                        loading={i < 3 ? "eager" : "lazy"}
                        unoptimized={!cover.includes("images.unsplash.com")}
                      />
                      <span className={`drop-badge status-${c.status}`}>
                        {collectionStatusLabel(c)}
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
                      <m.span
                        className="supply-fill"
                        initial={{ width: 0 }}
                        whileInView={{ width: `${mintedPct}%` }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
                      />
                    </div>
                    <div className="drop-footer">
                      <span className="muted drop-supply">
                        {c.remainingSupply} of {c.totalSupply} left
                      </span>
                      <span
                        className={
                          mintable
                            ? "btn btn-primary drop-mint-btn"
                            : "btn btn-ghost drop-mint-btn"
                        }
                      >
                        {mintable ? "Mint" : c.status === "scheduled" ? "Soon" : "View"}
                      </span>
                    </div>
                  </Link>
                </m.div>
              );
            })}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

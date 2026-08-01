"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, m } from "framer-motion";
import type { Collection } from "@unipad/shared";
import { api } from "@/lib/api";
import { DROP_COVER_FALLBACKS } from "@/lib/media";
import {
  dropPriceLabel,
  isMintable,
  sortForStorefront,
  statusLabel,
  type DropFilter,
} from "@/lib/drops";
import { DropGrid } from "@/components/DropGrid";
import { fadeUp, springSnappy } from "@/lib/motion";

const FEATURED_COUNT = 3;
const SLIDE_MS = 3000;

function landscapeCover(url: string) {
  if (!url.includes("images.unsplash.com")) return url;
  const base = url.split("?")[0];
  return `${base}?auto=format&fit=crop&w=1600&h=900&q=85`;
}

function coverFor(c: Collection, index: number) {
  return landscapeCover(c.coverUrl || DROP_COVER_FALLBACKS[index % DROP_COVER_FALLBACKS.length]);
}

function viewToFilter(view: string | null): DropFilter {
  if (view === "upcoming") return "upcoming";
  if (view === "all") return "all";
  return "mintable";
}

export function DropsListing() {
  const searchParams = useSearchParams();
  const view = searchParams.get("view");
  const highlight = searchParams.get("highlight")?.trim().toLowerCase() || "";
  const defaultFilter = viewToFilter(view);

  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .listCollections()
      .then((r) => {
        if (!cancelled) setCollections(sortForStorefront(r.collections));
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [view, highlight]);

  const featured = useMemo(() => {
    if (!collections?.length) return [];
    const mintable = collections.filter((c) => isMintable(c));
    const pool = mintable.length >= FEATURED_COUNT ? mintable : collections;
    return pool.slice(0, FEATURED_COUNT);
  }, [collections]);

  const featuredIds = useMemo(() => featured.map((c) => c.id), [featured]);

  useEffect(() => {
    setActive(0);
  }, [featuredIds]);

  useEffect(() => {
    if (!highlight || !collections?.length) return;
    const el = document.getElementById(`drop-${highlight}`);
    if (!el) return;
    const id = window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    return () => window.clearTimeout(id);
  }, [highlight, collections, defaultFilter]);

  const goTo = useCallback(
    (index: number) => {
      if (!featured.length) return;
      setActive(((index % featured.length) + featured.length) % featured.length);
    },
    [featured.length],
  );

  useEffect(() => {
    if (featured.length < 2 || paused) return;
    const id = window.setInterval(() => {
      setActive((i) => (i + 1) % featured.length);
    }, SLIDE_MS);
    return () => window.clearInterval(id);
  }, [featured.length, paused, active]);

  return (
    <m.div
      className="drops-listing"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      {featured.length ? (
        <m.div
          className="featured-carousel"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
          }}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="featured-carousel-viewport">
            <m.div
              className="featured-carousel-track"
              animate={{ x: `-${active * 100}%` }}
              transition={{ type: "spring", stiffness: 260, damping: 32 }}
            >
              {featured.map((drop, i) => {
                const mintable = isMintable(drop);
                return (
                  <Link
                    key={drop.id}
                    href={`/drops/${drop.slug}`}
                    className={`featured-drop${mintable ? " is-live" : " is-soon"}`}
                    aria-hidden={i !== active}
                    tabIndex={i === active ? 0 : -1}
                  >
                    <div className="featured-drop-media">
                      <Image
                        src={coverFor(drop, i)}
                        alt=""
                        fill
                        priority={i === 0}
                        sizes="(max-width: 860px) 100vw, 640px"
                        style={{ objectFit: "cover", objectPosition: "center" }}
                        unoptimized={!coverFor(drop, i).includes("images.unsplash.com")}
                      />
                    </div>

                    <div className="featured-drop-panel">
                      <div className="featured-drop-top">
                        <span className="featured-drop-kicker">Trending</span>
                        <span className="featured-drop-status">{statusLabel(drop.status)}</span>
                      </div>

                      <h2 className="featured-drop-title">{drop.name}</h2>
                      <p className="featured-drop-creator">
                        by <span>{drop.creatorDisplayName || "Creator"}</span>
                      </p>

                      <div className="featured-drop-stats" role="list">
                        <div className="featured-drop-stat" role="listitem">
                          <span className="featured-drop-stat-label">Price</span>
                          <span className="featured-drop-stat-value">{dropPriceLabel(drop)}</span>
                        </div>
                        <div className="featured-drop-stat" role="listitem">
                          <span className="featured-drop-stat-label">Supply</span>
                          <span className="featured-drop-stat-value">
                            {drop.remainingSupply}
                            <span className="featured-drop-stat-soft"> / {drop.totalSupply}</span>
                          </span>
                        </div>
                        <div className="featured-drop-stat" role="listitem">
                          <span className="featured-drop-stat-label">Phase</span>
                          <span className="featured-drop-stat-value">
                            {drop.activePhase?.name || drop.phases[0]?.name || "Public"}
                          </span>
                        </div>
                      </div>

                      <span className="btn featured-drop-cta">
                        {mintable ? "Mint now" : "View drop"}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </m.div>
          </div>

          {featured.length > 1 ? (
            <div className="featured-carousel-controls" role="tablist" aria-label="Trending drops">
              {featured.map((drop, i) => (
                <m.button
                  key={drop.id}
                  type="button"
                  role="tab"
                  aria-selected={i === active}
                  aria-label={`Show ${drop.name}`}
                  className={`featured-carousel-dot${i === active ? " is-active" : ""}`}
                  onClick={() => goTo(i)}
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.95 }}
                  transition={springSnappy}
                >
                  {i === active && !paused ? (
                    <span
                      key={`${drop.id}-${active}`}
                      className="featured-carousel-progress"
                      style={{ animationDuration: `${SLIDE_MS}ms` }}
                    />
                  ) : null}
                </m.button>
              ))}
            </div>
          ) : null}
        </m.div>
      ) : null}

      <m.div
        className="section-head drops-listing-head"
        variants={fadeUp}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.4 }}
      >
        <div>
          <h2>All drops</h2>
          <p>Mint live NFTs with UCT — pay once, we finish the mint.</p>
        </div>
        <m.div whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} transition={springSnappy}>
          <Link href="/launch" className="btn btn-signal">
            Create a drop
          </Link>
        </m.div>
      </m.div>

      <AnimatePresence mode="wait">
        <DropGrid
          key={defaultFilter}
          filterable
          defaultFilter={defaultFilter}
          excludeIds={featuredIds}
          collections={collections}
          error={error}
          highlightSlug={highlight || undefined}
        />
      </AnimatePresence>
    </m.div>
  );
}

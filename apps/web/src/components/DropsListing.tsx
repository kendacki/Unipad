"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Collection } from "@unipad/shared";
import { api } from "@/lib/api";
import { DROP_COVER_FALLBACKS } from "@/lib/media";
import { dropPriceLabel, isMintable, sortForStorefront, statusLabel } from "@/lib/drops";
import { DropGrid } from "@/components/DropGrid";

const FEATURED_COUNT = 3;
const SLIDE_MS = 3000;

/** Wide landscape crop for the featured banner */
function landscapeCover(url: string) {
  if (!url.includes("images.unsplash.com")) return url;
  const base = url.split("?")[0];
  return `${base}?auto=format&fit=crop&w=1600&h=900&q=85`;
}

function coverFor(c: Collection, index: number) {
  return landscapeCover(c.coverUrl || DROP_COVER_FALLBACKS[index % DROP_COVER_FALLBACKS.length]);
}

export function DropsListing() {
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
  }, []);

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
    <div className="drops-listing">
      {featured.length ? (
        <div
          className="featured-carousel"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
          }}
        >
          <div className="featured-carousel-viewport">
            <div
              className="featured-carousel-track"
              style={{ transform: `translate3d(-${active * 100}%, 0, 0)` }}
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
                      />
                    </div>

                    <div className="featured-drop-panel">
                      <div className="featured-drop-top">
                        <span className="featured-drop-kicker">
                          Trending · {i + 1}/{featured.length}
                        </span>
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
            </div>
          </div>

          {featured.length > 1 ? (
            <div className="featured-carousel-controls" role="tablist" aria-label="Trending drops">
              {featured.map((drop, i) => (
                <button
                  key={drop.id}
                  type="button"
                  role="tab"
                  aria-selected={i === active}
                  aria-label={`Show ${drop.name}`}
                  className={`featured-carousel-dot${i === active ? " is-active" : ""}`}
                  onClick={() => goTo(i)}
                >
                  {i === active && !paused ? (
                    <span
                      key={`${drop.id}-${active}`}
                      className="featured-carousel-progress"
                      style={{ animationDuration: `${SLIDE_MS}ms` }}
                    />
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="section-head drops-listing-head">
        <div>
          <h2>All drops</h2>
          <p>Mint live NFTs with UCT — pay once, we finish the mint.</p>
        </div>
        <Link href="/launch" className="btn btn-signal">
          Create a drop
        </Link>
      </div>

      <DropGrid
        filterable
        defaultFilter="mintable"
        excludeIds={featuredIds}
        collections={collections}
        error={error}
      />
    </div>
  );
}

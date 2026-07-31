import type { Context, Next } from "hono";
import { withRedis } from "../db/redis.js";
import { env } from "../env.js";

const memoryBuckets = new Map<string, { tokens: number; updatedAt: number }>();

async function takeToken(key: string, limit: number, windowSec: number): Promise<{
  ok: boolean;
  remaining: number;
  resetSec: number;
}> {
  return withRedis(
    async (redis) => {
      const redisKey = `rl:${key}`;
      const count = await redis.incr(redisKey);
      if (count === 1) await redis.expire(redisKey, windowSec);
      const ttl = await redis.ttl(redisKey);
      const resetSec = ttl > 0 ? ttl : windowSec;
      return {
        ok: count <= limit,
        remaining: Math.max(0, limit - count),
        resetSec,
      };
    },
    () => {
      const now = Date.now();
      const bucket = memoryBuckets.get(key) ?? { tokens: 0, updatedAt: now };
      if (now - bucket.updatedAt > windowSec * 1000) {
        bucket.tokens = 0;
        bucket.updatedAt = now;
      }
      bucket.tokens += 1;
      memoryBuckets.set(key, bucket);
      const elapsed = Math.floor((now - bucket.updatedAt) / 1000);
      return {
        ok: bucket.tokens <= limit,
        remaining: Math.max(0, limit - bucket.tokens),
        resetSec: Math.max(1, windowSec - elapsed),
      };
    },
  );
}

function clientIp(c: Context): string {
  // Prefer proxy headers set by the load balancer / nginx edge.
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return c.req.header("x-real-ip") || "local";
}

function setLimitHeaders(
  c: Context,
  limit: number,
  remaining: number,
  resetSec: number,
) {
  c.header("X-RateLimit-Limit", String(limit));
  c.header("X-RateLimit-Remaining", String(remaining));
  c.header("X-RateLimit-Reset", String(resetSec));
}

/** Per-IP + optional per-wallet token bucket (audit §9.2). */
export function rateLimit(opts: {
  name: string;
  limit: number;
  windowSec?: number;
  walletAware?: boolean;
}) {
  const windowSec = opts.windowSec ?? 60;
  return async (c: Context, next: Next) => {
    const ip = clientIp(c);
    const ipResult = await takeToken(`${opts.name}:ip:${ip}`, opts.limit, windowSec);
    setLimitHeaders(c, opts.limit, ipResult.remaining, ipResult.resetSec);

    if (!ipResult.ok) {
      c.header("Retry-After", String(ipResult.resetSec));
      return c.json(
        {
          error: "Rate limit exceeded",
          code: "UPAD_RATE_LIMIT",
          retryAfterSec: ipResult.resetSec,
        },
        429,
      );
    }

    if (opts.walletAware) {
      const auth = c.req.header("Authorization");
      if (auth?.startsWith("Bearer ")) {
        // coarse wallet key from token suffix — enough for MVP shaping
        const walletKey = auth.slice(-24);
        const walletLimit = Math.max(4, Math.floor(opts.limit / 2));
        const walletOk = await takeToken(
          `${opts.name}:wal:${walletKey}`,
          walletLimit,
          windowSec,
        );
        if (!walletOk.ok) {
          c.header("Retry-After", String(walletOk.resetSec));
          setLimitHeaders(c, walletLimit, walletOk.remaining, walletOk.resetSec);
          return c.json(
            {
              error: "Wallet rate limit exceeded",
              code: "UPAD_RATE_LIMIT",
              retryAfterSec: walletOk.resetSec,
            },
            429,
          );
        }
      }
    }

    // Stricter policy for creator console (audit S-10)
    if (opts.name === "creators" && env.creatorRateLimitStrict) {
      const strictLimit = env.creatorRateLimitPerMin;
      const strictOk = await takeToken(`creators-strict:ip:${ip}`, strictLimit, 60);
      if (!strictOk.ok) {
        c.header("Retry-After", String(strictOk.resetSec));
        return c.json(
          {
            error: "Creator rate limit exceeded",
            code: "UPAD_RATE_LIMIT",
            retryAfterSec: strictOk.resetSec,
          },
          429,
        );
      }
    }

    await next();
  };
}

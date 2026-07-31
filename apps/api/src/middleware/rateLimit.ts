import type { Context, Next } from "hono";
import { withRedis } from "../db/redis.js";
import { env } from "../env.js";

const memoryBuckets = new Map<string, { tokens: number; updatedAt: number }>();

async function takeToken(key: string, limit: number, windowSec: number): Promise<boolean> {
  return withRedis(
    async (redis) => {
      const redisKey = `rl:${key}`;
      const count = await redis.incr(redisKey);
      if (count === 1) await redis.expire(redisKey, windowSec);
      return count <= limit;
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
      return bucket.tokens <= limit;
    },
  );
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
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      c.req.header("x-real-ip") ||
      "local";
    const ipOk = await takeToken(`${opts.name}:ip:${ip}`, opts.limit, windowSec);
    if (!ipOk) {
      return c.json(
        { error: "Rate limit exceeded", code: "UPAD_RATE_LIMIT", retryAfterSec: windowSec },
        429,
      );
    }

    if (opts.walletAware) {
      const auth = c.req.header("Authorization");
      if (auth?.startsWith("Bearer ")) {
        // coarse wallet key from token suffix — enough for MVP shaping
        const walletKey = auth.slice(-24);
        const walletOk = await takeToken(
          `${opts.name}:wal:${walletKey}`,
          Math.max(4, Math.floor(opts.limit / 2)),
          windowSec,
        );
        if (!walletOk) {
          return c.json(
            {
              error: "Wallet rate limit exceeded",
              code: "UPAD_RATE_LIMIT",
              retryAfterSec: windowSec,
            },
            429,
          );
        }
      }
    }

    // Stricter policy for creator console (audit S-10)
    if (opts.name === "creators" && env.creatorRateLimitStrict) {
      const strictOk = await takeToken(`creators-strict:ip:${ip}`, 30, 60);
      if (!strictOk) {
        return c.json(
          { error: "Creator rate limit exceeded", code: "UPAD_RATE_LIMIT" },
          429,
        );
      }
    }

    await next();
  };
}

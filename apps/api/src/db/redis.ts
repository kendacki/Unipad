import Redis from "ioredis";
import { env } from "../env.js";

let client: Redis | null | undefined;

export function getRedis(): Redis | null {
  if (client === null) return null;
  if (client) return client;
  try {
    client = new Redis(env.redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    client.on("error", () => {
      /* fall back to memory rate limits */
    });
    return client;
  } catch {
    client = null;
    return null;
  }
}

export async function withRedis<T>(
  fn: (r: Redis) => Promise<T>,
  fallback: () => Promise<T> | T,
): Promise<T> {
  const r = getRedis();
  if (!r) return fallback();
  try {
    return await fn(r);
  } catch {
    return fallback();
  }
}

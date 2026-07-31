import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

// Prefer repo-root .env when running from apps/api
loadEnv({ path: resolve(process.cwd(), "../../.env") });
loadEnv();

export const env = {
  port: Number(process.env.PORT ?? 8787),
  databaseUrl:
    process.env.DATABASE_URL ?? "postgres://unipad:unipad@localhost:5432/unipad",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-change-me-unipad",
  authDomain: process.env.AUTH_DOMAIN ?? "localhost",
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
  treasuryPrincipal: process.env.TREASURY_PRINCIPAL ?? "@unipad",
  platformFeeBps: Number(process.env.PLATFORM_FEE_BPS ?? 250),
  mintConcurrency: Number(process.env.MINT_CONCURRENCY ?? 8),
  creatorRateLimitStrict: process.env.CREATOR_RATE_LIMIT_STRICT !== "false",
  uploadDir: process.env.UPLOAD_DIR ?? resolve(process.cwd(), "uploads"),
  publicApiUrl: process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 8787}`,
  devMock: process.env.UNIPAD_DEV_MOCK === "true",
  sessionTtlSeconds: Number(process.env.SESSION_TTL_SECONDS ?? 7200),
};

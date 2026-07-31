import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { parseUct } from "@unipad/shared";
import { env } from "./env.js";
import {
  AuthError,
  issueChallenge,
  mockSession,
  requireAuth,
  verifyChallenge,
} from "./auth/session.js";
import * as collections from "./services/collections.js";
import { saveMediaUpload } from "./services/media.js";
import { rateLimit } from "./middleware/rateLimit.js";
import { queueDepth } from "./services/queue.js";

const phaseSchema = z.object({
  type: z.enum(["creator", "allowlist", "public"]),
  name: z.string().min(1),
  priceUct: z.string().min(1),
  maxPerWallet: z.number().int().min(1).max(50).default(1),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  supplyCap: z.number().int().nullable().optional(),
});

const createCollectionSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().max(2000).default(""),
  totalSupply: z.number().int().min(1).max(100_000),
  royaltyBps: z.number().int().min(0).max(2000).default(500),
  coverUrl: z.string().url().optional().or(z.literal("")).optional(),
  launchAt: z.string().datetime().nullable().optional(),
  phases: z.array(phaseSchema).min(1),
});

function normalizePrice(raw: string): string {
  // Creators send human UCT ("25"). Digits-only values that already look like
  // 18-decimal base units (>= 1e15 ≈ 0.001 UCT) are left as-is.
  if (/^\d+$/.test(raw)) {
    const n = BigInt(raw);
    if (n >= 1_000_000_000_000_000n) return raw;
    return parseUct(raw);
  }
  return parseUct(raw);
}

export function buildApp() {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: env.frontendOrigin,
      allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
      allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
    }),
  );

  // Baseline API shaping — load balancer also enforces edge limits.
  // /health stays unlimited so LB probes never trip application buckets.
  app.use(
    "/v1/*",
    rateLimit({ name: "global", limit: env.globalRateLimitPerMin }),
  );

  app.get("/health", (c) =>
    c.json({
      ok: true,
      service: "unipad-api",
      mock: env.devMock,
      queue: queueDepth(),
    }),
  );

  // Static uploads (media pipeline local origin)
  app.get(
    "/uploads/:file",
    rateLimit({ name: "uploads", limit: 120 }),
    async (c) => {
    const file = c.req.param("file").replace(/[^a-zA-Z0-9._-]/g, "");
    try {
      const buf = await readFile(join(env.uploadDir, file));
      const ext = file.split(".").pop()?.toLowerCase();
      const type =
        ext === "png"
          ? "image/png"
          : ext === "webp"
            ? "image/webp"
            : ext === "gif"
              ? "image/gif"
              : "image/jpeg";
      return new Response(buf, {
        headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400" },
      });
    } catch {
      return c.json({ error: "Not found" }, 404);
    }
  },
  );

  // --- Auth (strict — challenge spam / credential stuffing) ---
  app.get(
    "/v1/auth/challenge",
    rateLimit({ name: "auth", limit: env.authRateLimitPerMin }),
    async (c) => {
      const chainPubkey = c.req.query("chainPubkey");
      if (!chainPubkey) return c.json({ error: "chainPubkey required" }, 400);
      try {
        return c.json(await issueChallenge(chainPubkey.toLowerCase()));
      } catch (err) {
        return c.json({ error: (err as Error).message }, 400);
      }
    },
  );

  app.post(
    "/v1/auth/verify",
    rateLimit({ name: "auth", limit: env.authRateLimitPerMin }),
    async (c) => {
      const body = await c.req.json().catch(() => ({}));
      const { nonce, signature } = body as { nonce?: string; signature?: string };
      if (!nonce || !signature) {
        return c.json({ error: "nonce and signature required" }, 400);
      }
      try {
        return c.json(await verifyChallenge(nonce, signature));
      } catch (err) {
        return c.json({ error: (err as Error).message }, 401);
      }
    },
  );

  app.post(
    "/v1/auth/mock",
    rateLimit({ name: "auth", limit: Math.min(10, env.authRateLimitPerMin) }),
    async (c) => {
      const body = await c.req.json().catch(() => ({}));
      const role = (body as { role?: string }).role === "buyer" ? "buyer" : "creator";
      try {
        return c.json(await mockSession(role));
      } catch (err) {
        return c.json({ error: (err as Error).message }, 403);
      }
    },
  );

  app.get("/v1/me", rateLimit({ name: "session", limit: 60 }), async (c) => {
    try {
      const session = await requireAuth(c.req.header("Authorization"));
      return c.json({ principal: session.principal, mock: session.mock });
    } catch (err) {
      return handleAuth(c, err);
    }
  });

  // --- Public storefront ---
  app.get("/v1/collections", rateLimit({ name: "storefront", limit: 120 }), async (c) => {
    const status = c.req.query("status") ?? undefined;
    return c.json({ collections: await collections.listCollections(status) });
  });

  app.get("/v1/collections/:id", rateLimit({ name: "storefront", limit: 120 }), async (c) => {
    const col = await collections.getCollection(c.req.param("id"));
    if (!col) return c.json({ error: "Not found" }, 404);
    return c.json(col);
  });

  app.get(
    "/v1/wallets/:principal/tokens",
    rateLimit({ name: "storefront", limit: 60 }),
    async (c) => {
      return c.json({ tokens: await collections.listWalletTokens(c.req.param("principal")) });
    },
  );

  // --- Media ---
  app.post(
    "/v1/media/upload",
    rateLimit({ name: "media", limit: 20 }),
    async (c) => {
      try {
        const session = await requireAuth(c.req.header("Authorization"));
        const form = await c.req.parseBody();
        const file = form.file;
        if (!file || typeof file === "string") {
          return c.json({ error: "file required" }, 400);
        }
        const bytes = Buffer.from(await file.arrayBuffer());
        const saved = await saveMediaUpload({
          uploaderPrincipal: session.principal,
          collectionId: typeof form.collectionId === "string" ? form.collectionId : null,
          filename: file.name || "upload.bin",
          mimeType: file.type || "application/octet-stream",
          bytes,
        });
        return c.json(saved, 201);
      } catch (err) {
        return handleErr(c, err);
      }
    },
  );

  // --- Creator console (stricter rate limit — audit S-10) ---
  app.get(
    "/v1/creators/collections",
    rateLimit({ name: "creators", limit: 60 }),
    async (c) => {
      try {
        const session = await requireAuth(c.req.header("Authorization"));
        return c.json({
          collections: await collections.listCreatorCollections(session.principal),
        });
      } catch (err) {
        return handleAuth(c, err);
      }
    },
  );

  app.post(
    "/v1/creators/collections",
    rateLimit({ name: "creators", limit: 30 }),
    async (c) => {
      try {
        const session = await requireAuth(c.req.header("Authorization"));
        const raw = await c.req.json();
        const parsed = createCollectionSchema.safeParse(raw);
        if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
        const input = {
          ...parsed.data,
          coverUrl: parsed.data.coverUrl || undefined,
          phases: parsed.data.phases.map((p) => ({
            ...p,
            priceUct: normalizePrice(p.priceUct),
          })),
        };
        return c.json(await collections.createCollection(session.principal, input), 201);
      } catch (err) {
        return handleErr(c, err);
      }
    },
  );

  app.post("/v1/creators/collections/:id/publish", rateLimit({ name: "creators", limit: 30 }), async (c) => {
    try {
      const session = await requireAuth(c.req.header("Authorization"));
      return c.json(
        await collections.publishCollection(session.principal, c.req.param("id")),
      );
    } catch (err) {
      return handleErr(c, err);
    }
  });

  app.patch(
    "/v1/creators/collections/:id/phases",
    rateLimit({ name: "creators", limit: 30 }),
    async (c) => {
      try {
        const session = await requireAuth(c.req.header("Authorization"));
        const body = await c.req.json();
        const parsed = z.object({ phases: z.array(phaseSchema).min(1) }).safeParse(body);
        if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
        const phases = parsed.data.phases.map((p) => ({
          ...p,
          priceUct: normalizePrice(p.priceUct),
        }));
        return c.json(
          await collections.replacePhases(session.principal, c.req.param("id"), phases),
        );
      } catch (err) {
        return handleErr(c, err);
      }
    },
  );

  app.get("/v1/creators/collections/:id/allowlist", rateLimit({ name: "creators", limit: 60 }), async (c) => {
    try {
      const session = await requireAuth(c.req.header("Authorization"));
      const phaseId = c.req.query("phaseId") ?? undefined;
      return c.json({
        entries: await collections.listAllowlist(
          session.principal,
          c.req.param("id"),
          phaseId,
        ),
      });
    } catch (err) {
      return handleErr(c, err);
    }
  });

  app.post(
    "/v1/creators/collections/:id/allowlist",
    rateLimit({ name: "creators", limit: 30 }),
    async (c) => {
      try {
        const session = await requireAuth(c.req.header("Authorization"));
        const body = await c.req.json();
        const parsed = z
          .object({
            phaseId: z.string().uuid(),
            entries: z
              .array(
                z.object({
                  walletPrincipal: z.string().min(1),
                  maxMints: z.number().int().min(1).max(50).optional(),
                }),
              )
              .min(1)
              .max(5000),
          })
          .safeParse(body);
        if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
        const entries = await collections.upsertAllowlist(
          session.principal,
          c.req.param("id"),
          parsed.data.phaseId,
          parsed.data.entries,
        );
        return c.json({ entries });
      } catch (err) {
        return handleErr(c, err);
      }
    },
  );

  app.get("/v1/creators/:id/royalties", rateLimit({ name: "creators", limit: 60 }), async (c) => {
    try {
      const session = await requireAuth(c.req.header("Authorization"));
      const id = c.req.param("id");
      if (id !== "me" && id !== session.principal) {
        return c.json({ error: "Forbidden" }, 403);
      }
      return c.json(await collections.getCreatorRoyalties(session.principal));
    } catch (err) {
      return handleErr(c, err);
    }
  });

  // --- Mint (pay-then-mint) ---
  app.post(
    "/v1/collections/:id/mint-intent",
    rateLimit({ name: "mint", limit: 40, walletAware: true }),
    async (c) => {
      try {
        const session = await requireAuth(c.req.header("Authorization"));
        return c.json(
          await collections.createMintIntent(session.principal, c.req.param("id")),
        );
      } catch (err) {
        return handleErr(c, err);
      }
    },
  );

  app.post(
    "/v1/collections/:id/mint",
    rateLimit({ name: "mint", limit: 40, walletAware: true }),
    async (c) => {
      try {
        const session = await requireAuth(c.req.header("Authorization"));
        const body = (await c.req.json()) as {
          idempotencyKey?: string;
          paymentRef?: string;
        };
        const key = c.req.header("Idempotency-Key") ?? body.idempotencyKey;
        if (!key) return c.json({ error: "Idempotency-Key required" }, 400);
        if (!body.paymentRef) return c.json({ error: "paymentRef required" }, 400);

        return c.json(
          await collections.submitMint({
            walletPrincipal: session.principal,
            collectionIdOrSlug: c.req.param("id"),
            idempotencyKey: key,
            paymentRef: body.paymentRef,
          }),
        );
      } catch (err) {
        return handleErr(c, err);
      }
    },
  );

  app.get(
    "/v1/collections/:id/mint-status/:idempotencyKey",
    rateLimit({ name: "mint", limit: 60, walletAware: true }),
    async (c) => {
      try {
        const session = await requireAuth(c.req.header("Authorization"));
        return c.json(
          await collections.getMintStatus(c.req.param("idempotencyKey"), session.principal),
        );
      } catch (err) {
        return handleErr(c, err);
      }
    },
  );

  return app;
}

function mapErrorCode(status: number, message: string): string {
  const m = message.toLowerCase();
  if (status === 401) return "UPAD_UNAUTHORIZED";
  if (status === 429 || m.includes("rate limit")) return "UPAD_RATE_LIMIT";
  if (m.includes("sold out") || m.includes("sold_out")) return "UPAD_SOLD_OUT";
  if (m.includes("allowlist")) return m.includes("cap") ? "UPAD_MINT_CAP" : "UPAD_NOT_ALLOWLISTED";
  if (m.includes("mint cap")) return "UPAD_MINT_CAP";
  if (m.includes("creator phase")) return "UPAD_CREATOR_ONLY";
  if (m.includes("no active mint")) return "UPAD_NO_PHASE";
  if (m.includes("not mintable")) return "UPAD_NOT_MINTABLE";
  if (m.includes("paymentref required")) return "UPAD_PAYMENT_REQUIRED";
  if (m.includes("paymentref already") || m.includes("already settled")) return "UPAD_PAYMENT_USED";
  if (m.includes("memo mismatch") || m.includes("mock payments")) return "UPAD_PAYMENT_MISMATCH";
  if (m.includes("idempotency")) return "UPAD_IDEMPOTENCY";
  if (status === 404 || m.includes("not found") || m.includes("unknown mint")) return "UPAD_NOT_FOUND";
  if (status === 403) return "UPAD_FORBIDDEN";
  if (status === 400) return "UPAD_VALIDATION";
  return "UPAD_UNKNOWN";
}

function handleAuth(c: { json: (b: unknown, s?: number) => Response }, err: unknown) {
  const message = err instanceof AuthError ? err.message : (err as Error).message;
  const status = err instanceof AuthError ? err.status : 401;
  return c.json(
    { error: message, code: mapErrorCode(status, message), status },
    status as 401,
  );
}

function handleErr(c: { json: (b: unknown, s?: number) => Response }, err: unknown) {
  if (err instanceof AuthError) return handleAuth(c, err);
  const status = (err as { status?: number }).status ?? 500;
  const message = (err as Error).message ?? "Server error";
  if (status >= 500) console.error(err);
  return c.json(
    { error: message, code: mapErrorCode(status, message), status },
    status as 400,
  );
}

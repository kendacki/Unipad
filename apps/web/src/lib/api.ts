import type {
  AuthSession,
  AllowlistEntry,
  Collection,
  CreateCollectionInput,
  MediaUploadResult,
  MintIntentResponse,
  MintResult,
  RoyaltyEntry,
  RoyaltySummary,
} from "@unipad/shared";
import { ApiError } from "@/lib/errors";

/**
 * Resolve API base per request (never cache at module load).
 * Browser → same-origin so My mints hits this deployment’s ledger.
 */
function apiUrl(): string {
  if (typeof window !== "undefined") return "";
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.NEXT_PUBLIC_VERCEL_URL) {
    return `https://${process.env.NEXT_PUBLIC_VERCEL_URL.replace(/\/$/, "")}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`;
  }
  return "http://localhost:8787";
}

async function request<T>(
  path: string,
  init: RequestInit & { token?: string; json?: boolean } = {},
): Promise<T> {
  const { token, headers, json = true, ...rest } = init;
  const method = String(rest.method || "GET").toUpperCase();
  const sendJsonHeader = json && method !== "GET" && method !== "HEAD";
  let res: Response;
  try {
    res = await fetch(`${apiUrl()}${path}`, {
      cache: "no-store",
      ...rest,
      headers: {
        ...(sendJsonHeader ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
  } catch {
    throw new ApiError("Network error", { code: "UPAD_NETWORK", status: 0 });
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const payload = data as { error?: string; code?: string };
    throw new ApiError(payload.error || res.statusText, {
      code: payload.code,
      status: res.status,
    });
  }
  return data as T;
}

export const api = {
  listCollections: (status?: string) =>
    request<{ collections: Collection[] }>(
      status ? `/v1/collections?status=${encodeURIComponent(status)}` : "/v1/collections",
    ),
  getCollection: (id: string, token?: string) =>
    request<Collection>(`/v1/collections/${id}`, { token }),
  createCollection: (token: string, body: CreateCollectionInput) =>
    request<Collection>("/v1/creators/collections", {
      method: "POST",
      token,
      body: JSON.stringify(body),
    }),
  listCreatorCollections: (token: string) =>
    request<{ collections: Collection[] }>("/v1/creators/collections", { token }),
  publishCollection: (token: string, id: string) =>
    request<Collection>(`/v1/creators/collections/${id}/publish`, {
      method: "POST",
      token,
    }),
  replacePhases: (
    token: string,
    id: string,
    phases: CreateCollectionInput["phases"],
  ) =>
    request<Collection>(`/v1/creators/collections/${id}/phases`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ phases }),
    }),
  listAllowlist: (token: string, id: string, phaseId?: string) =>
    request<{ entries: AllowlistEntry[] }>(
      `/v1/creators/collections/${id}/allowlist${phaseId ? `?phaseId=${phaseId}` : ""}`,
      { token },
    ),
  upsertAllowlist: (
    token: string,
    id: string,
    phaseId: string,
    entries: Array<{ walletPrincipal: string; maxMints?: number }>,
  ) =>
    request<{ entries: AllowlistEntry[] }>(`/v1/creators/collections/${id}/allowlist`, {
      method: "POST",
      token,
      body: JSON.stringify({ phaseId, entries }),
    }),
  royalties: (token: string) =>
    request<{ summary: RoyaltySummary; entries: RoyaltyEntry[] }>(
      "/v1/creators/me/royalties",
      { token },
    ),
  payoutRoyalties: (
    token: string,
    body: {
      amountUct: string;
      recipient: string;
      paymentRef?: string | null;
      senderNametag?: string | null;
    },
  ) =>
    request<{
      summary: RoyaltySummary;
      entries: RoyaltyEntry[];
      paidUct: string;
    }>("/v1/creators/me/royalties/payout", {
      method: "POST",
      token,
      body: JSON.stringify(body),
    }),
  /** Prefer Vercel Blob client upload for covers; falls back to API multipart. */
  uploadMedia: async (token: string, file: File, collectionId?: string) => {
    try {
      const { upload } = await import("@vercel/blob/client");
      const blob = await upload(`covers/${file.name}`, file, {
        access: "public",
        // Always same-origin Next route so covers land in Vercel Blob.
        handleUploadUrl: "/v1/media/upload",
        contentType: file.type || "application/octet-stream",
      });
      return {
        id: blob.pathname,
        url: blob.url,
        contentHash: blob.pathname,
        deduped: false,
      } satisfies MediaUploadResult;
    } catch {
      const form = new FormData();
      form.append("file", file);
      if (collectionId) form.append("collectionId", collectionId);
      return request<MediaUploadResult>("/v1/media/upload", {
        method: "POST",
        token,
        json: false,
        body: form,
      });
    }
  },
  mintIntent: (token: string, id: string, nametag?: string | null) =>
    request<MintIntentResponse>(`/v1/collections/${id}/mint-intent`, {
      method: "POST",
      token,
      body: JSON.stringify(nametag ? { nametag } : {}),
    }),
  mint: (token: string, id: string, idempotencyKey: string, paymentRef: string) =>
    request<MintResult>(`/v1/collections/${id}/mint`, {
      method: "POST",
      token,
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ idempotencyKey, paymentRef }),
    }),
  mintStatus: (token: string, id: string, key: string) =>
    request<MintResult>(`/v1/collections/${id}/mint-status/${key}`, { token }),
  challenge: (chainPubkey: string) =>
    request<{ nonce: string; challenge: string; expiresAt: number }>(
      `/v1/auth/challenge?chainPubkey=${encodeURIComponent(chainPubkey)}`,
    ),
  verify: (nonce: string, signature: string) =>
    request<AuthSession>("/v1/auth/verify", {
      method: "POST",
      body: JSON.stringify({ nonce, signature }),
    }),
  walletTokens: (principal: string, nametag?: string | null) => {
    const params = new URLSearchParams();
    if (nametag) params.set("nametag", nametag);
    params.set("_", String(Date.now()));
    const q = `?${params.toString()}`;
    return request<{
      tokens: Array<{
        collectionId: string;
        collectionName: string;
        slug: string;
        coverUrl: string | null;
        tokenId: number;
        mintTxRef: string;
        mintedAt: string;
        ownerPrincipal?: string;
      }>;
    }>(`/v1/wallets/${encodeURIComponent(principal)}/tokens${q}`);
  },
  /** Prefer for My mints — uses the session JWT principal (avoids client principal drift). */
  myTokens: (token: string, nametag?: string | null) => {
    const params = new URLSearchParams();
    if (nametag) params.set("nametag", nametag);
    params.set("_", String(Date.now()));
    const q = `?${params.toString()}`;
    return request<{
      principal: string;
      tokens: Array<{
        collectionId: string;
        collectionName: string;
        slug: string;
        coverUrl: string | null;
        tokenId: number;
        mintTxRef: string;
        mintedAt: string;
        ownerPrincipal?: string;
      }>;
    }>(`/v1/me/tokens${q}`, { token });
  },
  transferToken: (
    token: string,
    body: { collectionId: string; tokenId: number; to: string; nametag?: string | null },
  ) =>
    request<{
      ok: boolean;
      token: {
        collectionId: string;
        collectionName: string;
        slug: string;
        coverUrl: string | null;
        tokenId: number;
        mintTxRef: string;
        mintedAt: string;
        ownerPrincipal: string;
      };
    }>("/v1/me/tokens/transfer", {
      method: "POST",
      token,
      body: JSON.stringify({
        collectionId: body.collectionId,
        tokenId: body.tokenId,
        to: body.to,
        nametag: body.nametag ?? undefined,
      }),
    }),
};

export { apiUrl as resolveApiUrl };
/** @deprecated use resolveApiUrl() — kept for WS base fallback */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
  (typeof window !== "undefined" ? "" : "http://localhost:8787");

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

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

async function request<T>(
  path: string,
  init: RequestInit & { token?: string; json?: boolean } = {},
): Promise<T> {
  const { token, headers, json = true, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: {
        ...(json ? { "Content-Type": "application/json" } : {}),
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
  getCollection: (id: string) => request<Collection>(`/v1/collections/${id}`),
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
  uploadMedia: async (token: string, file: File, collectionId?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (collectionId) form.append("collectionId", collectionId);
    return request<MediaUploadResult>("/v1/media/upload", {
      method: "POST",
      token,
      json: false,
      body: form,
    });
  },
  mintIntent: (token: string, id: string) =>
    request<MintIntentResponse>(`/v1/collections/${id}/mint-intent`, {
      method: "POST",
      token,
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
  walletTokens: (principal: string) =>
    request<{
      tokens: Array<{
        collectionId: string;
        collectionName: string;
        slug: string;
        coverUrl: string | null;
        tokenId: number;
        mintTxRef: string;
        mintedAt: string;
      }>;
    }>(`/v1/wallets/${encodeURIComponent(principal)}/tokens`),
};

export { API_URL };

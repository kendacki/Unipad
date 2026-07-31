/**
 * Unicity / Sphere constants aligned with:
 * - https://github.com/unicity-sphere/sphere-sdk (CONNECT.md)
 * - https://github.com/unicitynetwork/unicity-ids (testnet asset registry)
 */

export { normalizeSphereRecipient } from "@unipad/shared";

/** Canonical UCT fungible coin id on Unicity testnet (64-hex, lowercase). */
export const UCT_COIN_ID =
  process.env.NEXT_PUBLIC_UCT_COIN_ID ??
  "455ad8720656b08e8dbd5bac1f3c73eeea5431565f6c1c3af742b1aa12d41d89";

/** Official UCT decimals (unicity-ids / Sphere token registry). */
export const UCT_DECIMALS_OFFICIAL = 18;

export const SPHERE_DAPP = {
  name: "Unipad",
  description: "NFT launchpad on Unicity — mint and launch with UCT",
  url: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
} as const;

export const POPUP_SESSION_KEY = "unipad.sphere.popup-session";

export type SendIntentResult = {
  success?: boolean;
  transferId?: string;
  status?: string;
  deliveryPending?: boolean;
};

/**
 * Map Sphere wallet `send` intent result → payment reference.
 * Source: sphere-sdk-connect-example sendResult.ts / wallet ConnectIntentHandler.
 */
export function paymentRefFromSendResult(
  raw: unknown,
  memo: string,
): string {
  if (!raw || typeof raw !== "object") {
    throw new Error("Sphere send returned an empty result");
  }
  const r = raw as SendIntentResult & { error?: string; code?: string };

  if (typeof r.error === "string" && r.error) {
    throw new Error(r.error);
  }

  // Money may already have moved — never retry; use memo-bound stable ref
  if (r.deliveryPending === true) {
    return `sphere-pending:${memo}`;
  }

  if (typeof r.transferId === "string" && r.transferId.length > 0) {
    return r.transferId;
  }

  // Some Sphere builds return success without transferId while delivery is pending.
  if (r.success === true && (r.status === "pending" || r.status === "submitted")) {
    return `sphere-pending:${memo}`;
  }

  throw new Error("Sphere send did not return a transferId");
}

/** True when a session JWT is missing or within 60s of expiry. */
export function isSessionJwtExpired(token: string | null | undefined): boolean {
  if (!token) return true;
  try {
    const part = token.split(".")[1];
    if (!part) return true;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { exp?: number };
    if (typeof payload.exp !== "number") return true;
    return payload.exp * 1000 <= Date.now() + 60_000;
  } catch {
    return true;
  }
}

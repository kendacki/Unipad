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
  const r = raw as SendIntentResult;

  // Money may already have moved — never retry; use memo-bound stable ref
  if (r.deliveryPending === true) {
    return `sphere-pending:${memo}`;
  }

  if (typeof r.transferId === "string" && r.transferId.length > 0) {
    return r.transferId;
  }

  throw new Error("Sphere send did not return a transferId");
}

/**
 * Sphere Connect — browser entry used by the Connect button.
 *
 * MUST be statically imported from client components so `window.open`
 * (popup transport) runs inside the user-gesture window. Dynamic `import()`
 * before `autoConnect` breaks popups on Vercel / Chrome.
 *
 * Spec: https://github.com/unicity-sphere/sphere-sdk/blob/main/docs/CONNECT.md
 */

import {
  INTENT_ACTIONS,
  PERMISSION_SCOPES,
  RPC_METHODS,
  SPHERE_NETWORKS,
} from "@unicitylabs/sphere-sdk/connect";
import { autoConnect, hasExtension, detectTransport } from "@unicitylabs/sphere-sdk/connect/browser";
import { POPUP_SESSION_KEY, UCT_COIN_ID } from "./sphere";

export { INTENT_ACTIONS, PERMISSION_SCOPES, RPC_METHODS, SPHERE_NETWORKS, hasExtension, detectTransport };

export const SPHERE_WALLET_URL = (
  process.env.NEXT_PUBLIC_SPHERE_WALLET_URL ?? "https://sphere.unicity.network"
).replace(/\/$/, "");

/** Must match the window name used by Sphere SDK `connectViaPopup`. */
export const SPHERE_WALLET_WINDOW_NAME = "sphere-wallet";

export const SPHERE_POPUP_FEATURES = "width=420,height=720,scrollbars=yes,resizable=yes";

/** Sphere CloudFront/WAF blocks popup URLs that include localhost / 127.0.0.1. */
export function isLocalDevHost(hostname = typeof window !== "undefined" ? window.location.hostname : "") {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Open / focus the Sphere wallet popup under a user gesture.
 * Uses the same window name as autoConnect so a later reconnect reuses it.
 * No-op when the Sphere extension is available (extension shows its own UI).
 */
export function prepareSpherePaymentWindow(): void {
  if (typeof window === "undefined") return;
  if (hasExtension()) return;

  const origin = encodeURIComponent(window.location.origin);
  const popup = window.open(
    `${SPHERE_WALLET_URL}/connect?origin=${origin}`,
    SPHERE_WALLET_WINDOW_NAME,
    SPHERE_POPUP_FEATURES,
  );
  if (!popup) {
    throw new Error("autoConnect: Failed to open wallet popup — check popup blocker settings");
  }
  try {
    popup.focus();
  } catch {
    /* ignore */
  }
}

/** True when the Connect client still thinks the transport is live. */
export function isSphereClientConnected(client: SphereClient | null | undefined): boolean {
  if (!client) return false;
  const c = client as SphereClient & { isConnected?: boolean };
  return c.isConnected !== false;
}

export const LOCALHOST_SPHERE_BLOCKED =
  "LOCALHOST_SPHERE_BLOCKED: Sphere’s hosted wallet blocks localhost (CloudFront 403). Install the Sphere browser extension, or open Unipad on a public HTTPS URL (Vercel/ngrok).";

const CONNECT_PERMISSIONS = [
  PERMISSION_SCOPES.IDENTITY_READ,
  PERMISSION_SCOPES.BALANCE_READ,
  PERMISSION_SCOPES.TOKENS_READ,
  PERMISSION_SCOPES.TRANSFER_REQUEST,
  PERMISSION_SCOPES.SIGN_REQUEST,
] as const;

export type SphereClient = {
  walletIdentity: { chainPubkey: string; nametag?: string } | null;
  /** Present on ConnectClient — false after popup close / disconnect. */
  isConnected?: boolean;
  query: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
  intent: <T = unknown>(action: string, params: Record<string, unknown>) => Promise<T>;
  on?: (event: string, handler: (data: unknown) => void) => () => void;
};

export type SphereSession = {
  client: SphereClient;
  disconnect: () => Promise<void>;
  transport: string;
  identity: { chainPubkey: string; nametag?: string };
  sessionId: string;
};

function resumeSessionId(): string | undefined {
  try {
    return sessionStorage.getItem(POPUP_SESSION_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function persistSessionId(id: string | undefined) {
  if (!id) return;
  try {
    sessionStorage.setItem(POPUP_SESSION_KEY, id);
  } catch {
    /* ignore */
  }
}

/**
 * Open Sphere wallet (extension → iframe → popup) and complete the handshake.
 * Call ONLY from a click/tap handler so the popup is not blocked.
 */
export async function connectSphereWallet(): Promise<SphereSession> {
  if (typeof window === "undefined") {
    throw new Error("Sphere Connect only runs in the browser");
  }

  const local = isLocalDevHost(window.location.hostname);
  const extensionReady = hasExtension();

  // Popup opens `${walletUrl}/connect?origin=${location.origin}`. Sphere’s
  // CloudFront WAF returns 403 whenever that query contains localhost/127.0.0.1.
  if (local && !extensionReady) {
    throw new Error(LOCALHOST_SPHERE_BLOCKED);
  }

  const result = await autoConnect({
    dapp: {
      name: "Unipad",
      description: "NFT launchpad on Unicity — mint and launch with UCT",
      url: window.location.origin,
      icon: `${window.location.origin}/favicon.ico`,
    },
    walletUrl: SPHERE_WALLET_URL,
    // Required by the v2 compatibility gate (INCOMPATIBLE_NETWORK if omitted/wrong)
    network: SPHERE_NETWORKS.testnet2,
    permissions: [...CONNECT_PERMISSIONS],
    resumeSessionId: resumeSessionId(),
    silent: false,
    // Fail faster than the SDK default (120s) when the wallet never shows UI.
    intentTimeout: 55_000,
    popupFeatures: SPHERE_POPUP_FEATURES,
    // On localhost, never use the popup path — only the extension avoids the WAF block.
    ...(local && extensionReady ? { forceTransport: "extension" as const } : {}),
  });

  persistSessionId(result.connection.sessionId);

  const identity =
    result.connection.identity ??
    result.client.walletIdentity ??
    (await result.client.query<{ chainPubkey: string; nametag?: string }>(
      RPC_METHODS.GET_IDENTITY,
    ));

  const chainPubkey = identity?.chainPubkey?.toLowerCase();
  if (!chainPubkey) {
    await result.disconnect().catch(() => undefined);
    throw new Error("Sphere wallet did not return an identity");
  }

  return {
    client: result.client as unknown as SphereClient,
    disconnect: result.disconnect,
    transport: result.transport,
    identity: {
      chainPubkey,
      nametag: identity.nametag,
    },
    sessionId: result.connection.sessionId,
  };
}

export async function resolveUctCoinId(client: SphereClient): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_UCT_COIN_ID;
  if (configured && /^[0-9a-f]{64}$/i.test(configured)) {
    return configured.toLowerCase();
  }

  try {
    const assets = await client.query<Array<{ coinId?: string; symbol?: string }>>(
      RPC_METHODS.GET_ASSETS,
    );
    const uct = assets?.find((a) => (a.symbol || "").toUpperCase() === "UCT");
    if (uct?.coinId && /^[0-9a-f]{64}$/i.test(uct.coinId)) {
      return uct.coinId.toLowerCase();
    }
  } catch {
    /* wallet may omit assets */
  }

  return UCT_COIN_ID;
}

/** Map Connect failures to short user-facing copy. */
export function describeConnectError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (msg.includes("LOCALHOST_SPHERE_BLOCKED") || (lower.includes("cloudfront") && lower.includes("403"))) {
    return "Sphere’s hosted wallet blocks localhost. Install the Sphere browser extension, or use a public HTTPS URL (Vercel/ngrok).";
  }
  if (lower.includes("popup") && (lower.includes("blocker") || lower.includes("failed to open"))) {
    return "Allow popups for this site, then tap Connect again. Sphere opens in a wallet window.";
  }
  if (lower.includes("closed before connecting")) {
    return "Sphere wallet was closed before connecting. Tap Connect and approve in the wallet.";
  }
  if (lower.includes("did not respond") || lower.includes("did not become ready")) {
    return "Sphere wallet did not respond. Check https://sphere.unicity.network and try again.";
  }
  if (lower.includes("incompatible_network") || lower.includes("network")) {
    return "Wallet network mismatch — Unipad needs Unicity testnet2. Switch network in Sphere.";
  }
  if (lower.includes("user") && lower.includes("reject")) {
    return "Connection rejected in Sphere. Tap Connect and approve Unipad.";
  }
  if (lower.includes("permission")) {
    return "Sphere did not grant the permissions Unipad needs (sign + send). Approve all scopes.";
  }
  return msg || "Could not connect to Sphere wallet";
}

/** Map UCT send / intent failures to short user-facing copy. */
export function describePaymentError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (lower.includes("popup") && (lower.includes("blocker") || lower.includes("failed to open"))) {
    return "Allow popups for this site, then tap Pay again. Sphere opens in a wallet window.";
  }
  if (
    lower.includes("outcome unknown") ||
    lower.includes("did not show") ||
    lower.includes("payment confirmation")
  ) {
    return "Sphere did not show a payment confirmation. Keep the Sphere wallet window open (or install the Sphere extension), then try Pay again.";
  }
  if (lower.includes("not connected") || lower.includes("disconnected")) {
    return "Sphere wallet disconnected. Tap Pay again and keep the Sphere window open.";
  }
  if (
    (lower.includes("user") && (lower.includes("reject") || lower.includes("denied") || lower.includes("cancel"))) ||
    lower.includes("rejected")
  ) {
    return "Payment rejected in Sphere.";
  }
  if (lower.includes("insufficient") || lower.includes("balance")) {
    return "Not enough UCT in Sphere to complete this mint.";
  }
  return msg || "UCT payment failed";
}

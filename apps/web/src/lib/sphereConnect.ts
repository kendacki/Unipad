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

/** Production builds never use mock — even if the env flag is set by mistake. */
export const ALLOW_DEV_MOCK =
  process.env.NEXT_PUBLIC_UNIPAD_DEV_MOCK === "true" &&
  process.env.NODE_ENV !== "production";

const CONNECT_PERMISSIONS = [
  PERMISSION_SCOPES.IDENTITY_READ,
  PERMISSION_SCOPES.BALANCE_READ,
  PERMISSION_SCOPES.TOKENS_READ,
  PERMISSION_SCOPES.TRANSFER_REQUEST,
  PERMISSION_SCOPES.SIGN_REQUEST,
] as const;

export type SphereClient = {
  walletIdentity: { chainPubkey: string; nametag?: string } | null;
  query: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
  intent: <T = unknown>(action: string, params: Record<string, unknown>) => Promise<T>;
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
    popupFeatures: "width=420,height=720,scrollbars=yes,resizable=yes",
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

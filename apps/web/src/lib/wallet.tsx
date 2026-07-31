"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { formatUct } from "@unipad/shared";
import { api } from "./api";
import { paymentRefFromSendResult, POPUP_SESSION_KEY } from "./sphere";
import {
  ALLOW_DEV_MOCK,
  INTENT_ACTIONS,
  connectSphereWallet,
  describeConnectError,
  resolveUctCoinId,
  type SphereClient,
} from "./sphereConnect";

type SphereHandle = {
  client: SphereClient;
  disconnect: () => Promise<void>;
};

type WalletState = {
  token: string | null;
  principal: string | null;
  displayName: string | null;
  mock: boolean;
  connecting: boolean;
  connectMock: (role?: "creator" | "buyer") => Promise<void>;
  /** Opens Sphere wallet (extension or popup). Must run from a click handler. */
  connectSphere: () => Promise<{ mock: boolean; reason?: string }>;
  disconnect: () => void;
  payUct: (params: {
    recipient: string;
    amount: string;
    memo: string;
    coinIdHex?: string;
  }) => Promise<string>;
};

const Ctx = createContext<WalletState | null>(null);
const STORAGE_KEY = "unipad.session";

type Stored = {
  token: string;
  principal: string;
  displayName?: string;
  mock?: boolean;
};

export function WalletProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [principal, setPrincipal] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [mock, setMock] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const sphereRef = useRef<SphereHandle | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Stored;
      setToken(parsed.token);
      setPrincipal(parsed.principal);
      setDisplayName(parsed.displayName ?? null);
      setMock(Boolean(parsed.mock));
    } catch {
      /* ignore */
    }
  }, []);

  const persist = useCallback((session: Stored) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    setToken(session.token);
    setPrincipal(session.principal);
    setDisplayName(session.displayName ?? null);
    setMock(Boolean(session.mock));
  }, []);

  const clearSphere = useCallback(async () => {
    const handle = sphereRef.current;
    sphereRef.current = null;
    if (handle) {
      try {
        await handle.disconnect();
      } catch {
        /* ignore */
      }
    }
    try {
      sessionStorage.removeItem(POPUP_SESSION_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const disconnect = useCallback(() => {
    void clearSphere();
    localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setPrincipal(null);
    setDisplayName(null);
    setMock(false);
  }, [clearSphere]);

  const connectMock = useCallback(
    async (role: "creator" | "buyer" = "creator") => {
      if (!ALLOW_DEV_MOCK) {
        throw new Error("Demo wallet is disabled in production. Connect with Sphere.");
      }
      setConnecting(true);
      try {
        await clearSphere();
        const session = await api.mockAuth(role);
        persist({
          token: session.token,
          principal: session.chainPubkey,
          displayName: session.displayName,
          mock: true,
        });
      } finally {
        setConnecting(false);
      }
    },
    [clearSphere, persist],
  );

  const connectSphere = useCallback(async () => {
    setConnecting(true);
    try {
      // Static autoConnect path — keeps user gesture for Sphere popup on Vercel
      const session = await connectSphereWallet();

      sphereRef.current = {
        client: session.client,
        disconnect: session.disconnect,
      };

      const { nonce, challenge } = await api.challenge(session.identity.chainPubkey);

      const signed = await session.client.intent<{
        signature?: string;
        publicKey?: string;
      }>(INTENT_ACTIONS.SIGN_MESSAGE, { message: challenge });

      const signature = signed?.signature;
      if (!signature) throw new Error("Sphere did not return a signature");

      const auth = await api.verify(nonce, signature);

      persist({
        token: auth.token,
        principal: auth.chainPubkey,
        displayName:
          session.identity.nametag ?? auth.displayName ?? auth.chainPubkey.slice(0, 12),
        mock: false,
      });
      return { mock: false as const };
    } catch (err) {
      await clearSphere();
      // Never silently mock on Vercel / production
      if (ALLOW_DEV_MOCK) {
        console.warn("Sphere connect failed, falling back to mock:", err);
        await connectMock("buyer");
        return { mock: true as const, reason: describeConnectError(err) };
      }
      throw new Error(describeConnectError(err));
    } finally {
      setConnecting(false);
    }
  }, [clearSphere, connectMock, persist]);

  const payUct = useCallback(
    async (params: {
      recipient: string;
      amount: string;
      memo: string;
      coinIdHex?: string;
    }) => {
      if (mock) {
        if (!ALLOW_DEV_MOCK) {
          throw new Error("Demo payments are disabled. Reconnect with Sphere.");
        }
        await new Promise((r) => setTimeout(r, 600));
        return `mock-uct:${params.memo}:${params.amount}:${Date.now()}`;
      }

      const handle = sphereRef.current;
      if (!handle) {
        throw new Error("Reconnect Sphere wallet to pay in UCT");
      }

      const to = params.recipient.startsWith("@")
        ? params.recipient
        : params.recipient.startsWith("DIRECT://") || /^[0-9a-f]{66}$/i.test(params.recipient)
          ? params.recipient
          : `@${params.recipient}`;

      const coinId =
        params.coinIdHex && /^[0-9a-f]{64}$/i.test(params.coinIdHex)
          ? params.coinIdHex.toLowerCase()
          : await resolveUctCoinId(handle.client);

      const raw = await handle.client.intent(INTENT_ACTIONS.SEND, {
        to,
        amount: params.amount,
        coinId,
        memo: params.memo,
      });

      return paymentRefFromSendResult(raw, params.memo);
    },
    [mock],
  );

  const value = useMemo(
    () => ({
      token,
      principal,
      displayName,
      mock,
      connecting,
      connectMock,
      connectSphere,
      disconnect,
      payUct,
    }),
    [
      token,
      principal,
      displayName,
      mock,
      connecting,
      connectMock,
      connectSphere,
      disconnect,
      payUct,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWallet outside provider");
  return ctx;
}

export function shortPrincipal(p: string) {
  if (p.startsWith("mock_")) return p.replace("mock_", "");
  if (p.length < 16) return p;
  return `${p.slice(0, 8)}…${p.slice(-4)}`;
}

export { formatUct };

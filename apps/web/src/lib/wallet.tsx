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
import { normalizeSphereRecipient } from "@unipad/shared";
import { api } from "./api";
import { ApiError } from "./errors";
import { isSessionJwtExpired, paymentRefFromSendResult, POPUP_SESSION_KEY } from "./sphere";
import {
  INTENT_ACTIONS,
  connectSphereWallet,
  describeConnectError,
  describePaymentError,
  hasExtension,
  isSphereClientConnected,
  prepareSpherePaymentWindow,
  resolveUctCoinId,
  type SphereClient,
  type SphereSession,
} from "./sphereConnect";

type SphereHandle = {
  client: SphereClient;
  disconnect: () => Promise<void>;
  transport: string;
  unsubDisconnected?: () => void;
};

type WalletState = {
  token: string | null;
  principal: string | null;
  displayName: string | null;
  connecting: boolean;
  /** True when the live Sphere Connect client is attached (needed for UCT send). */
  sphereReady: boolean;
  /** Opens Sphere wallet (extension or popup). Must run from a click handler. */
  connectSphere: () => Promise<void>;
  /**
   * Ensure Sphere Connect is live for payments. Reuses JWT when the same wallet
   * reconnects after a refresh. Must run from a click handler (before long awaits).
   * @returns Active Unipad session JWT
   */
  ensureSphereConnected: () => Promise<string>;
  /**
   * Call from the Pay click: reopen/focus Sphere under the gesture, reconnect if
   * the popup died, then return the session JWT. Must run before payUct.
   */
  ensureSphereForPayment: () => Promise<string>;
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
const PAY_TIMEOUT_MS = 50_000;

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
  const [connecting, setConnecting] = useState(false);
  const [sphereReady, setSphereReady] = useState(false);
  const sphereRef = useRef<SphereHandle | null>(null);
  const tokenRef = useRef<string | null>(null);
  const principalRef = useRef<string | null>(null);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);
  useEffect(() => {
    principalRef.current = principal;
  }, [principal]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Stored;
      // Drop legacy demo/mock sessions — Sphere only
      if (parsed.mock || parsed.principal?.startsWith("mock_")) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      setToken(parsed.token);
      setPrincipal(parsed.principal);
      setDisplayName(parsed.displayName ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  const persist = useCallback((session: Omit<Stored, "mock">) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    setToken(session.token);
    setPrincipal(session.principal);
    setDisplayName(session.displayName ?? null);
  }, []);

  const softDetachSphere = useCallback(() => {
    const handle = sphereRef.current;
    sphereRef.current = null;
    setSphereReady(false);
    if (!handle) return;
    try {
      handle.unsubDisconnected?.();
    } catch {
      /* ignore */
    }
    // Do NOT call disconnect() — that closes the Sphere popup we may have just opened.
  }, []);

  const attachSphere = useCallback(
    (session: SphereSession) => {
      softDetachSphere();

      let unsubDisconnected: (() => void) | undefined;
      try {
        unsubDisconnected = session.client.on?.("wallet:disconnected", () => {
          if (sphereRef.current?.client === session.client) {
            softDetachSphere();
          }
        });
      } catch {
        /* older clients */
      }

      sphereRef.current = {
        client: session.client,
        disconnect: session.disconnect,
        transport: session.transport,
        unsubDisconnected,
      };
      setSphereReady(true);
    },
    [softDetachSphere],
  );

  const clearSphere = useCallback(async () => {
    const handle = sphereRef.current;
    sphereRef.current = null;
    setSphereReady(false);
    if (!handle) return;
    try {
      handle.unsubDisconnected?.();
    } catch {
      /* ignore */
    }
    try {
      await handle.disconnect();
    } catch {
      /* ignore */
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
  }, [clearSphere]);

  const completeAuth = useCallback(
    async (session: SphereSession) => {
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
      });
      return auth.token;
    },
    [persist],
  );

  const ensureSphereConnected = useCallback(async () => {
    const existingToken = tokenRef.current;
    const tokenFresh = existingToken && !isSessionJwtExpired(existingToken);

    if (sphereRef.current && tokenFresh && isSphereClientConnected(sphereRef.current.client)) {
      return existingToken!;
    }

    if (sphereRef.current && !isSphereClientConnected(sphereRef.current.client)) {
      softDetachSphere();
    }

    setConnecting(true);
    try {
      const session = await connectSphereWallet();
      attachSphere(session);

      const pubkey = session.identity.chainPubkey.toLowerCase();
      const existingPrincipal = principalRef.current?.toLowerCase() ?? null;

      // Fresh visit, expired JWT, or different wallet → full Unipad sign-in.
      if (!tokenFresh || !existingPrincipal || existingPrincipal !== pubkey) {
        return await completeAuth(session);
      }

      if (session.identity.nametag) {
        setDisplayName(session.identity.nametag);
      }
      return existingToken!;
    } catch (err) {
      await clearSphere();
      if (err instanceof ApiError) throw err;
      throw new ApiError(describeConnectError(err), {
        code: "UPAD_UNAUTHORIZED",
        status: 401,
      });
    } finally {
      setConnecting(false);
    }
  }, [attachSphere, clearSphere, completeAuth, softDetachSphere]);

  /**
   * Pay-click path: reopen Sphere under the gesture, then soft-reconnect so send
   * UI can appear. Closing the Connect popup after login is the usual hang cause.
   */
  const ensureSphereForPayment = useCallback(async () => {
    // Caller should have already called prepareSpherePaymentWindow() sync in the
    // same click. We call it again here as a safety net (still same turn if sync).
    try {
      prepareSpherePaymentWindow();
    } catch (err) {
      throw new ApiError(describeConnectError(err), {
        code: "UPAD_UNAUTHORIZED",
        status: 401,
      });
    }

    const existing = sphereRef.current;
    const ext = hasExtension();

    if (ext && existing && isSphereClientConnected(existing.client)) {
      const existingToken = tokenRef.current;
      if (existingToken && !isSessionJwtExpired(existingToken)) {
        return existingToken;
      }
    }

    // Popup path (or dead extension client): soft-detach and reconnect to the
    // window we just opened — never call disconnect() (it closes the popup).
    softDetachSphere();
    return ensureSphereConnected();
  }, [ensureSphereConnected, softDetachSphere]);

  const connectSphere = useCallback(async () => {
    await ensureSphereConnected();
  }, [ensureSphereConnected]);

  const payUct = useCallback(
    async (params: {
      recipient: string;
      amount: string;
      memo: string;
      coinIdHex?: string;
    }) => {
      if (!sphereRef.current || !isSphereClientConnected(sphereRef.current.client)) {
        throw new ApiError("Reconnect Sphere wallet to pay in UCT", {
          code: "UPAD_UNAUTHORIZED",
          status: 401,
        });
      }
      const handle = sphereRef.current;
      const to = normalizeSphereRecipient(params.recipient);

      try {
        // Always resolve UCT from the live wallet (or current registry). Never trust a
        // stale mint-intent coinIdHex — wrong ids show raw units + "don't hold this token".
        const coinId = await resolveUctCoinId(handle.client);

        // `to` is the CONNECT.md field; some wallet builds also read `recipient`.
        const sendPromise = handle.client.intent(INTENT_ACTIONS.SEND, {
          to,
          recipient: to,
          amount: params.amount,
          coinId,
          memo: params.memo,
        });

        const timed = new Promise<never>((_, reject) => {
          window.setTimeout(() => {
            reject(
              new ApiError(
                "Sphere did not show a payment confirmation. Keep the Sphere wallet window open (or install the Sphere extension), then try Pay again.",
                { code: "UPAD_PAYMENT_TIMEOUT", status: 408 },
              ),
            );
          }, PAY_TIMEOUT_MS);
        });

        const raw = await Promise.race([sendPromise, timed]);
        return paymentRefFromSendResult(raw, params.memo);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        const message = describePaymentError(err);
        const lower = message.toLowerCase();
        const code =
          lower.includes("reject") || lower.includes("denied") || lower.includes("cancel")
            ? "UPAD_PAYMENT_REJECTED"
            : lower.includes("insufficient") || lower.includes("balance")
              ? "UPAD_INSUFFICIENT_FUNDS"
              : lower.includes("outcome unknown") || lower.includes("confirmation")
                ? "UPAD_PAYMENT_TIMEOUT"
                : "UPAD_PAYMENT_FAILED";
        throw new ApiError(message || "UCT payment failed", {
          code,
          status: 400,
        });
      }
    },
    [],
  );

  const value = useMemo(
    () => ({
      token,
      principal,
      displayName,
      connecting,
      sphereReady,
      connectSphere,
      ensureSphereConnected,
      ensureSphereForPayment,
      disconnect,
      payUct,
    }),
    [
      token,
      principal,
      displayName,
      connecting,
      sphereReady,
      connectSphere,
      ensureSphereConnected,
      ensureSphereForPayment,
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
  if (p.length < 16) return p;
  return `${p.slice(0, 8)}…${p.slice(-4)}`;
}

export { formatUct } from "@unipad/shared";

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
  RPC_METHODS,
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
  /**
   * Resolve @nametag → chain pubkey via Sphere (falls back to the raw recipient).
   * Prefer calling after ensureSphereForPayment so the Connect client is live.
   */
  resolveTransferRecipient: (recipient: string) => Promise<string>;
  /**
   * Open Sphere and ask the user to sign an NFT-transfer confirmation.
   * Must run under the same click gesture as prepareSpherePaymentWindow.
   */
  confirmNftTransfer: (params: {
    collectionName: string;
    collectionId: string;
    tokenId: number;
    to: string;
  }) => Promise<{ signature: string; message: string }>;
};

const Ctx = createContext<WalletState | null>(null);
const STORAGE_KEY = "unipad.session";
const PAY_TIMEOUT_MS = 50_000;
const SIGN_TIMEOUT_MS = 50_000;
const CHAIN_PUBKEY_RE = /^[0-9a-f]{66}$/i;

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
      const principal = (parsed.principal || "")
        .trim()
        .toLowerCase()
        .replace(/^0x/, "");
      if (!principal || !parsed.token || isSessionJwtExpired(parsed.token)) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      setToken(parsed.token);
      setPrincipal(principal);
      setDisplayName(parsed.displayName ?? null);
      // Do NOT ping /v1/auth/session here — a slow 401 from a stale JWT races a
      // fresh Connect and wipes the new session after the success toast.
    } catch {
      /* ignore */
    }
  }, []);

  const persist = useCallback((session: Omit<Stored, "mock">) => {
    const principal = session.principal.trim().toLowerCase().replace(/^0x/, "");
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...session, principal }),
    );
    setToken(session.token);
    setPrincipal(principal);
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

  // Drop client state when the JWT hits expiry mid-session (no full page reload).
  useEffect(() => {
    if (!token) return;
    if (isSessionJwtExpired(token)) {
      disconnect();
      return;
    }
    let expMs = 0;
    try {
      const part = token.split(".")[1];
      const payload = JSON.parse(
        atob(part.replace(/-/g, "+").replace(/_/g, "/")),
      ) as { exp?: number };
      expMs = typeof payload.exp === "number" ? payload.exp * 1000 : 0;
    } catch {
      return;
    }
    if (!expMs) return;
    const delay = Math.max(0, expMs - Date.now() - 60_000);
    const timer = window.setTimeout(() => disconnect(), delay);
    return () => window.clearTimeout(timer);
  }, [token, disconnect]);

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
      // Bind @nametag → pubkey and claim any mints sent to that nametag.
      if (session.identity.nametag) {
        void api.myTokens(auth.token, session.identity.nametag).catch(() => undefined);
      }
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

      // JWT not expired by clock — still confirm this deployment accepts it
      // (covers JWT_SECRET rotation / env mismatch).
      try {
        await api.session(existingToken!);
      } catch {
        return await completeAuth(session);
      }

      if (session.identity.nametag) {
        setDisplayName(session.identity.nametag);
        void api.myTokens(existingToken!, session.identity.nametag).catch(() => undefined);
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

  const resolveTransferRecipient = useCallback(async (recipient: string) => {
    const raw = recipient.trim();
    if (!raw) {
      throw new ApiError("Enter a recipient @nametag or chain pubkey", {
        code: "UPAD_VALIDATION",
        status: 400,
      });
    }
    if (CHAIN_PUBKEY_RE.test(raw)) return raw.toLowerCase();

    let tag: string;
    try {
      tag = normalizeSphereRecipient(raw);
    } catch {
      throw new ApiError("Recipient must be a @nametag or 66-char chain pubkey", {
        code: "UPAD_VALIDATION",
        status: 400,
      });
    }

    const client = sphereRef.current?.client;
    if (client && isSphereClientConnected(client)) {
      try {
        const resolveMethod =
          (RPC_METHODS as Record<string, string>).RESOLVE || "sphere_resolve";
        const resolvePromise = client.query<{
          chainPubkey?: string;
          pubkey?: string;
          address?: string;
          identity?: { chainPubkey?: string };
        }>(resolveMethod, { identifier: tag });

        // Don't block the send path forever if Sphere resolve hangs.
        const resolved = await Promise.race([
          resolvePromise,
          new Promise<null>((r) => window.setTimeout(() => r(null), 8_000)),
        ]);

        if (resolved) {
          const pubkey = (
            resolved.chainPubkey ||
            resolved.pubkey ||
            resolved.identity?.chainPubkey ||
            resolved.address ||
            ""
          )
            .trim()
            .toLowerCase()
            .replace(/^0x/, "");

          if (CHAIN_PUBKEY_RE.test(pubkey)) return pubkey;
        }
      } catch {
        /* fall through — unbound tags stay as @nametag until claim */
      }
    }

    return tag;
  }, []);

  const confirmNftTransfer = useCallback(
    async (params: {
      collectionName: string;
      collectionId: string;
      tokenId: number;
      to: string;
    }) => {
      if (!sphereRef.current || !isSphereClientConnected(sphereRef.current.client)) {
        throw new ApiError("Reconnect Sphere wallet to confirm this send", {
          code: "UPAD_UNAUTHORIZED",
          status: 401,
        });
      }
      const handle = sphereRef.current;
      const message = [
        "Unipad NFT transfer",
        "",
        `Send: ${params.collectionName} #${params.tokenId}`,
        `Collection: ${params.collectionId}`,
        `To: ${params.to}`,
        `Domain: ${typeof window !== "undefined" ? window.location.host : "unipad"}`,
        `Issued At: ${new Date().toISOString()}`,
      ].join("\n");

      let timer: number | undefined;
      try {
        const signPromise = handle.client.intent<{
          signature?: string;
          publicKey?: string;
        }>(INTENT_ACTIONS.SIGN_MESSAGE, { message });

        const timed = new Promise<never>((_, reject) => {
          timer = window.setTimeout(() => {
            reject(
              new ApiError(
                "Sphere did not show a transfer confirmation. Keep the Sphere wallet window open (or install the Sphere extension), then try Send again.",
                { code: "UPAD_PAYMENT_TIMEOUT", status: 408 },
              ),
            );
          }, SIGN_TIMEOUT_MS);
        });

        const signed = await Promise.race([signPromise, timed]);
        const signature = signed?.signature;
        if (!signature) {
          throw new ApiError("Sphere did not return a transfer signature", {
            code: "UPAD_PAYMENT_FAILED",
            status: 400,
          });
        }
        return { signature, message };
      } catch (err) {
        if (err instanceof ApiError) throw err;
        const text = describePaymentError(err);
        const lower = text.toLowerCase();
        const code =
          lower.includes("reject") || lower.includes("denied") || lower.includes("cancel")
            ? "UPAD_PAYMENT_REJECTED"
            : lower.includes("confirmation") || lower.includes("timeout")
              ? "UPAD_PAYMENT_TIMEOUT"
              : "UPAD_PAYMENT_FAILED";
        throw new ApiError(
          lower.includes("reject")
            ? "Transfer rejected in Sphere."
            : text || "Could not confirm NFT transfer in Sphere",
          { code, status: 400 },
        );
      } finally {
        if (timer !== undefined) window.clearTimeout(timer);
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
      resolveTransferRecipient,
      confirmNftTransfer,
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
      resolveTransferRecipient,
      confirmNftTransfer,
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

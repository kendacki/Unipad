"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toUserError, type ErrorInfo } from "@/lib/errors";

export type ToastKind = "error" | "success" | "info";

export type ToastItem = {
  id: string;
  kind: ToastKind;
  title: string;
  message: string;
  code?: string;
};

type ConfirmState = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  resolve: (ok: boolean) => void;
} | null;

type ToastApi = {
  push: (toast: Omit<ToastItem, "id">) => void;
  success: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  error: (err: unknown) => ErrorInfo;
  confirm: (opts: {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
  }) => Promise<boolean>;
};

const Ctx = createContext<ToastApi | null>(null);

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirm, setConfirm] = useState<ConfirmState>(null);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<ToastItem, "id">) => {
      const id = `t-${++seq}`;
      setToasts((prev) => [...prev.slice(-4), { ...toast, id }]);
      const ms = toast.kind === "error" ? 7000 : 4200;
      window.setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (title, message = "") => push({ kind: "success", title, message }),
      info: (title, message = "") => push({ kind: "info", title, message }),
      error: (err) => {
        const info = toUserError(err);
        push({
          kind: "error",
          title: info.title,
          message: info.message,
          code: info.code,
        });
        return info;
      },
      confirm: ({ title, message, confirmLabel, cancelLabel }) =>
        new Promise<boolean>((resolve) => {
          setConfirm({
            title,
            message,
            confirmLabel,
            cancelLabel,
            resolve: (ok) => {
              setConfirm(null);
              resolve(ok);
            },
          });
        }),
    }),
    [push],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast glass toast-${t.kind}`} role="status">
            <div className="toast-body">
              <strong>{t.title}</strong>
              {t.message ? <p>{t.message}</p> : null}
              {t.code ? <code className="error-code">{t.code}</code> : null}
            </div>
            <button
              type="button"
              className="toast-close"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {confirm ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal glass" role="dialog" aria-modal="true">
            <h3>{confirm.title}</h3>
            <p className="muted">{confirm.message}</p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => confirm.resolve(false)}
              >
                {confirm.cancelLabel ?? "Cancel"}
              </button>
              <button
                type="button"
                className="btn btn-signal"
                onClick={() => confirm.resolve(true)}
              >
                {confirm.confirmLabel ?? "Continue"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast outside provider");
  return ctx;
}

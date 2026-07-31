"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, m } from "framer-motion";
import { toUserError, type ErrorInfo } from "@/lib/errors";
import { modalBackdrop, modalPanel, springSnappy, toastItem } from "@/lib/motion";

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
  /** Optional action started synchronously inside the confirm click (preserves popup gesture). */
  run?: () => Promise<unknown>;
  resolve: (value: unknown) => void;
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
  /**
   * Confirm modal whose primary button starts `run()` in the same click turn.
   * Required for Sphere send popups (Chrome blocks popups after prior awaits).
   * Returns null if cancelled.
   */
  confirmAndRun: <T>(opts: {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    run: () => Promise<T>;
  }) => Promise<T | null>;
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
              resolve(Boolean(ok));
            },
          });
        }),
      confirmAndRun: <T,>({
        title,
        message,
        confirmLabel,
        cancelLabel,
        run,
      }: {
        title: string;
        message: string;
        confirmLabel?: string;
        cancelLabel?: string;
        run: () => Promise<T>;
      }) =>
        new Promise<T | null>((resolve, reject) => {
          setConfirm({
            title,
            message,
            confirmLabel,
            cancelLabel,
            run,
            resolve: (value) => {
              if (value === null || value === false) {
                resolve(null);
                return;
              }
              Promise.resolve(value as Promise<T>)
                .then((result) => resolve(result))
                .catch(reject);
            },
          });
        }),
    }),
    [push],
  );

  function onCancel() {
    if (!confirm) return;
    const { resolve } = confirm;
    setConfirm(null);
    resolve(null);
  }

  function onConfirmClick() {
    if (!confirm) return;
    const { resolve, run } = confirm;
    // Close modal first, but start `run()` in this same click turn so Sphere
    // can open its payment UI (popup/extension) under the user gesture.
    setConfirm(null);
    if (run) {
      let started: Promise<unknown>;
      try {
        started = run();
      } catch (err) {
        resolve(Promise.reject(err));
        return;
      }
      resolve(started);
      return;
    }
    resolve(true);
  }

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <m.div
              key={t.id}
              className={`toast glass toast-${t.kind}`}
              role="status"
              variants={toastItem}
              initial="hidden"
              animate="show"
              exit="exit"
              layout
            >
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
            </m.div>
          ))}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {confirm ? (
          <m.div
            className="modal-backdrop"
            role="presentation"
            variants={modalBackdrop}
            initial="hidden"
            animate="show"
            exit="exit"
          >
            <m.div
              className="modal glass"
              role="dialog"
              aria-modal="true"
              variants={modalPanel}
              initial="hidden"
              animate="show"
              exit="exit"
            >
              <h3>{confirm.title}</h3>
              <p className="muted">{confirm.message}</p>
              <div className="modal-actions">
                <m.button
                  type="button"
                  className="btn btn-ghost"
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  transition={springSnappy}
                  onClick={onCancel}
                >
                  {confirm.cancelLabel ?? "Cancel"}
                </m.button>
                <m.button
                  type="button"
                  className="btn btn-signal"
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  transition={springSnappy}
                  onClick={onConfirmClick}
                >
                  {confirm.confirmLabel ?? "Continue"}
                </m.button>
              </div>
            </m.div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast outside provider");
  return ctx;
}

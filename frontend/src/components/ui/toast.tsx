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
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/client";
import { CloseIcon } from "./icons";
import { toneIcon, toneSurface, toneLabelKey, type Tone } from "./tone";

export interface ToastOptions {
  tone?: Tone;
  title: ReactNode;
  description?: ReactNode;
  /** Milliseconds before it disappears. Problems stay longer. Hovering or focusing pauses the timer. */
  durationMs?: number;
}

interface ToastEntry extends ToastOptions {
  id: number;
  tone: Tone;
}

interface ToastApi {
  show: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>");
  return api;
}

function ToastItem({ toast, onDismiss }: { toast: ToastEntry; onDismiss: () => void }) {
  const t = useT();
  const Icon = toneIcon[toast.tone];
  const duration = toast.durationMs ?? (toast.tone === "danger" ? 10_000 : 6_000);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const start = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(onDismiss, duration);
  }, [duration, onDismiss]);
  const pause = () => clearTimeout(timer.current);

  useEffect(() => {
    start();
    return () => clearTimeout(timer.current);
  }, [start]);

  return (
    <div
      onMouseEnter={pause}
      onMouseLeave={start}
      onFocus={pause}
      onBlur={start}
      className={cn(
        "pointer-events-auto flex items-start gap-3 rounded-card border p-4 shadow-lg",
        toneSurface[toast.tone],
      )}
    >
      <Icon size={22} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="sr-only">{t(toneLabelKey[toast.tone])}: </span>
        <p className="font-semibold">{toast.title}</p>
        {toast.description ? <p className="mt-1 text-charcoal-900">{toast.description}</p> : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("ui.dismiss")}
        className="touch-target -m-2 inline-flex shrink-0 items-center justify-center rounded-lg hover:bg-black/5"
      >
        <CloseIcon size={20} />
      </button>
    </div>
  );
}

/**
 * Transient confirmations ("Saved"). Never the only feedback for something important: failures also appear
 * inline. Two always-present live regions (polite and assertive) make new toasts reliably announced.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const next = useRef(1);

  const dismiss = useCallback(
    (id: number) => setToasts((all) => all.filter((x) => x.id !== id)),
    [],
  );
  const show = useCallback((options: ToastOptions) => {
    const id = next.current++;
    setToasts((all) => [...all.slice(-3), { ...options, id, tone: options.tone ?? "info" }]);
    return id;
  }, []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  const renderGroup = (assertive: boolean) =>
    toasts
      .filter((toast) => (toast.tone === "danger" || toast.tone === "warning") === assertive)
      .map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
      ));

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="region"
        aria-label={t("ui.notifications")}
        className="pointer-events-none fixed inset-x-3 bottom-3 z-50 flex flex-col items-center gap-2 pb-[env(safe-area-inset-bottom)] sm:inset-x-auto sm:end-4 sm:w-96 sm:items-stretch"
      >
        <div aria-live="polite" aria-atomic="false" className="flex w-full flex-col gap-2">
          {renderGroup(false)}
        </div>
        <div aria-live="assertive" aria-atomic="false" className="flex w-full flex-col gap-2">
          {renderGroup(true)}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

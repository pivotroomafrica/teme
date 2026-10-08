"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/client";
import { Button } from "./button";
import { FormField } from "./form-field";
import { CloseIcon } from "./icons";
import { Input } from "./inputs";

/**
 * Modal surfaces built on the native <dialog> element: the browser provides the focus trap, makes the rest
 * of the page inert, closes on Escape and restores focus to the control that opened it.
 */
interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons row. Put the primary action last. */
  footer?: ReactNode;
  /** Escape, the backdrop and the close button dismiss it. Turn off while work is in progress. */
  dismissible?: boolean;
  className?: string;
}

function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dismissible = true,
  variant,
  className,
}: ModalProps & { variant: "dialog" | "drawer" }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Keep the page behind from scrolling while a modal is open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onCancel={(event) => {
        if (!dismissible) event.preventDefault();
      }}
      onClick={(event) => {
        // A click on the backdrop targets the <dialog> element itself.
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
      className={cn(
        "bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/50",
        variant === "dialog"
          ? "m-auto max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100vw-1.5rem))] rounded-card"
          : "m-0 ms-auto h-dvh max-h-none w-[min(28rem,100vw)] max-w-none rounded-none",
        className,
      )}
    >
      {open ? (
        <div className="flex max-h-[inherit] min-h-full flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-border p-5">
            <div className="min-w-0">
              <h2 id={titleId} className="text-xl font-bold text-green-900">
                {title}
              </h2>
              {description ? (
                <p id={descId} className="mt-1 text-charcoal-700">
                  {description}
                </p>
              ) : null}
            </div>
            {dismissible ? (
              <button
                type="button"
                onClick={onClose}
                aria-label={t("ui.close")}
                className="touch-target -m-2 inline-flex shrink-0 items-center justify-center rounded-lg hover:bg-cream-200"
              >
                <CloseIcon />
              </button>
            ) : null}
          </div>
          {children ? (
            <div className="flex-1 overflow-y-auto p-5">{children}</div>
          ) : (
            <div className="flex-1" />
          )}
          {footer ? (
            <div className="flex flex-wrap justify-end gap-3 border-t border-border p-5">
              {footer}
            </div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}

export const Dialog = (props: ModalProps) => <Modal variant="dialog" {...props} />;
export const Drawer = (props: ModalProps) => <Modal variant="drawer" {...props} />;

/**
 * Confirmation for consequential actions. The destructive variant uses red and, for the most serious
 * actions, `requirePhrase` makes the person type a word before the button unlocks.
 */
export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = "primary",
  requirePhrase,
  children,
}: {
  open: boolean;
  onCancel: () => void;
  /** May be async; the dialog stays open and locked until it settles. */
  onConfirm: () => void | Promise<void>;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  requirePhrase?: string;
  children?: ReactNode;
}) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [typed, setTyped] = useState("");
  const unlocked = !requirePhrase || typed.trim() === requirePhrase;

  const cancel = () => {
    setTyped("");
    onCancel();
  };

  async function confirm() {
    setPending(true);
    try {
      await onConfirm();
      setTyped("");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={cancel}
      title={title}
      description={description}
      dismissible={!pending}
      footer={
        <>
          <Button variant="secondary" onClick={cancel} disabled={pending}>
            {cancelLabel ?? t("ui.cancel")}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={confirm}
            loading={pending}
            disabled={!unlocked}
          >
            {confirmLabel ?? t("ui.confirm")}
          </Button>
        </>
      }
    >
      {children}
      {requirePhrase ? (
        <FormField label={t("ui.typeToConfirm", { phrase: requirePhrase })} className="mt-4">
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
          />
        </FormField>
      ) : null}
    </Dialog>
  );
}

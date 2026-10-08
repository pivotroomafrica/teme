"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/client";
import { CloseIcon } from "./icons";
import { toneIcon, toneSurface, toneLabelKey, type Tone } from "./tone";

export interface AlertProps {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  /** Adds a dismiss button. */
  onDismiss?: () => void;
  className?: string;
}

/**
 * Inline message. Warnings and problems use role="alert" (announced at once); information and success use
 * role="status" (announced politely). The tone word is also spoken so colour is never the only cue.
 */
export function Alert({ tone = "info", title, children, onDismiss, className }: AlertProps) {
  const t = useT();
  const Icon = toneIcon[tone];
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-card border p-4", toneSurface[tone], className)}
    >
      <Icon size={22} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="sr-only">{t(toneLabelKey[tone])}: </span>
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? (
          <div className={cn("text-charcoal-900", title && "mt-1")}>{children}</div>
        ) : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("ui.dismiss")}
          className="touch-target -m-2 inline-flex shrink-0 items-center justify-center rounded-lg hover:bg-black/5"
        >
          <CloseIcon size={20} />
        </button>
      ) : null}
    </div>
  );
}

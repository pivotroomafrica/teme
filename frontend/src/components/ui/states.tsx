"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/client";
import { Button } from "./button";
import { CheckCircleIcon, InfoIcon, XCircleIcon } from "./icons";

type Heading = "h1" | "h2" | "h3";

/** Nothing to show yet. Always say why and what to do next. */
export function EmptyState({
  title,
  description,
  action,
  icon,
  headingLevel = "h2",
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  headingLevel?: Heading;
  className?: string;
}) {
  const Title = headingLevel;
  return (
    <div
      className={cn(
        "border-charcoal-300 flex flex-col items-center gap-3 rounded-card border border-dashed bg-surface px-6 py-10 text-center",
        className,
      )}
    >
      <span className="text-green-700">{icon ?? <InfoIcon size={32} />}</span>
      <Title className="text-lg font-semibold text-green-900">{title}</Title>
      {description ? <p className="max-w-prose text-muted">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/** Something failed. Shows what happened in plain words, a support reference, and a retry. */
export function ErrorState({
  title,
  description,
  requestId,
  onRetry,
  retrying = false,
  headingLevel = "h2",
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Correlation id from the API error, so support can find the exact request. */
  requestId?: string;
  onRetry?: () => void;
  retrying?: boolean;
  headingLevel?: Heading;
  className?: string;
}) {
  const t = useT();
  const Title = headingLevel;
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-card border border-red-600/40 bg-red-50 px-6 py-10 text-center",
        className,
      )}
    >
      <XCircleIcon size={32} className="text-red-700" />
      <Title className="text-lg font-semibold text-red-700">{title}</Title>
      {description ? <p className="max-w-prose text-charcoal-900">{description}</p> : null}
      {requestId ? (
        <p className="text-sm text-muted">
          {t("errors.referenceLabel")}: <code className="font-mono">{requestId}</code>
        </p>
      ) : null}
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry} loading={retrying}>
          {t("common.retry")}
        </Button>
      ) : null}
    </div>
  );
}

/** A grey placeholder block. Decorative: wrap groups in SkeletonGroup so the wait is announced once. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("animate-pulse rounded-lg bg-cream-300", className)} />
  );
}

export function SkeletonGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const t = useT();
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{t("ui.loadingContent")}</span>
      {children}
    </div>
  );
}

/** Full confirmation after a completed action (enrolled, saved, redeemed). */
export function ConfirmationScreen({
  title,
  description,
  actions,
  tone = "success",
  headingLevel = "h1",
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  tone?: "success" | "neutral";
  headingLevel?: Heading;
  className?: string;
}) {
  const Title = headingLevel;
  return (
    <div
      role="status"
      className={cn("flex flex-col items-center gap-4 px-4 py-10 text-center", className)}
    >
      <span
        className={cn(
          "flex h-20 w-20 items-center justify-center rounded-full",
          tone === "success" ? "bg-green-100 text-green-700" : "bg-cream-200 text-charcoal-700",
        )}
      >
        <CheckCircleIcon size={48} />
      </span>
      <Title className="text-2xl font-bold text-green-900">{title}</Title>
      {description ? <p className="max-w-prose text-lg text-charcoal-700">{description}</p> : null}
      {actions ? <div className="mt-2 flex flex-wrap justify-center gap-3">{actions}</div> : null}
    </div>
  );
}

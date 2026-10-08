"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/client";

/** Full-page states shared by error.tsx, not-found.tsx and loading.tsx. Text comes from the dictionaries. */

export function ErrorView({ reference, onRetry }: { reference?: string; onRetry?: () => void }) {
  const { t, locale } = useI18n();
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 py-10"
    >
      <div role="alert" className="rounded-card border border-red-600/40 bg-red-50 p-6">
        <h1 className="text-xl font-bold text-red-700">{t("errors.genericTitle")}</h1>
        <p className="mt-2 text-charcoal-700">{t("errors.genericBody")}</p>
        {reference ? (
          <p className="mt-3 text-sm text-muted">
            {t("errors.referenceLabel")}: <code className="font-mono">{reference}</code>
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-3">
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="touch-target rounded-control bg-primary px-5 font-semibold text-on-primary hover:bg-primary-hover"
          >
            {t("common.retry")}
          </button>
        ) : null}
        <Link
          href={`/${locale}`}
          className="touch-target inline-flex items-center rounded-control border border-border bg-surface px-5 font-semibold text-green-800 no-underline"
        >
          {t("common.goHome")}
        </Link>
      </div>
    </main>
  );
}

export function NotFoundView() {
  const { t, locale } = useI18n();
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 py-10"
    >
      <h1 className="text-2xl font-bold text-green-800">{t("errors.notFoundTitle")}</h1>
      <p className="text-charcoal-700">{t("errors.notFoundBody")}</p>
      <div>
        <Link
          href={`/${locale}`}
          className="touch-target inline-flex items-center rounded-control bg-primary px-5 font-semibold text-on-primary no-underline hover:bg-primary-hover"
        >
          {t("common.goHome")}
        </Link>
      </div>
    </main>
  );
}

export function LoadingView() {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[50dvh] items-center justify-center gap-3 p-8"
    >
      <span
        aria-hidden="true"
        className="h-6 w-6 animate-spin rounded-full border-4 border-green-200 border-t-green-700"
      />
      <span className="text-muted">{t("common.loading")}</span>
    </div>
  );
}

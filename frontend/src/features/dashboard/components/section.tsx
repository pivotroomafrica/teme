"use client";

import type { ReactNode } from "react";
import { ErrorState, Skeleton, SkeletonGroup } from "@/components/ui";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";

export interface QueryLike {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  refetch: () => unknown;
}

/**
 * One dashboard card with its own loading, error and (optionally) empty state. A failing section says so and offers
 * a retry without taking the rest of the page down with it.
 */
export function DashboardSection({
  id,
  title,
  query,
  empty,
  children,
  className,
}: {
  id: string;
  title: string;
  query: QueryLike;
  /** Shown instead of the content when the data loaded but there is nothing in it. */
  empty?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const headingId = `${id}-title`;

  let body: ReactNode;
  if (query.isPending) {
    body = (
      <SkeletonGroup className="flex flex-col gap-3">
        <span className="sr-only">{t("dashboard.loadingSection", { section: title })}</span>
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </SkeletonGroup>
    );
  } else if (query.isError) {
    const failure = toApiError(query.error);
    body = (
      <ErrorState
        headingLevel="h3"
        title={t("dashboard.sectionError")}
        description={describeApiError(failure, t).description}
        requestId={failure.requestId}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        className="py-6"
      />
    );
  } else {
    body = empty ?? children;
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid={`section-${id}`}
      data-state={query.isPending ? "loading" : query.isError ? "error" : empty ? "empty" : "ready"}
      className={className ?? "min-w-0 rounded-card border border-border bg-surface p-5"}
    >
      <h2 id={headingId} className="mb-3 text-lg font-bold text-green-900">
        {title}
      </h2>
      {body}
    </section>
  );
}

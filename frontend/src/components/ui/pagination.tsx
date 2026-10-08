"use client";

import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/client";
import { Button } from "./button";

/**
 * Previous / next controls for cursor-paginated lists (the backend pages by cursor, so there are no page
 * numbers). The summary is a polite live region so the new range is announced after each move.
 */
export function Pagination({
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  from,
  to,
  total,
  loading = false,
  className,
}: {
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  from?: number;
  to?: number;
  total?: number;
  loading?: boolean;
  className?: string;
}) {
  const t = useT();
  const summary =
    from !== undefined && to !== undefined
      ? total !== undefined
        ? t("ui.pageSummaryTotal", { from, to, total })
        : t("ui.pageSummary", { from, to })
      : null;
  return (
    <nav
      aria-label={t("ui.pagination")}
      className={cn("flex flex-wrap items-center justify-between gap-3", className)}
    >
      <p aria-live="polite" className="text-sm text-muted">
        {summary}
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onPrevious} disabled={!hasPrevious || loading}>
          {t("ui.previous")}
        </Button>
        <Button variant="secondary" onClick={onNext} disabled={!hasNext || loading}>
          {t("ui.next")}
        </Button>
      </div>
    </nav>
  );
}

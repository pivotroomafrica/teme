import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Skeleton } from "./states";

/**
 * One headline number with its label. The value is pre-formatted by the caller (locale-aware numbers) and
 * comes from the backend's metric definitions; this component never calculates anything.
 */
export function MetricCard({
  label,
  value,
  hint,
  loading = false,
  emphasis = false,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  /** Supporting line: the period, a comparison in words, or a "what is this" note. */
  hint?: ReactNode;
  loading?: boolean;
  /** For the single north-star metric. */
  emphasis?: boolean;
  className?: string;
}) {
  const labelId = useId();
  return (
    <article
      aria-labelledby={labelId}
      aria-busy={loading || undefined}
      className={cn(
        "rounded-card border bg-surface p-5 shadow-sm",
        emphasis ? "border-gold-500 ring-2 ring-gold-300" : "border-border",
        className,
      )}
    >
      <p id={labelId} className="text-sm font-medium text-charcoal-700">
        {label}
      </p>
      {loading ? (
        <Skeleton className="mt-3 h-9 w-24" />
      ) : (
        <p
          className={cn(
            "mt-2 font-bold text-green-900 tabular-nums",
            emphasis ? "text-4xl" : "text-3xl",
          )}
        >
          {value}
        </p>
      )}
      {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
    </article>
  );
}

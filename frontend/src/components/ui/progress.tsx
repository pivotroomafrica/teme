"use client";

import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/client";
import { CheckIcon, StarIcon } from "./icons";

export interface ProgressBarProps {
  value: number;
  max?: number;
  /** Accessible name, also shown above the bar unless hideLabel is set. */
  label: string;
  hideLabel?: boolean;
  /** Text shown beside the bar, e.g. "42%" or "3 / 8". Defaults to value / max. */
  valueText?: string;
  className?: string;
}

/** Determinate progress. The number is always printed too, so the bar is never the only signal. */
export function ProgressBar({
  value,
  max = 100,
  label,
  hideLabel = false,
  valueText,
  className,
}: ProgressBarProps) {
  const safeMax = max > 0 ? max : 1;
  const clamped = Math.min(Math.max(value, 0), safeMax);
  const percent = (clamped / safeMax) * 100;
  return (
    <div className={className}>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
        <span className={cn("font-medium", hideLabel && "sr-only")}>{label}</span>
        <span className="font-semibold text-charcoal-700">
          {valueText ?? `${clamped} / ${safeMax}`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={clamped}
        aria-valuetext={valueText}
        className="h-3 overflow-hidden rounded-full bg-cream-300"
      >
        <div
          className="h-full rounded-full bg-gold-500 transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export interface StampProgressProps {
  current: number;
  required: number;
  /** A reward is waiting: highlights the card (gold) and says so in words. */
  rewardReady?: boolean;
  className?: string;
}

const MAX_DOTS = 20;

/**
 * Loyalty-card progress: one circle per stamp (a bar when the card has more than 20), gold when earned.
 * Earned stamps contain a tick, so they differ from empty ones by shape as well as colour. The whole
 * graphic is one labelled image for screen readers ("3 of 8 stamps").
 */
export function StampProgress({
  current,
  required,
  rewardReady = false,
  className,
}: StampProgressProps) {
  const t = useT();
  const total = Math.max(1, Math.floor(required));
  const earned = Math.min(Math.max(0, Math.floor(current)), total);
  const summary = t("ui.stampProgress", { current: earned, required: total });

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {total <= MAX_DOTS ? (
        <div role="img" aria-label={summary} className="flex flex-wrap gap-2">
          {Array.from({ length: total }, (_, index) => {
            const filled = index < earned;
            return (
              <span
                key={index}
                aria-hidden="true"
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full border-2",
                  filled
                    ? "border-gold-600 bg-gold-500 text-charcoal-900"
                    : "border-dashed border-charcoal-500 bg-surface text-transparent",
                )}
              >
                <CheckIcon size={20} />
              </span>
            );
          })}
        </div>
      ) : (
        <ProgressBar value={earned} max={total} label={t("ui.progress")} hideLabel />
      )}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-lg font-bold text-charcoal-900">{summary}</span>
        {rewardReady ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gold-500 px-3 py-1 text-sm font-bold text-charcoal-900">
            <StarIcon size={16} />
            {t("ui.rewardReady")}
          </span>
        ) : null}
      </p>
    </div>
  );
}

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { toneIcon, toneSurface, type Tone } from "./tone";

/** Small pill for a state ("Active", "Paused"). The icon shape plus the text carry the meaning. */
export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  const Icon = toneIcon[tone];
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-medium",
        toneSurface[tone],
        className,
      )}
    >
      <Icon size={16} className="shrink-0" />
      <span className="min-w-0">{children}</span>
    </span>
  );
}

/** Inline "dot + label" status for tables and lists. */
export function StatusIndicator({
  tone = "neutral",
  label,
  className,
}: {
  tone?: Tone;
  label: ReactNode;
  className?: string;
}) {
  const Icon = toneIcon[tone];
  const colour = {
    neutral: "text-charcoal-600",
    success: "text-green-700",
    warning: "text-gold-text",
    danger: "text-red-700",
    info: "text-charcoal-700",
  }[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-medium", colour, className)}>
      <Icon size={18} className="shrink-0" />
      <span className="min-w-0">{label}</span>
    </span>
  );
}

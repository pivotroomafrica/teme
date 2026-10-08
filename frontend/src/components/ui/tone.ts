import { CheckCircleIcon, DotIcon, InfoIcon, WarningIcon, XCircleIcon } from "./icons";
import type { MessageKey } from "@/lib/i18n/translator";

/**
 * Semantic tones shared by badges, alerts, status indicators and toasts.
 *  - success: done / active   - warning: attention / progress and rewards (gold)
 *  - danger: destructive actions, invalid scans, fraud warnings (the only use of red)
 *  - info and neutral: everything else
 * Every tone has its own icon SHAPE and a spoken label, so meaning never depends on colour alone.
 */
export type Tone = "neutral" | "success" | "warning" | "danger" | "info";

export const toneIcon = {
  neutral: DotIcon,
  success: CheckCircleIcon,
  warning: WarningIcon,
  danger: XCircleIcon,
  info: InfoIcon,
} as const;

export const toneLabelKey: Record<Tone, MessageKey> = {
  neutral: "ui.statusNeutral",
  success: "ui.statusSuccess",
  warning: "ui.statusWarning",
  danger: "ui.statusDanger",
  info: "ui.statusInfo",
};

/** Soft surface + readable text (all pairs are above 4.5:1). */
export const toneSurface: Record<Tone, string> = {
  neutral: "bg-cream-200 text-charcoal-700 border-cream-300",
  success: "bg-green-50 text-green-900 border-green-200",
  warning: "bg-gold-100 text-gold-text border-gold-300",
  danger: "bg-red-50 text-red-700 border-red-600/40",
  info: "bg-surface text-charcoal-700 border-charcoal-500",
};

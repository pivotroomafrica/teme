import type { FraudIndicator } from "@/lib/api/contract";
import type { MessageKey } from "@/lib/i18n/translator";

export interface FieldSpec {
  name: string;
  label: MessageKey;
  min: number;
  max: number;
  /** A fraction rather than a whole number. */
  decimal?: boolean;
}

export interface IndicatorSpec {
  /** Key in the thresholds object the backend uses. */
  key: string;
  flag: FraudIndicator;
  fields: FieldSpec[];
}

const spec = (name: string, min: number, max: number, decimal = false): FieldSpec => ({
  name,
  label: `fraud.field_${name}` as MessageKey,
  min,
  max,
  decimal,
});

/** The settings of each indicator with their allowed ranges (the backend's own limits; it still validates). */
export const INDICATORS: readonly IndicatorSpec[] = [
  {
    key: "excessiveStampsPerStaff",
    flag: "EXCESSIVE_STAMPS_BY_STAFF",
    fields: [spec("windowMinutes", 5, 10_080), spec("maxStamps", 1, 100_000)],
  },
  {
    key: "repeatedScansPerMembership",
    flag: "REPEATED_SCANS_FOR_MEMBERSHIP",
    fields: [spec("windowMinutes", 5, 10_080), spec("maxAttempts", 2, 10_000)],
  },
  {
    key: "unusualBranchActivity",
    flag: "UNUSUAL_BRANCH_ACTIVITY",
    fields: [
      spec("windowMinutes", 5, 1440),
      spec("baselineDays", 1, 90),
      spec("multiplier", 1.5, 100, true),
      spec("minStamps", 1, 100_000),
    ],
  },
  {
    key: "highReversalRate",
    flag: "HIGH_REVERSAL_RATE",
    fields: [
      spec("windowDays", 1, 90),
      spec("minStamps", 1, 100_000),
      spec("maxRatio", 0.01, 1, true),
    ],
  },
  {
    key: "repeatedCooldownRejections",
    flag: "REPEATED_COOLDOWN_REJECTIONS",
    fields: [spec("windowMinutes", 5, 10_080), spec("maxRejections", 2, 10_000)],
  },
  {
    key: "excessiveRedemptions",
    flag: "EXCESSIVE_REDEMPTIONS",
    fields: [spec("windowMinutes", 5, 10_080), spec("maxRedemptions", 1, 10_000)],
  },
];

export type Draft = Record<string, Record<string, string | boolean>>;

export function draftFrom(values: Record<string, Record<string, boolean | number>>): Draft {
  const draft: Draft = {};
  for (const indicator of INDICATORS) {
    const section = values[indicator.key] ?? {};
    const row: Record<string, string | boolean> = { enabled: section.enabled !== false };
    for (const field of indicator.fields) row[field.name] = String(section[field.name] ?? "");
    draft[indicator.key] = row;
  }
  return draft;
}

/** Whether a typed value is wrong: not a number, or outside the allowed range (whole numbers unless a fraction). */
export function fieldProblem(field: FieldSpec, text: string): boolean {
  const pattern = field.decimal ? /^\d+(\.\d+)?$/ : /^\d+$/;
  if (!pattern.test(text.trim())) return true;
  const n = Number(text);
  return n < field.min || n > field.max;
}

/** Only the settings that changed, nested the way the backend's partial update expects. */
export function thresholdPatch(
  before: Draft,
  after: Draft,
): Record<string, Record<string, boolean | number>> {
  const patch: Record<string, Record<string, boolean | number>> = {};
  for (const indicator of INDICATORS) {
    const changes: Record<string, boolean | number> = {};
    const was = before[indicator.key]!;
    const now = after[indicator.key]!;
    if (now.enabled !== was.enabled) changes.enabled = now.enabled as boolean;
    for (const field of indicator.fields) {
      if (now[field.name] !== was[field.name]) changes[field.name] = Number(now[field.name]);
    }
    if (Object.keys(changes).length > 0) patch[indicator.key] = changes;
  }
  return patch;
}

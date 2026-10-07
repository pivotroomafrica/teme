/**
 * Fraud indicators only RAISE FLAGS for a human to review; nothing here blocks a scan, suspends a customer or
 * penalises staff. Every threshold is configurable per merchant and falls back to these defaults.
 */
export interface FraudThresholds {
  /** One staff member issuing an unusual number of stamps in a window. */
  excessiveStampsPerStaff: { enabled: boolean; windowMinutes: number; maxStamps: number };
  /** One card being scanned (successfully or not) over and over. */
  repeatedScansPerMembership: { enabled: boolean; windowMinutes: number; maxAttempts: number };
  /** A branch suddenly busier than its own recent normal. */
  unusualBranchActivity: {
    enabled: boolean;
    windowMinutes: number;
    baselineDays: number;
    multiplier: number;
    minStamps: number;
  };
  /** A large share of one staff member's stamps later reversed. */
  highReversalRate: { enabled: boolean; windowDays: number; minStamps: number; maxRatio: number };
  /** One card repeatedly refused for the cooldown (someone testing the limit). */
  repeatedCooldownRejections: { enabled: boolean; windowMinutes: number; maxRejections: number };
  /** One staff member handing over an unusual number of rewards. */
  excessiveRedemptions: { enabled: boolean; windowMinutes: number; maxRedemptions: number };
}

export type IndicatorKey = keyof FraudThresholds;

export const DEFAULT_THRESHOLDS: FraudThresholds = {
  excessiveStampsPerStaff: { enabled: true, windowMinutes: 60, maxStamps: 40 },
  repeatedScansPerMembership: { enabled: true, windowMinutes: 60, maxAttempts: 6 },
  unusualBranchActivity: {
    enabled: true,
    windowMinutes: 60,
    baselineDays: 7,
    multiplier: 4,
    minStamps: 20,
  },
  highReversalRate: { enabled: true, windowDays: 7, minStamps: 20, maxRatio: 0.2 },
  repeatedCooldownRejections: { enabled: true, windowMinutes: 60, maxRejections: 5 },
  excessiveRedemptions: { enabled: true, windowMinutes: 1440, maxRedemptions: 5 },
};

/** Allowed range of every numeric setting: the single source for validation and documentation. */
export const THRESHOLD_LIMITS: {
  [K in IndicatorKey]: { [F in keyof FraudThresholds[K]]?: [number, number] };
} = {
  excessiveStampsPerStaff: { windowMinutes: [5, 10_080], maxStamps: [1, 100_000] },
  repeatedScansPerMembership: { windowMinutes: [5, 10_080], maxAttempts: [2, 10_000] },
  unusualBranchActivity: {
    windowMinutes: [5, 1440],
    baselineDays: [1, 90],
    multiplier: [1.5, 100],
    minStamps: [1, 100_000],
  },
  highReversalRate: { windowDays: [1, 90], minStamps: [1, 100_000], maxRatio: [0.01, 1] },
  repeatedCooldownRejections: { windowMinutes: [5, 10_080], maxRejections: [2, 10_000] },
  excessiveRedemptions: { windowMinutes: [5, 10_080], maxRedemptions: [1, 10_000] },
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Stored settings merged over the defaults. Unknown keys, wrong types and out-of-range numbers are ignored
 * (the default wins), so a bad stored value can never disable monitoring or crash the evaluator.
 */
export function mergeThresholds(stored: unknown): FraudThresholds {
  const out = structuredClone(DEFAULT_THRESHOLDS) as FraudThresholds;
  if (!isObject(stored)) return out;
  for (const key of Object.keys(DEFAULT_THRESHOLDS) as IndicatorKey[]) {
    const section = stored[key];
    if (!isObject(section)) continue;
    const target = out[key] as Record<string, unknown>;
    for (const field of Object.keys(target)) {
      const value = section[field];
      if (field === 'enabled') {
        if (typeof value === 'boolean') target[field] = value;
        continue;
      }
      const range = (THRESHOLD_LIMITS[key] as Record<string, [number, number] | undefined>)[field];
      if (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        range &&
        value >= range[0] &&
        value <= range[1]
      ) {
        target[field] = value;
      }
    }
  }
  return out;
}

/** Field names that differ between two threshold sets, as "indicator.field" (for the audit log; values stay out). */
export function changedFields(before: FraudThresholds, after: FraudThresholds): string[] {
  const changed: string[] = [];
  for (const key of Object.keys(DEFAULT_THRESHOLDS) as IndicatorKey[]) {
    for (const field of Object.keys(before[key])) {
      if (
        (before[key] as Record<string, unknown>)[field] !==
        (after[key] as Record<string, unknown>)[field]
      ) {
        changed.push(`${key}.${field}`);
      }
    }
  }
  return changed;
}

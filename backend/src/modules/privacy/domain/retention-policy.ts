/**
 * How long a merchant keeps customer personal data it no longer needs. Anonymization (not deletion) is the
 * mechanism: names and phone numbers go, while the stamp/redemption/audit history stays, because it contains
 * no personal identifiers and is needed for security and accounting of rewards.
 */
export interface RetentionPolicy {
  /**
   * Anonymize customers with no stamp or redemption for this many months. 0 = never (keep until asked).
   * Customers who still hold an unexpired reward are never anonymized automatically.
   */
  inactiveCustomerMonths: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = { inactiveCustomerMonths: 36 };

export const MIN_INACTIVE_MONTHS = 6;
export const MAX_INACTIVE_MONTHS = 120;

export function isValidInactiveMonths(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    (value === 0 || (value >= MIN_INACTIVE_MONTHS && value <= MAX_INACTIVE_MONTHS))
  );
}

/** Stored settings over the defaults; anything invalid falls back to the default instead of failing open. */
export function mergeRetention(stored: unknown): RetentionPolicy {
  const out = { ...DEFAULT_RETENTION };
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    const v = (stored as Record<string, unknown>).inactiveCustomerMonths;
    if (isValidInactiveMonths(v)) out.inactiveCustomerMonths = v;
  }
  return out;
}

/** The instant before which "no activity" counts as inactive, or null when the policy never expires data. */
export function inactivityCutoff(policy: RetentionPolicy, now: Date): Date | null {
  if (policy.inactiveCustomerMonths === 0) return null;
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - policy.inactiveCustomerMonths);
  return cutoff;
}

/** Operational clean-up windows that apply to everyone (none of these hold customer content). */
export const CLEANUP = {
  /** Expired scanner responses are removed (they are ignored once expired, this just frees the rows). */
  idempotencyGraceHours: 24,
  /** Refresh tokens are kept this long after they expire or are revoked, for incident investigation. */
  refreshTokenDays: 30,
  /** Delivered outbox jobs are kept this long. Dead jobs are kept until an operator deals with them. */
  completedJobDays: 30,
} as const;

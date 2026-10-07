/** Temporary account lockout after repeated failures (in addition to IP+email rate limiting). */
export const MAX_FAILED_LOGINS = 10;
export const LOCKOUT_MINUTES = 15;

export function isLocked(lockedUntil: Date | null, now: Date): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > now.getTime();
}

export function lockoutExpiry(now: Date): Date {
  return new Date(now.getTime() + LOCKOUT_MINUTES * 60_000);
}

/**
 * Idempotency keys make a scanner action safe to retry: the backend answers a repeated key with the original
 * result (flagged `replayed: true`) instead of stamping twice.
 *
 * Rules for callers:
 *  - create ONE key per user action (the staff member taps "Add stamp" once = one key);
 *  - reuse that SAME key if the tap is retried after a network failure or timeout;
 *  - create a NEW key for the next, different action. Reusing a key with different input is rejected (422).
 * The transport never retries these requests by itself, so the retry is always a deliberate user decision.
 */
export function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

/** Same rule the backend applies: 8 to 128 safe characters. */
export const isValidIdempotencyKey = (key: string): boolean => /^[A-Za-z0-9._:-]{8,128}$/.test(key);

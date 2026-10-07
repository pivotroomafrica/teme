export const MIN_REASON_LENGTH = 3;
export const MAX_REASON_LENGTH = 500;

/**
 * A reversal must be explained. Returns the cleaned reason, or an error message. The text is kept in the
 * reversal record only (never in audit metadata), because free text can contain personal details.
 */
export function cleanReason(
  raw: unknown,
): { ok: true; reason: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'A reason is required.' };
  // Collapse whitespace and drop control characters.
  const reason = raw
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (reason.length < MIN_REASON_LENGTH) {
    return { ok: false, error: `The reason must be at least ${MIN_REASON_LENGTH} characters.` };
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return { ok: false, error: `The reason must be at most ${MAX_REASON_LENGTH} characters.` };
  }
  return { ok: true, reason };
}

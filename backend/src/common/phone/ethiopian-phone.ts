/**
 * Normalizes Ethiopian phone numbers to E.164 (+251 + 9 digits).
 *
 * Accepted inputs (spaces, dashes, dots and parentheses are ignored):
 *   0911234567, 911234567, 251911234567, +251911234567, 00251911234567
 * The 9-digit national number must start with 1-5 (landline), 7 or 9 (mobile).
 * Returns null when the input is not a valid Ethiopian number.
 */
const NATIONAL_NUMBER = /^[1-579][0-9]{8}$/;

export function normalizeEthiopianPhone(input: string): string | null {
  if (typeof input !== 'string') return null;
  const stripped = input.trim().replace(/[\s\-.()]/g, '');
  if (!/^\+?[0-9]+$/.test(stripped)) return null;

  let digits = stripped.startsWith('+') ? stripped.slice(1) : stripped;
  if (stripped.startsWith('+') && !digits.startsWith('251')) return null;

  if (digits.startsWith('00251')) digits = digits.slice(5);
  else if (digits.startsWith('251')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);

  return NATIONAL_NUMBER.test(digits) ? `+251${digits}` : null;
}

export const E164_ETHIOPIA = /^\+251[0-9]{9}$/;

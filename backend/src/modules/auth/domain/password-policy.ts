const MIN_LENGTH = 12;
const MAX_LENGTH = 128;

/**
 * Length-first policy (NIST 800-63B style): long passwords, at least one letter and one digit,
 * and not derived from the account email. Returns a human-readable problem or null when acceptable.
 */
export function checkPassword(password: string, email?: string): string | null {
  if (password.length < MIN_LENGTH) return `Password must be at least ${MIN_LENGTH} characters.`;
  if (password.length > MAX_LENGTH) return `Password must be at most ${MAX_LENGTH} characters.`;
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) {
    return 'Password must contain at least one letter and one digit.';
  }
  const local = email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && password.toLowerCase().includes(local)) {
    return 'Password must not contain your email name.';
  }
  return null;
}

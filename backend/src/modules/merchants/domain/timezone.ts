/** Accepts IANA zone names ("Africa/Addis_Ababa", "UTC"), not raw offsets or abbreviations. */
const IANA_SHAPE = /^(UTC|[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+)$/;

export function isValidTimezone(timezone: string): boolean {
  if (!IANA_SHAPE.test(timezone)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

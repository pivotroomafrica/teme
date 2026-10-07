/**
 * Calendar days in a named time zone, converted to exact UTC instants. Used wherever a person types a date
 * ("1 October") that must mean the merchant's local day, not the server's. Handles zones with daylight
 * saving by resolving the offset that applies on that day.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Offset of `timeZone` from UTC at the given instant, in milliseconds (positive = ahead of UTC). */
export function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(new Date(utcMs))
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

export const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date such as 2026-02-28 (rejects 2026-02-30). */
export function isCalendarDate(value: string): boolean {
  const m = DATE_ONLY.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

/** The instant a local calendar day starts in `timeZone` ("2026-10-01" in Africa/Addis_Ababa = 2026-09-30T21:00Z). */
export function zonedDayStart(date: string, timeZone: string): Date {
  const m = DATE_ONLY.exec(date);
  if (!m || !isCalendarDate(date)) throw new Error('Invalid calendar date');
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // The offset can differ between local midnight and the guess; settle it in two passes.
  let instant = naive - zoneOffsetMs(naive, timeZone);
  instant = naive - zoneOffsetMs(instant, timeZone);
  return new Date(instant);
}

/** The first instant AFTER a local day, i.e. an exclusive upper bound for "up to and including this date". */
export function zonedDayEndExclusive(date: string, timeZone: string): Date {
  const m = DATE_ONLY.exec(date);
  if (!m || !isCalendarDate(date)) throw new Error('Invalid calendar date');
  const next = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
  return zonedDayStart(next.toISOString().slice(0, 10), timeZone);
}

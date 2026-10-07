import { DATE_ONLY, isCalendarDate, zonedDayEndExclusive, zonedDayStart } from './zoned';

export const DEFAULT_RANGE_DAYS = 30;
export const MAX_RANGE_DAYS = 366;
const DAY = 86_400_000;

export interface ResolvedRange {
  /** Inclusive. */
  from: Date;
  /** Exclusive. */
  to: Date;
}

export type RangeResult = { ok: true; range: ResolvedRange } | { ok: false; error: string };

function parseBound(value: string, side: 'from' | 'to', timeZone: string): Date | null {
  if (DATE_ONLY.test(value)) {
    if (!isCalendarDate(value)) return null;
    // A bare date means the merchant's local day: "from" is its start, "to" includes the whole day.
    return side === 'from' ? zonedDayStart(value, timeZone) : zonedDayEndExclusive(value, timeZone);
  }
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t);
}

/**
 * Turns the `from` / `to` filters into an exact UTC range. Bare dates (2026-10-01) are interpreted in the
 * merchant's time zone; full timestamps are taken as given. With no filters the last 30 days are shown, and
 * ranges are capped so one request cannot scan the whole history.
 */
export function resolveRange(
  from: string | undefined,
  to: string | undefined,
  timeZone: string,
  now: Date,
): RangeResult {
  const end = to ? parseBound(to, 'to', timeZone) : new Date(now.getTime() + 1);
  const start = from
    ? parseBound(from, 'from', timeZone)
    : end
      ? new Date(end.getTime() - DEFAULT_RANGE_DAYS * DAY)
      : null;
  if (!start || !end)
    return {
      ok: false,
      error: 'from/to must be a calendar date (YYYY-MM-DD) or an ISO 8601 timestamp.',
    };
  if (start.getTime() >= end.getTime()) return { ok: false, error: '"from" must be before "to".' };
  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY) {
    return { ok: false, error: `The date range may not exceed ${MAX_RANGE_DAYS} days.` };
  }
  return { ok: true, range: { from: start, to: end } };
}

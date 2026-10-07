import { zonedDayStart } from '../../../common/time/zoned';

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const isMonth = (value: string): boolean => MONTH.test(value);

/** "2026-10" shifted by `delta` months (negative = earlier). */
export function shiftMonth(month: string, delta: number): string {
  const m = MONTH.exec(month);
  if (!m) throw new Error('Invalid month');
  const index = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Whole months from `a` to `b` (b - a). */
export function monthsBetween(a: string, b: string): number {
  const ma = MONTH.exec(a);
  const mb = MONTH.exec(b);
  if (!ma || !mb) throw new Error('Invalid month');
  return (Number(mb[1]) - Number(ma[1])) * 12 + (Number(mb[2]) - Number(ma[2]));
}

/** The calendar month containing `instant` on the merchant's wall clock. */
export function monthOf(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(instant);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  return `${year}-${month}`;
}

/** [start, end) of a local calendar month, as exact UTC instants. */
export function monthRange(month: string, timeZone: string): { from: Date; to: Date } {
  return {
    from: zonedDayStart(`${month}-01`, timeZone),
    to: zonedDayStart(`${shiftMonth(month, 1)}-01`, timeZone),
  };
}

/** n / d to four decimals, or null when there is nothing to divide by (never 0 or NaN). */
export function ratio(n: number, d: number): number | null {
  return d === 0 ? null : Math.round((n / d) * 10_000) / 10_000;
}

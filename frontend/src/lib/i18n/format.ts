import { localeTags, type Locale } from "./config";
import { formatEthiopianPhone, maskEthiopianPhone, type PhoneStyle } from "./phone";

/** Ethiopia has a single time zone; showing it explicitly keeps server and browser output identical. */
export const DISPLAY_TIME_ZONE = "Africa/Addis_Ababa";

export type DateInput = Date | string | number;

export interface Formatter {
  locale: Locale;
  /** 1,234.5 */
  number(value: number, options?: Intl.NumberFormatOptions): string;
  integer(value: number): string;
  /** Takes a fraction: 0.25 → 25% */
  percent(fraction: number): string;
  /** 8 Oct 2026 */
  date(value: DateInput, style?: "short" | "medium" | "long"): string;
  time(value: DateInput): string;
  /** A calendar date written as YYYY-MM-DD, shown as the same day in every time zone. */
  calendarDate(day: string, style?: "short" | "medium" | "long"): string;
  /** A calendar month written as YYYY-MM, e.g. "October 2026". */
  month(month: string): string;
  dateTime(value: DateInput): string;
  /** "3 days ago", "in 2 hours" */
  relative(value: DateInput, now?: DateInput): string;
  list(items: string[]): string;
  phone(value: string, style?: PhoneStyle): string;
  maskedPhone(value: string, style?: PhoneStyle): string;
}

function toDate(value: DateInput): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const RELATIVE_STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/**
 * Dates, numbers and phone numbers for one language. Dates use the Gregorian calendar and the Addis Ababa time
 * zone (or the given IANA zone, such as a business time zone) in both languages; digits stay 0-9 so amounts and counts read the same everywhere. An unreadable date
 * becomes an em dash rather than "Invalid Date".
 */
export function createFormatter(locale: Locale, timeZone: string = DISPLAY_TIME_ZONE): Formatter {
  const tag = localeTags[locale];
  const dateFormat = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(tag, { calendar: "gregory", timeZone, ...options });

  const safe =
    (make: (date: Date) => string) =>
    (value: DateInput): string => {
      const date = toDate(value);
      return date ? make(date) : "—";
    };

  return {
    locale,
    number: (value, options) => new Intl.NumberFormat(tag, options).format(value),
    integer: (value) => new Intl.NumberFormat(tag, { maximumFractionDigits: 0 }).format(value),
    percent: (fraction) =>
      new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits: 0 }).format(fraction),
    date: (value, style = "medium") => {
      const date = toDate(value);
      return date ? dateFormat({ dateStyle: style }).format(date) : "—";
    },
    time: safe((d) => dateFormat({ timeStyle: "short" }).format(d)),
    calendarDate: (day, style = "medium") => {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
      if (!match) return "—";
      const at = new Date(Date.UTC(+match[1]!, +match[2]! - 1, +match[3]!));
      return dateFormat({ dateStyle: style, timeZone: "UTC" }).format(at);
    },
    month: (month) => {
      const match = /^(\d{4})-(\d{2})$/.exec(month);
      if (!match) return "—";
      const at = new Date(Date.UTC(+match[1]!, +match[2]! - 1, 1));
      return dateFormat({ month: "long", year: "numeric", timeZone: "UTC" }).format(at);
    },
    dateTime: safe((d) => dateFormat({ dateStyle: "medium", timeStyle: "short" }).format(d)),
    relative: (value, now = new Date()) => {
      const date = toDate(value);
      const base = toDate(now);
      if (!date || !base) return "—";
      const seconds = Math.round((date.getTime() - base.getTime()) / 1000);
      const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
      for (const [unit, size] of RELATIVE_STEPS) {
        if (Math.abs(seconds) >= size) return rtf.format(Math.trunc(seconds / size), unit);
      }
      return rtf.format(0, "second");
    },
    list: (items) => new Intl.ListFormat(tag, { style: "long", type: "conjunction" }).format(items),
    phone: formatEthiopianPhone,
    maskedPhone: maskEthiopianPhone,
  };
}

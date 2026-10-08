/**
 * Date ranges for the dashboard. Only calendar arithmetic lives here: which days to ask for. Every metric is
 * computed by the backend, which reads these dates in the business time zone (`from` inclusive, `to` includes that
 * whole day, at most 366 days), so the browser never adds, averages or compares any figure itself.
 */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
export const MAX_RANGE_DAYS = 366;

export interface Range {
  from: string;
  to: string;
}

export type Preset = "last7" | "last30" | "last90" | "thisMonth" | "lastMonth";
export const PRESETS: readonly Preset[] = ["last7", "last30", "last90", "thisMonth", "lastMonth"];
export const DEFAULT_PRESET: Preset = "last30";

const toMs = (day: string) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Whether the text is a real calendar date (2026-02-30 is not). */
export function isCalendarDate(value: string | null | undefined): value is string {
  return typeof value === "string" && DATE.test(value) && toDay(toMs(value)) === value;
}

export const addDays = (day: string, days: number) => toDay(toMs(day) + days * DAY_MS);
export const daysInclusive = (range: Range) =>
  Math.round((toMs(range.to) - toMs(range.from)) / DAY_MS) + 1;

/** Today's date as a business would read it on the wall, in the given IANA time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    // An unknown zone name must not break the page: fall back to the date in UTC.
    return toDay(now.getTime());
  }
}

const firstOfMonth = (day: string) => `${day.slice(0, 7)}-01`;
const lastOfPreviousMonth = (day: string) => addDays(firstOfMonth(day), -1);

/** The days a preset covers, ending today. */
export function presetRange(preset: Preset, today: string): Range {
  switch (preset) {
    case "last7":
      return { from: addDays(today, -6), to: today };
    case "last30":
      return { from: addDays(today, -29), to: today };
    case "last90":
      return { from: addDays(today, -89), to: today };
    case "thisMonth":
      return { from: firstOfMonth(today), to: today };
    case "lastMonth": {
      const end = lastOfPreviousMonth(today);
      return { from: firstOfMonth(end), to: end };
    }
  }
}

export type RangeProblem = "invalid" | "order" | "tooLong";

/** Checks a range the way the backend will, so the person is told before anything is sent. */
export function checkRange(from: string, to: string): RangeProblem | null {
  if (!isCalendarDate(from) || !isCalendarDate(to)) return "invalid";
  if (from > to) return "order";
  if (daysInclusive({ from, to }) > MAX_RANGE_DAYS) return "tooLong";
  return null;
}

/** Which preset a range is, if any (so the control can show it as selected). */
export function matchPreset(range: Range, today: string): Preset | null {
  return (
    PRESETS.find((p) => {
      const candidate = presetRange(p, today);
      return candidate.from === range.from && candidate.to === range.to;
    }) ?? null
  );
}

/** The range described by the page address: `?range=last7`, or `?from=…&to=…`; anything else is the default. */
export function rangeFromParams(
  params: { get(name: string): string | null },
  today: string,
): { range: Range; preset: Preset | "custom" } {
  const preset = params.get("range");
  if (PRESETS.includes(preset as Preset)) {
    return { range: presetRange(preset as Preset, today), preset: preset as Preset };
  }
  const from = params.get("from");
  const to = params.get("to");
  if (isCalendarDate(from) && isCalendarDate(to) && checkRange(from, to) === null) {
    return { range: { from, to }, preset: "custom" };
  }
  return { range: presetRange(DEFAULT_PRESET, today), preset: DEFAULT_PRESET };
}

/** The address query for a choice. The default is left out so the plain page address stays clean. */
export function paramsFor(choice: Preset | { from: string; to: string }): string {
  if (typeof choice === "string") return choice === DEFAULT_PRESET ? "" : `?range=${choice}`;
  return `?from=${choice.from}&to=${choice.to}`;
}

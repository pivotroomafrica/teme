const MINUTE = 60_000;
const DAY = 86_400_000;

export interface Bucket {
  start: Date;
  end: Date;
}

/**
 * Time is cut into fixed, UTC-aligned buckets of `windowMinutes`, and the previous and current buckets are
 * evaluated. A fixed bucket gives every observation a stable identity, so re-running the evaluation (every
 * few minutes, or on several servers) updates the same flag instead of creating duplicates. The cost: a burst
 * straddling a bucket boundary is split in two, which is why the previous bucket is checked as well.
 */
export function recentBuckets(now: Date, windowMinutes: number): Bucket[] {
  const size = windowMinutes * MINUTE;
  const currentStart = Math.floor(now.getTime() / size) * size;
  return [currentStart - size, currentStart].map((s) => ({
    start: new Date(s),
    end: new Date(s + size),
  }));
}

/** A rolling window of whole UTC days ending with the day containing `now`; one flag per day. */
export function dayWindow(now: Date, windowDays: number): Bucket {
  const dayStart = Math.floor(now.getTime() / DAY) * DAY;
  return { start: new Date(dayStart - (windowDays - 1) * DAY), end: new Date(dayStart + DAY) };
}

export interface SpikeInput {
  count: number;
  /** Stamps in the baseline period before the bucket. */
  baselineTotal: number;
  baselineDays: number;
  windowMinutes: number;
  multiplier: number;
  minStamps: number;
}

/** Is this bucket far above the branch's own normal? Returns the average bucket volume it was judged against. */
export function branchSpike(i: SpikeInput): { flagged: boolean; baselineAverage: number } {
  const bucketsInBaseline = (i.baselineDays * 1440) / i.windowMinutes;
  const baselineAverage = i.baselineTotal / bucketsInBaseline;
  const flagged = i.count >= i.minStamps && i.count >= i.multiplier * baselineAverage;
  return { flagged, baselineAverage: Math.round(baselineAverage * 100) / 100 };
}

export function reversalRate(total: number, reversed: number): number {
  return total === 0 ? 0 : reversed / total;
}

export function exceedsReversalRate(
  total: number,
  reversed: number,
  minStamps: number,
  maxRatio: number,
): boolean {
  return total >= minStamps && reversalRate(total, reversed) > maxRatio;
}

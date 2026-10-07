import { DEFAULT_THRESHOLDS, changedFields, mergeThresholds } from './fraud-thresholds';
import {
  branchSpike,
  dayWindow,
  exceedsReversalRate,
  recentBuckets,
  reversalRate,
} from './fraud-rules';

describe('mergeThresholds', () => {
  it('returns the defaults for missing or garbage settings', () => {
    for (const stored of [undefined, null, {}, [], 'x', 5]) {
      expect(mergeThresholds(stored)).toEqual(DEFAULT_THRESHOLDS);
    }
  });

  it('applies valid overrides and keeps the rest', () => {
    const t = mergeThresholds({
      excessiveStampsPerStaff: { maxStamps: 10, windowMinutes: 30 },
      highReversalRate: { enabled: false },
    });
    expect(t.excessiveStampsPerStaff).toEqual({ enabled: true, windowMinutes: 30, maxStamps: 10 });
    expect(t.highReversalRate.enabled).toBe(false);
    expect(t.highReversalRate.maxRatio).toBe(DEFAULT_THRESHOLDS.highReversalRate.maxRatio);
    expect(t.excessiveRedemptions).toEqual(DEFAULT_THRESHOLDS.excessiveRedemptions);
  });

  it('ignores out-of-range, wrong-typed and unknown values instead of failing open', () => {
    const t = mergeThresholds({
      excessiveStampsPerStaff: { maxStamps: -1, windowMinutes: 'soon', enabled: 'no', surprise: 1 },
      highReversalRate: { maxRatio: 5, minStamps: Number.NaN },
      unusualBranchActivity: { multiplier: 0.5 },
      notAnIndicator: { enabled: false },
    });
    expect(t).toEqual(DEFAULT_THRESHOLDS);
  });

  it('does not mutate the defaults', () => {
    const t = mergeThresholds({ excessiveStampsPerStaff: { maxStamps: 1 } });
    t.excessiveStampsPerStaff.maxStamps = 999;
    expect(DEFAULT_THRESHOLDS.excessiveStampsPerStaff.maxStamps).toBe(40);
  });
});

describe('changedFields', () => {
  it('lists indicator.field names only', () => {
    const after = mergeThresholds({ excessiveRedemptions: { maxRedemptions: 2, enabled: false } });
    expect(changedFields(DEFAULT_THRESHOLDS, after).sort()).toEqual([
      'excessiveRedemptions.enabled',
      'excessiveRedemptions.maxRedemptions',
    ]);
    expect(changedFields(DEFAULT_THRESHOLDS, DEFAULT_THRESHOLDS)).toEqual([]);
  });
});

describe('recentBuckets', () => {
  it('returns the previous and current UTC-aligned buckets', () => {
    const [prev, cur] = recentBuckets(new Date('2026-10-09T10:25:30Z'), 60);
    expect(prev?.start.toISOString()).toBe('2026-10-09T09:00:00.000Z');
    expect(cur?.start.toISOString()).toBe('2026-10-09T10:00:00.000Z');
    expect(cur?.end.toISOString()).toBe('2026-10-09T11:00:00.000Z');
  });
  it('gives the same bucket for any instant inside it (stable flag identity)', () => {
    const a = recentBuckets(new Date('2026-10-09T10:00:00Z'), 15)[1];
    const b = recentBuckets(new Date('2026-10-09T10:14:59.999Z'), 15)[1];
    expect(a?.start.getTime()).toBe(b?.start.getTime());
    expect(recentBuckets(new Date('2026-10-09T10:15:00Z'), 15)[1]?.start.toISOString()).toBe(
      '2026-10-09T10:15:00.000Z',
    );
  });
  it('handles windows of a day or more', () => {
    const [prev, cur] = recentBuckets(new Date('2026-10-09T10:00:00Z'), 1440);
    expect(cur?.start.toISOString()).toBe('2026-10-09T00:00:00.000Z');
    expect(prev?.start.toISOString()).toBe('2026-10-08T00:00:00.000Z');
  });
});

describe('dayWindow', () => {
  it('covers N whole UTC days ending today', () => {
    const w = dayWindow(new Date('2026-10-09T10:00:00Z'), 7);
    expect(w.start.toISOString()).toBe('2026-10-03T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-10-10T00:00:00.000Z');
  });
});

describe('branchSpike', () => {
  const base = { baselineDays: 7, windowMinutes: 60, multiplier: 4, minStamps: 20 };
  it('flags a bucket far above the branch’s normal', () => {
    // 168 hourly buckets, 336 stamps -> average 2 per hour; 30 is 15x
    expect(branchSpike({ ...base, count: 30, baselineTotal: 336 })).toEqual({
      flagged: true,
      baselineAverage: 2,
    });
  });
  it('does not flag normal busy hours', () => {
    expect(branchSpike({ ...base, count: 30, baselineTotal: 168 * 10 }).flagged).toBe(false);
  });
  it('never flags small volumes, however unusual', () => {
    expect(branchSpike({ ...base, count: 19, baselineTotal: 0 }).flagged).toBe(false);
  });
  it('flags a brand-new branch only once it passes the minimum volume', () => {
    expect(branchSpike({ ...base, count: 20, baselineTotal: 0 }).flagged).toBe(true);
  });
  it('is exactly at the multiplier boundary inclusive', () => {
    expect(branchSpike({ ...base, count: 20, baselineTotal: 168 * 5 }).flagged).toBe(true); // 20 >= 4*5
    expect(branchSpike({ ...base, count: 20, baselineTotal: 168 * 5 + 1 }).flagged).toBe(false);
  });
});

describe('reversal rate', () => {
  it('computes the share of reversed stamps', () => {
    expect(reversalRate(0, 0)).toBe(0);
    expect(reversalRate(10, 3)).toBeCloseTo(0.3);
  });
  it('needs enough volume and a rate strictly above the limit', () => {
    expect(exceedsReversalRate(10, 9, 20, 0.2)).toBe(false); // too few stamps to judge
    expect(exceedsReversalRate(20, 4, 20, 0.2)).toBe(false); // exactly at the limit
    expect(exceedsReversalRate(20, 5, 20, 0.2)).toBe(true);
  });
});

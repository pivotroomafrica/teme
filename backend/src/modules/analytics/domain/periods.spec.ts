import { isMonth, monthOf, monthRange, monthsBetween, ratio, shiftMonth } from './periods';

const ADDIS = 'Africa/Addis_Ababa';

describe('month arithmetic', () => {
  it('validates month strings', () => {
    expect(['2026-01', '2026-12'].every(isMonth)).toBe(true);
    expect(['2026-00', '2026-13', '2026-1', '26-01', '2026-01-01', ''].some(isMonth)).toBe(false);
  });

  it('shifts across year boundaries in both directions', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-10', -23)).toBe('2024-11');
    expect(shiftMonth('2026-10', 0)).toBe('2026-10');
  });

  it('counts whole months between two months', () => {
    expect(monthsBetween('2025-11', '2026-02')).toBe(3);
    expect(monthsBetween('2026-02', '2026-02')).toBe(0);
    expect(monthsBetween('2026-03', '2026-01')).toBe(-2);
  });
});

describe('merchant time zone boundaries', () => {
  it('starts a month at local midnight, which is 21:00 UTC the evening before in Addis Ababa', () => {
    const r = monthRange('2026-10', ADDIS);
    expect(r.from.toISOString()).toBe('2026-09-30T21:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-10-31T21:00:00.000Z');
  });

  it('puts an instant on the right local month either side of midnight', () => {
    // 20:59:59.999Z on Sep 30 is still September in Addis; one millisecond later it is October.
    expect(monthOf(new Date('2026-09-30T20:59:59.999Z'), ADDIS)).toBe('2026-09');
    expect(monthOf(new Date('2026-09-30T21:00:00.000Z'), ADDIS)).toBe('2026-10');
    expect(monthOf(new Date('2026-09-30T21:00:00.000Z'), 'UTC')).toBe('2026-09');
  });

  it('honours zones behind UTC and daylight saving', () => {
    const ny = monthRange('2026-03', 'America/New_York');
    expect(ny.from.toISOString()).toBe('2026-03-01T05:00:00.000Z');
    // DST starts on March 8, so April begins at 04:00Z.
    expect(ny.to.toISOString()).toBe('2026-04-01T04:00:00.000Z');
    expect(monthOf(new Date('2026-03-01T04:59:59.000Z'), 'America/New_York')).toBe('2026-02');
  });

  it('covers every instant exactly once with adjacent months', () => {
    const a = monthRange('2026-02', ADDIS);
    const b = monthRange('2026-03', ADDIS);
    expect(a.to.getTime()).toBe(b.from.getTime());
    // February 2026 has 28 days.
    expect((a.to.getTime() - a.from.getTime()) / 86_400_000).toBe(28);
  });
});

describe('ratio', () => {
  it('rounds to four decimals and returns null instead of dividing by zero', () => {
    expect(ratio(1, 3)).toBe(0.3333);
    expect(ratio(2, 3)).toBe(0.6667);
    expect(ratio(0, 5)).toBe(0);
    expect(ratio(5, 0)).toBeNull();
    expect(ratio(0, 0)).toBeNull();
    expect(ratio(3, 2)).toBe(1.5);
  });
});

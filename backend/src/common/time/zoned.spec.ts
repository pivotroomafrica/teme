import { isCalendarDate, zoneOffsetMs, zonedDayEndExclusive, zonedDayStart } from './zoned';

const H = 3_600_000;

describe('zoned days', () => {
  it('knows the offset of Ethiopia (UTC+3, no daylight saving)', () => {
    expect(zoneOffsetMs(Date.UTC(2026, 0, 1), 'Africa/Addis_Ababa')).toBe(3 * H);
    expect(zoneOffsetMs(Date.UTC(2026, 6, 1), 'Africa/Addis_Ababa')).toBe(3 * H);
    expect(zoneOffsetMs(Date.UTC(2026, 6, 1), 'UTC')).toBe(0);
  });

  it('turns a local date into the right UTC instant', () => {
    expect(zonedDayStart('2026-10-01', 'Africa/Addis_Ababa').toISOString()).toBe(
      '2026-09-30T21:00:00.000Z',
    );
    expect(zonedDayStart('2026-10-01', 'UTC').toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(zonedDayStart('2026-10-01', 'America/New_York').toISOString()).toBe(
      '2026-10-01T04:00:00.000Z',
    );
  });

  it('handles daylight-saving transitions on the day itself', () => {
    // US clocks go forward on 2026-03-08: that day is 23 hours long.
    const start = zonedDayStart('2026-03-08', 'America/New_York');
    const end = zonedDayEndExclusive('2026-03-08', 'America/New_York');
    expect(start.toISOString()).toBe('2026-03-08T05:00:00.000Z'); // EST (UTC-5)
    expect(end.toISOString()).toBe('2026-03-09T04:00:00.000Z'); // EDT (UTC-4)
    expect((end.getTime() - start.getTime()) / H).toBe(23);
  });

  it('gives exclusive end-of-day bounds that tile with the next day', () => {
    const tz = 'Africa/Addis_Ababa';
    expect(zonedDayEndExclusive('2026-10-01', tz).getTime()).toBe(
      zonedDayStart('2026-10-02', tz).getTime(),
    );
    expect(zonedDayEndExclusive('2026-12-31', tz).toISOString()).toBe('2026-12-31T21:00:00.000Z');
    expect(zonedDayEndExclusive('2026-02-28', 'UTC').toISOString()).toBe(
      '2026-03-01T00:00:00.000Z',
    );
  });

  it('validates calendar dates', () => {
    expect(isCalendarDate('2026-02-28')).toBe(true);
    expect(isCalendarDate('2028-02-29')).toBe(true);
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-1', '26-01-01', 'nope', '']) {
      expect(isCalendarDate(bad)).toBe(false);
    }
    expect(() => zonedDayStart('2026-02-30', 'UTC')).toThrow();
  });
});

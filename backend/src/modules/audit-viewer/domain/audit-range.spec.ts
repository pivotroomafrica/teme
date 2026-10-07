import { MAX_RANGE_DAYS, resolveRange, stripNetworkMetadata } from './audit-range';

const now = new Date('2026-10-09T10:00:00.000Z');
const tz = 'Africa/Addis_Ababa';

describe('resolveRange', () => {
  it('defaults to the last 30 days ending now', () => {
    const r = resolveRange(undefined, undefined, tz, now);
    expect(r.ok && r.range.to.getTime()).toBeGreaterThan(now.getTime());
    expect(r.ok && (r.range.to.getTime() - r.range.from.getTime()) / 86_400_000).toBeCloseTo(30, 3);
  });

  it('reads bare dates as the merchant’s local days, with an inclusive end date', () => {
    const r = resolveRange('2026-10-01', '2026-10-03', tz, now);
    expect(r).toEqual({
      ok: true,
      range: {
        from: new Date('2026-09-30T21:00:00.000Z'),
        to: new Date('2026-10-03T21:00:00.000Z'),
      },
    });
    // The same dates in UTC are three hours apart from Addis.
    const utc = resolveRange('2026-10-01', '2026-10-03', 'UTC', now);
    expect(utc.ok && utc.range.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('takes full timestamps exactly as given', () => {
    const r = resolveRange('2026-10-01T08:30:00Z', '2026-10-01T09:30:00Z', tz, now);
    expect(r.ok && [r.range.from.toISOString(), r.range.to.toISOString()]).toEqual([
      '2026-10-01T08:30:00.000Z',
      '2026-10-01T09:30:00.000Z',
    ]);
  });

  it('supports one-sided ranges', () => {
    const onlyFrom = resolveRange('2026-10-01', undefined, tz, now);
    expect(onlyFrom.ok).toBe(true);
    const onlyTo = resolveRange(undefined, '2026-10-05', tz, now);
    expect(
      onlyTo.ok && (onlyTo.range.to.getTime() - onlyTo.range.from.getTime()) / 86_400_000,
    ).toBe(30);
  });

  it.each([
    ['nope', undefined],
    ['2026-02-30', undefined],
    [undefined, '2026-13-01'],
    ['2026-10-05', '2026-10-01'],
    ['2024-01-01', '2026-10-01'],
  ])('rejects from=%s to=%s', (from, to) => {
    const r = resolveRange(from, to, tz, now);
    expect(r.ok).toBe(false);
  });

  it('allows exactly the maximum range and rejects one day more', () => {
    expect(resolveRange('2024-12-31', '2026-01-01T00:00:00Z', 'UTC', now).ok).toBe(true); // exactly 366 days
    const tooLong = resolveRange('2024-12-30', '2026-01-01T00:00:00Z', 'UTC', now);
    expect(tooLong).toMatchObject({ ok: false });
    expect(MAX_RANGE_DAYS).toBe(366);
  });
});

describe('stripNetworkMetadata', () => {
  it('removes network and device details but keeps the rest', () => {
    expect(
      stripNetworkMetadata({
        ip: '1.2.3.4',
        userAgent: 'x',
        deviceLabel: 'tab',
        reason: 'bad_password',
      }),
    ).toEqual({
      reason: 'bad_password',
    });
  });
  it('tolerates non-objects', () => {
    expect(stripNetworkMetadata(null)).toBeNull();
    expect(stripNetworkMetadata([1])).toEqual([1]);
    expect(stripNetworkMetadata('x')).toBe('x');
  });
});

import { ConsentRow, isGranted } from './consent';

const row = (type: ConsentRow['type'], action: ConsentRow['action'], iso: string): ConsentRow => ({
  type,
  action,
  occurredAt: new Date(iso),
});

describe('isGranted', () => {
  it('is false with no history', () => {
    expect(isGranted([], 'MARKETING')).toBe(false);
  });
  it('follows the latest row per type regardless of order', () => {
    const rows = [
      row('MARKETING', 'WITHDRAWN', '2026-02-01T00:00:00Z'),
      row('MARKETING', 'GRANTED', '2026-01-01T00:00:00Z'),
      row('LOYALTY_TERMS', 'GRANTED', '2026-01-01T00:00:00Z'),
    ];
    expect(isGranted(rows, 'MARKETING')).toBe(false);
    expect(isGranted(rows, 'LOYALTY_TERMS')).toBe(true);
  });
  it('supports re-granting after withdrawal', () => {
    const rows = [
      row('MARKETING', 'GRANTED', '2026-01-01T00:00:00Z'),
      row('MARKETING', 'WITHDRAWN', '2026-02-01T00:00:00Z'),
      row('MARKETING', 'GRANTED', '2026-03-01T00:00:00Z'),
    ];
    expect(isGranted(rows, 'MARKETING')).toBe(true);
  });
});

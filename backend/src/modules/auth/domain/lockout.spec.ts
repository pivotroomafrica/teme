import { LOCKOUT_MINUTES, isLocked, lockoutExpiry } from './lockout';

describe('lockout', () => {
  const now = new Date('2026-01-01T12:00:00.000Z');

  it('is not locked without a lock timestamp or after expiry', () => {
    expect(isLocked(null, now)).toBe(false);
    expect(isLocked(new Date('2026-01-01T11:59:59.999Z'), now)).toBe(false);
    expect(isLocked(now, now)).toBe(false);
  });

  it('is locked until the expiry instant', () => {
    expect(isLocked(new Date('2026-01-01T12:00:00.001Z'), now)).toBe(true);
  });

  it('computes expiry in UTC minutes', () => {
    expect(lockoutExpiry(now).getTime() - now.getTime()).toBe(LOCKOUT_MINUTES * 60_000);
  });
});

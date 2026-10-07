import {
  MESSAGES,
  REJECTION_REASONS,
  cooldownRemainingSeconds,
  effectiveCooldownSeconds,
} from './scan-policy';

describe('effectiveCooldownSeconds', () => {
  it('uses the program cooldown when it is longer than the guard', () => {
    expect(effectiveCooldownSeconds(60, 10)).toBe(3600);
  });
  it('falls back to the double-scan guard when the program has no cooldown', () => {
    expect(effectiveCooldownSeconds(0, 10)).toBe(10);
    expect(effectiveCooldownSeconds(0, 0)).toBe(0);
  });
});

describe('cooldownRemainingSeconds', () => {
  const now = new Date('2026-05-01T12:00:00.000Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it('is zero without a previous stamp or without a cooldown', () => {
    expect(cooldownRemainingSeconds(null, now, 3600)).toBe(0);
    expect(cooldownRemainingSeconds(ago(1000), now, 0)).toBe(0);
  });
  it('counts down and rounds up', () => {
    expect(cooldownRemainingSeconds(ago(0), now, 60)).toBe(60);
    expect(cooldownRemainingSeconds(ago(59_500), now, 60)).toBe(1);
    expect(cooldownRemainingSeconds(ago(30_000), now, 60)).toBe(30);
  });
  it('allows the stamp exactly when the cooldown has elapsed', () => {
    expect(cooldownRemainingSeconds(ago(60_000), now, 60)).toBe(0);
    expect(cooldownRemainingSeconds(ago(60_001), now, 60)).toBe(0);
  });
  it('treats a future-dated previous stamp (clock skew) as a full wait, not a crash', () => {
    expect(cooldownRemainingSeconds(new Date(now.getTime() + 5000), now, 60)).toBe(65);
  });
});

describe('messages', () => {
  it('provides English and Amharic text for every rejection reason', () => {
    for (const reason of REJECTION_REASONS) {
      expect(MESSAGES[reason].en.length).toBeGreaterThan(0);
      expect(MESSAGES[reason].am.length).toBeGreaterThan(0);
    }
  });
  it('does not leak internals in any message', () => {
    for (const m of Object.values(MESSAGES)) {
      expect(`${m.en} ${m.am}`).not.toMatch(/database|sql|prisma|token hash|tenant|merchant id/i);
    }
  });
});

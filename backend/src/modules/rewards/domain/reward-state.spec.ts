import {
  UnlockInput,
  canReverseStamp,
  deriveRewards,
  needsNewUnlock,
  rewardsEarned,
} from './reward-state';

const now = new Date('2026-06-01T00:00:00Z');
const day = 86_400_000;
const unlock = (id: string, daysAgo: number, over: Partial<UnlockInput> = {}): UnlockInput => ({
  id,
  unlockedAt: new Date(now.getTime() - daysAgo * day),
  expiresAt: null,
  redeemed: false,
  ...over,
});
const states = (r: ReturnType<typeof deriveRewards>) => r.map((x) => `${x.id}:${x.state}`);

describe('rewardsEarned', () => {
  it('counts completed cards from effective stamps', () => {
    expect([0, 2, 3, 5, 6, 9].map((n) => rewardsEarned(n, 3))).toEqual([0, 0, 1, 1, 2, 3]);
    expect(rewardsEarned(-4, 3)).toBe(0);
  });
});

describe('deriveRewards', () => {
  const run = (effectiveStamps: number, unlocks: UnlockInput[]) =>
    states(deriveRewards({ effectiveStamps, required: 3, unlocks, now }));

  it('marks backed, unredeemed rows AVAILABLE', () => {
    expect(run(6, [unlock('a', 5), unlock('b', 1)])).toEqual(['a:AVAILABLE', 'b:AVAILABLE']);
  });

  it('keeps redeemed rows REDEEMED and gives the remaining entitlement to the earliest unredeemed row', () => {
    expect(run(6, [unlock('a', 5), unlock('b', 1, { redeemed: true })])).toEqual([
      'a:AVAILABLE',
      'b:REDEEMED',
    ]);
    expect(run(6, [unlock('a', 5, { redeemed: true }), unlock('b', 1)])).toEqual([
      'a:REDEEMED',
      'b:AVAILABLE',
    ]);
  });

  it('voids the newest unredeemed rows when stamps are reversed (LIFO)', () => {
    expect(run(5, [unlock('a', 5), unlock('b', 1)])).toEqual(['a:AVAILABLE', 'b:REVERSED']);
    expect(run(2, [unlock('a', 5), unlock('b', 1)])).toEqual(['a:REVERSED', 'b:REVERSED']);
  });

  it('never voids a redeemed row, voiding an unredeemed one instead', () => {
    expect(run(3, [unlock('a', 5), unlock('b', 1, { redeemed: true })])).toEqual([
      'a:REVERSED',
      'b:REDEEMED',
    ]);
  });

  it('shows expired rewards as EXPIRED but still counts them as earned', () => {
    const rows = [unlock('a', 10, { expiresAt: new Date(now.getTime() - day) }), unlock('b', 1)];
    expect(run(6, rows)).toEqual(['a:EXPIRED', 'b:AVAILABLE']);
    // Expiry boundary: expiring exactly now is expired.
    expect(run(3, [unlock('a', 1, { expiresAt: now })])).toEqual(['a:EXPIRED']);
    expect(run(3, [unlock('a', 1, { expiresAt: new Date(now.getTime() + 1) })])).toEqual([
      'a:AVAILABLE',
    ]);
  });

  it('resurrects a voided row when the card is completed again (no duplicate reward)', () => {
    const rows = [unlock('a', 5)];
    expect(run(3, rows)).toEqual(['a:AVAILABLE']);
    expect(run(2, rows)).toEqual(['a:REVERSED']);
    expect(run(3, rows)).toEqual(['a:AVAILABLE']); // same ledger state -> same answer
  });

  it('is deterministic regardless of input order and ties', () => {
    const a = unlock('a', 3);
    const b = unlock('b', 3);
    expect(
      states(deriveRewards({ effectiveStamps: 3, required: 3, unlocks: [b, a], now })),
    ).toEqual(states(deriveRewards({ effectiveStamps: 3, required: 3, unlocks: [a, b], now })));
  });

  it('keeps over-redeemed data visible rather than hiding it', () => {
    expect(run(0, [unlock('a', 1, { redeemed: true })])).toEqual(['a:REDEEMED']);
  });
});

describe('needsNewUnlock', () => {
  it('creates a row only when entitlement outgrows the existing rows', () => {
    expect(needsNewUnlock(3, 3, 0)).toBe(true);
    expect(needsNewUnlock(3, 3, 1)).toBe(false);
    expect(needsNewUnlock(4, 3, 1)).toBe(false);
    expect(needsNewUnlock(6, 3, 1)).toBe(true);
    // After a reversal and a re-earned card the old row is reused.
    expect(needsNewUnlock(3, 3, 1)).toBe(false);
  });
});

describe('canReverseStamp', () => {
  it('allows reversal while redemptions stay backed by stamps', () => {
    expect(canReverseStamp({ effectiveStamps: 5, required: 3, activeRedemptions: 1 })).toBe(true); // 4 stamps -> 1 earned
    expect(canReverseStamp({ effectiveStamps: 3, required: 3, activeRedemptions: 0 })).toBe(true);
  });
  it('refuses when a redeemed reward would lose its stamps', () => {
    expect(canReverseStamp({ effectiveStamps: 3, required: 3, activeRedemptions: 1 })).toBe(false);
    expect(canReverseStamp({ effectiveStamps: 6, required: 3, activeRedemptions: 2 })).toBe(false);
  });
});

describe('simulated ledgers stay consistent', () => {
  /** Replays random stamp/reversal/redeem sequences and checks the invariants after every step. */
  it('never exceeds entitlement and never loses a redeemed reward', () => {
    let seed = 12345;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let run = 0; run < 200; run++) {
      const required = 1 + rand(5);
      let stamps = 0; // effective
      const rows: UnlockInput[] = [];
      let tick = 0;
      for (let step = 0; step < 60; step++) {
        const op = rand(4);
        if (op <= 1) {
          stamps++;
          if (needsNewUnlock(stamps, required, rows.length)) {
            rows.push({
              id: `u${rows.length}`,
              unlockedAt: new Date(now.getTime() + ++tick),
              expiresAt: null,
              redeemed: false,
            });
          }
        } else if (op === 2 && stamps > 0) {
          const active = rows.filter((r) => r.redeemed).length;
          if (canReverseStamp({ effectiveStamps: stamps, required, activeRedemptions: active }))
            stamps--;
        } else if (op === 3) {
          const derived = deriveRewards({ effectiveStamps: stamps, required, unlocks: rows, now });
          const avail = derived.find((d) => d.state === 'AVAILABLE');
          if (avail) rows.find((r) => r.id === avail.id)!.redeemed = true;
        }
        const derived = deriveRewards({ effectiveStamps: stamps, required, unlocks: rows, now });
        const count = (s: string) => derived.filter((d) => d.state === s).length;
        const earned = rewardsEarned(stamps, required);
        expect(count('REDEEMED')).toBeLessThanOrEqual(earned);
        expect(count('REDEEMED') + count('AVAILABLE') + count('EXPIRED')).toBe(earned);
        expect(rows.length).toBeGreaterThanOrEqual(earned);
      }
    }
  });
});

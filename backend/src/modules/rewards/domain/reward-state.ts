export type RewardState = 'AVAILABLE' | 'REDEEMED' | 'EXPIRED' | 'REVERSED';

export interface UnlockInput {
  id: string;
  unlockedAt: Date;
  expiresAt: Date | null;
  /** A redemption exists that has not been reversed. */
  redeemed: boolean;
}

export interface DerivedReward {
  id: string;
  state: RewardState;
}

/** Rewards earned so far: one per completed card, counting only effective (non-reversed) stamps. */
export function rewardsEarned(effectiveStamps: number, required: number): number {
  if (!Number.isInteger(required) || required < 1)
    throw new Error('required must be a positive integer');
  return Math.floor(Math.max(0, effectiveStamps) / required);
}

/**
 * Deterministic state of every unlock row for one membership.
 *
 * Unlock rows are an append-only history; what the customer is actually entitled to is derived from
 * the ledger: `earned = floor(effective stamps / required)`. Rows are then classified in order:
 *
 *  1. Rows with an active redemption are REDEEMED (they stay that way).
 *  2. The remaining entitlement (`earned - redeemed`) is given to the EARLIEST unredeemed rows, which are
 *     AVAILABLE, or EXPIRED once their expiry has passed.
 *  3. Any further rows are REVERSED: a stamp reversal took the stamps that backed them away.
 *
 * Because the result depends only on (stamps, rows, redemptions, time), replaying the ledger always
 * gives the same answer, and reversing then re-earning a card never yields extra rewards.
 */
export function deriveRewards(input: {
  effectiveStamps: number;
  required: number;
  unlocks: UnlockInput[];
  now: Date;
}): DerivedReward[] {
  const ordered = [...input.unlocks].sort(
    (a, b) => a.unlockedAt.getTime() - b.unlockedAt.getTime() || a.id.localeCompare(b.id),
  );
  const earned = rewardsEarned(input.effectiveStamps, input.required);
  const redeemed = ordered.filter((u) => u.redeemed).length;
  let slots = Math.max(0, earned - redeemed);

  return ordered.map((u) => {
    if (u.redeemed) return { id: u.id, state: 'REDEEMED' as const };
    if (slots > 0) {
      slots--;
      const expired = u.expiresAt !== null && u.expiresAt.getTime() <= input.now.getTime();
      return { id: u.id, state: expired ? ('EXPIRED' as const) : ('AVAILABLE' as const) };
    }
    return { id: u.id, state: 'REVERSED' as const };
  });
}

/** A new unlock row is needed only when entitlement exceeds the rows that already exist. */
export function needsNewUnlock(
  effectiveStamps: number,
  required: number,
  existingRows: number,
): boolean {
  return rewardsEarned(effectiveStamps, required) > existingRows;
}

/**
 * May a stamp be reversed? Removing one effective stamp must not leave more rewards redeemed than earned;
 * otherwise a reward already handed over would no longer be backed by stamps. The manager must reverse
 * the redemption first.
 */
export function canReverseStamp(input: {
  effectiveStamps: number;
  required: number;
  activeRedemptions: number;
}): boolean {
  return input.activeRedemptions <= rewardsEarned(input.effectiveStamps - 1, input.required);
}

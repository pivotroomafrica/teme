import { Injectable } from '@nestjs/common';
import type { DbClient } from '../../../database/db-client';
import { RewardState, deriveRewards, needsNewUnlock } from '../domain/reward-state';
import { RewardsRepository, UnlockRow } from '../infrastructure/rewards.repository';

export interface RewardView {
  id: string;
  state: RewardState;
  unlockedAt: Date;
  expiresAt: Date | null;
  nameEn: string;
  nameAm: string | null;
  descriptionEn: string | null;
  descriptionAm: string | null;
  /** Number of redemptions ever made (including reversed ones): the next attempt number is this + 1. */
  redemptionAttempts: number;
  /** The active (non-reversed) redemption, if any. */
  redemption: { id: string; occurredAt: Date } | null;
}

export interface RewardSummary {
  rewards: RewardView[];
  available: RewardView[];
  /** Redemptions currently standing (not reversed). */
  activeRedemptions: number;
}

@Injectable()
export class RewardsService {
  constructor(private readonly repository: RewardsRepository) {}

  /**
   * Every reward of one membership with its derived state. `effectiveStamps` comes from the stamp
   * ledger (the caller owns that module), so this module has no dependency on it.
   */
  async summarize(
    input: {
      merchantId: string;
      membershipId: string;
      effectiveStamps: number;
      required: number;
      now: Date;
    },
    db?: DbClient,
  ): Promise<RewardSummary> {
    const rows = await this.repository.listForMembership(input.merchantId, input.membershipId, db);
    const derived = deriveRewards({
      effectiveStamps: input.effectiveStamps,
      required: input.required,
      now: input.now,
      unlocks: rows.map((r) => ({
        id: r.id,
        unlockedAt: r.unlockedAt,
        expiresAt: r.expiresAt,
        redeemed: r.redemptions.some((x) => !x.reversed),
      })),
    });
    const state = new Map(derived.map((d) => [d.id, d.state]));
    const rewards = rows.map((r) => this.toView(r, state.get(r.id) as RewardState));
    return {
      rewards,
      available: rewards.filter((r) => r.state === 'AVAILABLE'),
      activeRedemptions: rewards.filter((r) => r.redemption !== null).length,
    };
  }

  /**
   * Called right after a stamp is inserted (membership already locked). Appends an unlock row only when
   * the customer has earned more rewards than rows exist, so reversing a stamp and re-earning the card
   * can never create a second reward. Returns the created row, if any.
   */
  async syncAfterStamp(
    input: {
      merchantId: string;
      programId: string;
      membershipId: string;
      effectiveStamps: number;
      required: number;
      triggeringStampId: string;
      now: Date;
      reward: { id: string; validForDays: number | null } | null;
    },
    db: DbClient,
  ): Promise<{ id: string; expiresAt: Date | null } | null> {
    if (!input.reward) return null;
    const rows = await this.repository.listForMembership(input.merchantId, input.membershipId, db);
    if (!needsNewUnlock(input.effectiveStamps, input.required, rows.length)) return null;

    const expiresAt = input.reward.validForDays
      ? new Date(input.now.getTime() + input.reward.validForDays * 86_400_000)
      : null;
    const created = await this.repository.createUnlock(
      {
        merchantId: input.merchantId,
        programId: input.programId,
        membershipId: input.membershipId,
        rewardDefinitionId: input.reward.id,
        triggeringStampId: input.triggeringStampId,
        unlockedAt: input.now,
        expiresAt,
      },
      db,
    );
    return { id: created.id, expiresAt };
  }

  private toView(r: UnlockRow, state: RewardState): RewardView {
    const active = r.redemptions.find((x) => !x.reversed) ?? null;
    return {
      id: r.id,
      state,
      unlockedAt: r.unlockedAt,
      expiresAt: r.expiresAt,
      nameEn: r.reward.nameEn,
      nameAm: r.reward.nameAm,
      descriptionEn: r.reward.descriptionEn,
      descriptionAm: r.reward.descriptionAm,
      redemptionAttempts: r.redemptions.length,
      redemption: active ? { id: active.id, occurredAt: active.occurredAt } : null,
    };
  }
}

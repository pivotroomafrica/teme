import { Injectable } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { ProgramsRepository } from '../../loyalty-programs';
import { MembershipsRepository } from '../../memberships';
import { RewardView, RewardsService } from '../../rewards';
import { Progress, StampsRepository, progressFor } from '../../stamps';
import type { MerchantActor } from '../../tenancy';
import { RedemptionsRepository } from '../infrastructure/redemptions.repository';

export const LEDGER_LIMIT_PER_TYPE = 200;

export interface MembershipSummary {
  membershipId: string;
  status: string;
  effectiveStamps: number;
  progress: Progress;
  rewards: RewardView[];
}

export interface LedgerEntry {
  type: 'STAMP' | 'REDEMPTION' | 'REVERSAL';
  id: string;
  occurredAt: Date;
  branchId?: string;
  staffMembershipId: string;
  /** STAMP / REDEMPTION: a compensating reversal exists. */
  reversed?: boolean;
  /** REDEMPTION: the reward unlock it consumed. */
  rewardUnlockId?: string;
  /** REVERSAL: what it reversed and why. */
  reversal?: { targetType: 'STAMP' | 'REDEMPTION'; targetId: string; reason: string };
}

@Injectable()
export class MembershipLedgerService {
  constructor(
    private readonly memberships: MembershipsRepository,
    private readonly programs: ProgramsRepository,
    private readonly stamps: StampsRepository,
    private readonly redemptions: RedemptionsRepository,
    private readonly rewards: RewardsService,
  ) {}

  /** Progress and the state of every reward, derived from the ledger. */
  async summary(actor: MerchantActor, membershipId: string): Promise<MembershipSummary> {
    const membership = await this.memberships.findById(actor.merchantId, membershipId);
    if (!membership) throw new DomainError(ErrorCode.NOT_FOUND, 'Membership not found.', 404);
    const program = await this.programs.findById(actor.merchantId, membership.programId);
    if (!program) throw new DomainError(ErrorCode.NOT_FOUND, 'Membership not found.', 404);

    const now = await this.stamps.dbNow();
    const effectiveStamps = await this.stamps.countEffective(actor.merchantId, membershipId);
    const { rewards } = await this.rewards.summarize({
      merchantId: actor.merchantId,
      membershipId,
      effectiveStamps,
      required: program.stampsRequired,
      now,
    });
    return {
      membershipId,
      status: membership.status,
      effectiveStamps,
      progress: progressFor(effectiveStamps, program.stampsRequired),
      rewards,
    };
  }

  /**
   * The raw ledger, newest first: stamps, redemptions and reversals (with reasons). Capped per type,
   * so a very long history is truncated rather than unbounded.
   */
  async ledger(
    actor: MerchantActor,
    membershipId: string,
  ): Promise<{ summary: MembershipSummary; entries: LedgerEntry[] }> {
    const summary = await this.summary(actor, membershipId);
    const [stamps, redemptions, reversals] = await Promise.all([
      this.stamps.listForMembership(actor.merchantId, membershipId, LEDGER_LIMIT_PER_TYPE),
      this.redemptions.listRedemptions(actor.merchantId, membershipId, LEDGER_LIMIT_PER_TYPE),
      this.redemptions.listReversals(actor.merchantId, membershipId, LEDGER_LIMIT_PER_TYPE),
    ]);
    const entries: LedgerEntry[] = [
      ...stamps.map((s) => ({
        type: 'STAMP' as const,
        id: s.id,
        occurredAt: s.occurredAt,
        branchId: s.branchId,
        staffMembershipId: s.staffMembershipId,
        reversed: s.reversed,
      })),
      ...redemptions.map((r) => ({
        type: 'REDEMPTION' as const,
        id: r.id,
        occurredAt: r.occurredAt,
        branchId: r.branchId,
        staffMembershipId: r.staffMembershipId,
        reversed: r.reversed,
        rewardUnlockId: r.rewardUnlockId,
      })),
      ...reversals.map((r) => ({
        type: 'REVERSAL' as const,
        id: r.id,
        occurredAt: r.occurredAt,
        staffMembershipId: r.reversedByStaffId,
        reversal: { targetType: r.targetType, targetId: r.targetId, reason: r.reason },
      })),
    ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id.localeCompare(a.id));
    return { summary, entries };
  }
}

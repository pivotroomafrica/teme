import { Injectable } from '@nestjs/common';
import { retryOnUniqueViolation } from '../../../common/db/retry-on-unique';
import type { RequestMeta } from '../../../common/decorators/request-context.decorator';
import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import type { DbClient } from '../../../database/db-client';
import { TransactionManager } from '../../../database/transaction-manager';
import { AuditService } from '../../audit';
import { CustomersRepository } from '../../customers';
import {
  IdempotencyService,
  OutboxJobType,
  OutboxService,
  isValidIdempotencyKey,
  requestFingerprint,
} from '../../jobs';
import { ProgramRecord, ProgramsRepository } from '../../loyalty-programs';
import { MembershipsRepository, hashCardToken } from '../../memberships';
import { RewardSummary, RewardView, RewardsService } from '../../rewards';
import {
  CardAccessService,
  MESSAGES,
  Progress,
  RejectionReason,
  StampsRepository,
  progressFor,
} from '../../stamps';
import type { MerchantActor } from '../../tenancy';
import { RedemptionsRepository } from '../infrastructure/redemptions.repository';

export const OPERATION_REDEEM = 'reward.redeem';

export interface RedeemLookupInput {
  cardToken: string;
  branchId?: string;
}

export interface RedeemInput extends RedeemLookupInput {
  rewardUnlockId?: string;
  device?: { platform?: string; appVersion?: string; deviceId?: string };
}

export interface PublicReward {
  unlockId: string;
  nameEn: string;
  nameAm: string | null;
  descriptionEn: string | null;
  descriptionAm: string | null;
  unlockedAt: string;
  expiresAt: string | null;
}

export interface RedeemResult {
  outcome: 'AVAILABLE' | 'REDEEMED' | 'REJECTED';
  reason: RejectionReason | null;
  message: { en: string; am: string };
  customer?: { firstName: string | null };
  /** Lookup: every reward that can be redeemed right now (soonest-expiring first). */
  rewards?: PublicReward[];
  /** Redeem: the reward handed over. */
  reward?: PublicReward;
  redemption?: { id: string; occurredAt: string };
  progress?: Progress & { rewardsAvailable: number };
  replayed: boolean;
}

type Stored = Omit<RedeemResult, 'replayed'>;

const toPublic = (r: RewardView): PublicReward => ({
  unlockId: r.id,
  nameEn: r.nameEn,
  nameAm: r.nameAm,
  descriptionEn: r.descriptionEn,
  descriptionAm: r.descriptionAm,
  unlockedAt: r.unlockedAt.toISOString(),
  expiresAt: r.expiresAt?.toISOString() ?? null,
});

/** Soonest-expiring first so a reward is never left to lapse while a later one is used. */
const byExpiry = (a: RewardView, b: RewardView) =>
  (a.expiresAt?.getTime() ?? Infinity) - (b.expiresAt?.getTime() ?? Infinity) ||
  a.unlockedAt.getTime() - b.unlockedAt.getTime();

function rejected(reason: RejectionReason, extra: Partial<Stored> = {}): Stored {
  return { outcome: 'REJECTED', reason, message: MESSAGES[reason], ...extra };
}

@Injectable()
export class RedemptionService {
  constructor(
    private readonly access: CardAccessService,
    private readonly stamps: StampsRepository,
    private readonly rewards: RewardsService,
    private readonly programs: ProgramsRepository,
    private readonly customers: CustomersRepository,
    private readonly memberships: MembershipsRepository,
    private readonly redemptions: RedemptionsRepository,
    private readonly idempotency: IdempotencyService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly transactions: TransactionManager,
  ) {}

  /** Read-only: which rewards could be redeemed for this card right now. */
  async lookup(actor: MerchantActor, input: RedeemLookupInput): Promise<RedeemResult> {
    const branchId = this.access.resolveBranchId(actor, input.branchId);
    const ctx = await this.context(actor, input.cardToken, branchId, undefined);
    if (!ctx.ok) return { ...ctx.result, replayed: false };

    const available = [...ctx.summary.available].sort(byExpiry);
    if (available.length === 0) {
      return { ...(await this.noReward(ctx, 'NO_REWARD_AVAILABLE')), replayed: false };
    }
    return {
      outcome: 'AVAILABLE',
      reason: null,
      message: MESSAGES.ELIGIBLE,
      customer: { firstName: ctx.firstName },
      rewards: available.map(toPublic),
      progress: this.progress(ctx),
      replayed: false,
    };
  }

  /**
   * Hands over one reward, once. Runs in one transaction under the membership lock; the unique index
   * (reward_unlock_id, attempt_number) is the database-level guarantee that two devices can never
   * redeem the same reward at the same time. Requires an Idempotency-Key.
   */
  async redeem(
    actor: MerchantActor,
    input: RedeemInput,
    idempotencyKey: string | undefined,
    meta: RequestMeta,
  ): Promise<RedeemResult> {
    if (!isValidIdempotencyKey(idempotencyKey)) {
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        'A valid Idempotency-Key header is required (8-128 URL-safe characters).',
        400,
      );
    }
    const branchId = this.access.resolveBranchId(actor, input.branchId);
    const fingerprint = requestFingerprint(
      OPERATION_REDEEM,
      hashCardToken(input.cardToken),
      branchId,
      input.rewardUnlockId ?? '',
    );
    return retryOnUniqueViolation(() =>
      this.transactions.run((db) =>
        this.redeemInTransaction(actor, input, branchId, idempotencyKey, fingerprint, meta, db),
      ),
    );
  }

  private async redeemInTransaction(
    actor: MerchantActor,
    input: RedeemInput,
    branchId: string,
    key: string,
    fingerprint: string,
    meta: RequestMeta,
    db: DbClient,
  ): Promise<RedeemResult> {
    const replay = async (): Promise<RedeemResult | null> => {
      const stored = await this.idempotency.find(
        actor.staffMembershipId,
        OPERATION_REDEEM,
        key,
        fingerprint,
        db,
      );
      return stored ? { ...(stored as Stored), replayed: true } : null;
    };
    const early = await replay();
    if (early) return early;

    const ctx = await this.context(actor, input.cardToken, branchId, db);
    const late = await replay();
    if (late) return late;

    const remember = (response: Stored, membershipId: string | null) =>
      this.idempotency.remember(
        {
          merchantId: actor.merchantId,
          staffMembershipId: actor.staffMembershipId,
          operation: OPERATION_REDEEM,
          key,
          fingerprint,
          response,
          membershipId,
        },
        db,
      );
    const reject = async (
      result: Stored,
      branch: string | null,
      membershipId: string | null,
    ): Promise<RedeemResult> => {
      await this.audit.record(
        {
          action: 'redemption.rejected',
          actorUserId: actor.userId,
          merchantId: actor.merchantId,
          branchId: branch ?? undefined,
          targetType: membershipId ? 'membership' : undefined,
          targetId: membershipId ?? undefined,
          requestId: meta.requestId,
          metadata: { reason: result.reason },
        },
        db,
      );
      await remember(result, membershipId);
      return { ...result, replayed: false };
    };

    if (!ctx.ok) return reject(ctx.result, ctx.branchId, ctx.membershipId);

    // Which reward? An explicit id must be AVAILABLE; otherwise the soonest-expiring available one.
    const available = [...ctx.summary.available].sort(byExpiry);
    let target: RewardView | undefined;
    if (input.rewardUnlockId) {
      target = available.find((r) => r.id === input.rewardUnlockId);
      if (!target) {
        return reject(
          await this.noReward(ctx, 'REWARD_NOT_AVAILABLE'),
          ctx.branchId,
          ctx.membership.id,
        );
      }
    } else {
      target = available[0];
      if (!target) {
        return reject(
          await this.noReward(ctx, 'NO_REWARD_AVAILABLE'),
          ctx.branchId,
          ctx.membership.id,
        );
      }
    }

    const redemption = await this.redemptions.createRedemption(
      {
        merchantId: actor.merchantId,
        branchId,
        membershipId: ctx.membership.id,
        rewardUnlockId: target.id,
        staffMembershipId: actor.staffMembershipId,
        attemptNumber: target.redemptionAttempts + 1,
        idempotencyKey: key,
        deviceMetadata: this.safeDevice(input.device),
        occurredAt: ctx.now,
      },
      db,
    );

    await this.memberships.markPassesStale(actor.merchantId, ctx.membership.id, db);
    await this.outbox.enqueue(
      {
        merchantId: actor.merchantId,
        type: OutboxJobType.WALLET_PASS_UPDATE,
        aggregateType: 'membership',
        aggregateId: ctx.membership.id,
        payload: { reason: 'reward_redeemed', redemptionId: redemption.id },
      },
      db,
    );
    await this.audit.record(
      {
        action: 'reward.redeemed',
        actorUserId: actor.userId,
        merchantId: actor.merchantId,
        branchId,
        targetType: 'redemption_event',
        targetId: redemption.id,
        requestId: meta.requestId,
        metadata: { membershipId: ctx.membership.id, rewardUnlockId: target.id },
      },
      db,
    );

    const after = await this.rewards.summarize(
      {
        merchantId: actor.merchantId,
        membershipId: ctx.membership.id,
        effectiveStamps: ctx.effectiveStamps,
        required: ctx.program.stampsRequired,
        now: ctx.now,
      },
      db,
    );
    const body: Stored = {
      outcome: 'REDEEMED',
      reason: null,
      message: MESSAGES.REWARD_REDEEMED,
      customer: { firstName: ctx.firstName },
      reward: toPublic(target),
      redemption: { id: redemption.id, occurredAt: redemption.occurredAt.toISOString() },
      progress: {
        ...progressFor(ctx.effectiveStamps, ctx.program.stampsRequired),
        rewardsAvailable: after.available.length,
      },
    };
    await remember(body, ctx.membership.id);
    return { ...body, replayed: false };
  }

  /**
   * Card, branch and membership checks plus the current ledger-derived reward state. Redemption is
   * deliberately allowed while the program is paused or archived: a reward that was earned must be
   * honoured. (Stamping, by contrast, requires an ACTIVE program.)
   */
  private async context(
    actor: MerchantActor,
    cardToken: string,
    branchId: string,
    db: DbClient | undefined,
  ): Promise<
    | { ok: false; result: Stored; branchId: string | null; membershipId: string | null }
    | {
        ok: true;
        branchId: string;
        membership: { id: string; customerId: string };
        program: ProgramRecord;
        firstName: string | null;
        now: Date;
        effectiveStamps: number;
        summary: RewardSummary;
      }
  > {
    const access = await this.access.resolve(actor, cardToken, branchId, db);
    if (!access.ok) {
      return {
        ok: false,
        result: rejected(access.reason),
        branchId: access.branchId,
        membershipId: access.membershipId,
      };
    }
    const { membership } = access;
    const program = await this.programs.findById(actor.merchantId, membership.programId, db);
    if (!program) {
      return {
        ok: false,
        result: rejected('INVALID_TOKEN'),
        branchId: access.branchId,
        membershipId: membership.id,
      };
    }
    const now = await this.stamps.dbNow(db);
    const effectiveStamps = await this.stamps.countEffective(actor.merchantId, membership.id, db);
    const summary = await this.rewards.summarize(
      {
        merchantId: actor.merchantId,
        membershipId: membership.id,
        effectiveStamps,
        required: program.stampsRequired,
        now,
      },
      db,
    );
    return {
      ok: true,
      branchId: access.branchId,
      membership,
      program,
      firstName: await this.customers.findFirstName(actor.merchantId, membership.customerId, db),
      now,
      effectiveStamps,
      summary,
    };
  }

  private progress(ctx: {
    program: ProgramRecord;
    effectiveStamps: number;
    summary: RewardSummary;
  }) {
    return {
      ...progressFor(ctx.effectiveStamps, ctx.program.stampsRequired),
      rewardsAvailable: ctx.summary.available.length,
    };
  }

  private async noReward(
    ctx: {
      firstName: string | null;
      program: ProgramRecord;
      effectiveStamps: number;
      summary: RewardSummary;
    },
    reason: 'NO_REWARD_AVAILABLE' | 'REWARD_NOT_AVAILABLE',
  ): Promise<Stored> {
    return rejected(reason, {
      customer: { firstName: ctx.firstName },
      progress: this.progress(ctx),
    });
  }

  private safeDevice(device: RedeemInput['device']): Record<string, unknown> | undefined {
    if (!device) return undefined;
    const out: Record<string, unknown> = {};
    if (device.platform) out.platform = device.platform;
    if (device.appVersion) out.appVersion = device.appVersion;
    if (device.deviceId) out.deviceId = device.deviceId;
    return Object.keys(out).length > 0 ? out : undefined;
  }
}

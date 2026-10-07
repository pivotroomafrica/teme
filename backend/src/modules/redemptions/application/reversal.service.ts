import { Injectable } from '@nestjs/common';
import { retryOnUniqueViolation } from '../../../common/db/retry-on-unique';
import type { RequestMeta } from '../../../common/decorators/request-context.decorator';
import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import type { DbClient } from '../../../database/db-client';
import { TransactionManager } from '../../../database/transaction-manager';
import { AuditService } from '../../audit';
import {
  IdempotencyService,
  OutboxJobType,
  OutboxService,
  isValidIdempotencyKey,
  requestFingerprint,
} from '../../jobs';
import { ProgramsRepository } from '../../loyalty-programs';
import { MembershipsRepository } from '../../memberships';
import { RewardsService, canReverseStamp } from '../../rewards';
import { Progress, StampsRepository, progressFor } from '../../stamps';
import type { MerchantActor } from '../../tenancy';
import { cleanReason } from '../domain/reversal-reason';
import { RedemptionsRepository } from '../infrastructure/redemptions.repository';

export const OPERATION_REVERSE_STAMP = 'stamp.reverse';
export const OPERATION_REVERSE_REDEMPTION = 'redemption.reverse';

export interface ReversalResult {
  reversalId: string;
  target: 'STAMP' | 'REDEMPTION';
  targetId: string;
  occurredAt: string;
  /** Progress and rewards AFTER the compensating event. */
  progress: Progress & { rewardsAvailable: number };
  replayed: boolean;
}

type Stored = Omit<ReversalResult, 'replayed'>;

const notFound = (what: string) => new DomainError(ErrorCode.NOT_FOUND, `${what} not found.`, 404);
const conflict = (code: string, message: string) => new DomainError(code, message, 409);
const validation = (message: string) => new DomainError(ErrorCode.VALIDATION_FAILED, message, 400);

/**
 * Compensating events. A reversal never changes the original stamp or redemption: it appends a
 * `reversal_events` row that points at it, and all balances are re-derived from the ledger.
 * Only users holding `reversal:create` (owners and authorised managers) may call these.
 */
@Injectable()
export class ReversalService {
  constructor(
    private readonly stamps: StampsRepository,
    private readonly redemptions: RedemptionsRepository,
    private readonly memberships: MembershipsRepository,
    private readonly programs: ProgramsRepository,
    private readonly rewards: RewardsService,
    private readonly idempotency: IdempotencyService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly transactions: TransactionManager,
  ) {}

  reverseStamp(
    actor: MerchantActor,
    stampId: string,
    rawReason: unknown,
    key: string | undefined,
    meta: RequestMeta,
  ): Promise<ReversalResult> {
    const { reason, idempotencyKey } = this.prepare(rawReason, key);
    const fingerprint = requestFingerprint(OPERATION_REVERSE_STAMP, stampId);

    return retryOnUniqueViolation(() =>
      this.transactions.run((db) =>
        this.run(
          actor,
          OPERATION_REVERSE_STAMP,
          idempotencyKey,
          fingerprint,
          db,
          async () => {
            const stamp = await this.stamps.findById(actor.merchantId, stampId, db);
            if (!stamp) throw notFound('Stamp');
            // Serialise with scans, redemptions and other reversals of this card.
            await this.memberships.lockById(actor.merchantId, stamp.membershipId, db);
            return {
              membershipId: stamp.membershipId,
              programId: stamp.programId,
              branchId: stamp.branchId,
            };
          },
          async (ctx) => {
            // Re-read under the lock: another manager may have reversed it meanwhile.
            const fresh = await this.stamps.findById(actor.merchantId, stampId, db);
            if (!fresh) throw notFound('Stamp');
            if (fresh.reversed)
              throw conflict('ALREADY_REVERSED', 'This stamp has already been reversed.');

            const state = await this.state(actor.merchantId, ctx.membershipId, ctx.programId, db);
            if (
              !canReverseStamp({
                effectiveStamps: state.effectiveStamps,
                required: state.required,
                activeRedemptions: state.summary.activeRedemptions,
              })
            ) {
              throw conflict(
                'REWARD_ALREADY_REDEEMED',
                'Reversing this stamp would leave a redeemed reward without stamps behind it. Reverse the redemption first.',
              );
            }
            const created = await this.redemptions.createReversal(
              {
                merchantId: actor.merchantId,
                membershipId: ctx.membershipId,
                targetType: 'STAMP',
                stampEventId: stampId,
                reversedByStaffId: actor.staffMembershipId,
                reason,
                idempotencyKey,
              },
              db,
            );
            await this.finish(
              actor,
              ctx,
              'stamp_reversed',
              'stamp.reversed',
              created.id,
              stampId,
              meta,
              db,
            );
            return {
              id: created.id,
              occurredAt: created.occurredAt,
              target: 'STAMP' as const,
              targetId: stampId,
            };
          },
          meta,
        ),
      ),
    );
  }

  reverseRedemption(
    actor: MerchantActor,
    redemptionId: string,
    rawReason: unknown,
    key: string | undefined,
    meta: RequestMeta,
  ): Promise<ReversalResult> {
    const { reason, idempotencyKey } = this.prepare(rawReason, key);
    const fingerprint = requestFingerprint(OPERATION_REVERSE_REDEMPTION, redemptionId);

    return retryOnUniqueViolation(() =>
      this.transactions.run((db) =>
        this.run(
          actor,
          OPERATION_REVERSE_REDEMPTION,
          idempotencyKey,
          fingerprint,
          db,
          async () => {
            const redemption = await this.redemptions.findRedemption(
              actor.merchantId,
              redemptionId,
              db,
            );
            if (!redemption) throw notFound('Redemption');
            const membership = await this.memberships.lockById(
              actor.merchantId,
              redemption.membershipId,
              db,
            );
            if (!membership) throw notFound('Redemption');
            return { membershipId: membership.id, programId: membership.programId, branchId: null };
          },
          async (ctx) => {
            const fresh = await this.redemptions.findRedemption(actor.merchantId, redemptionId, db);
            if (!fresh) throw notFound('Redemption');
            if (fresh.reversed)
              throw conflict('ALREADY_REVERSED', 'This redemption has already been reversed.');

            const created = await this.redemptions.createReversal(
              {
                merchantId: actor.merchantId,
                membershipId: ctx.membershipId,
                targetType: 'REDEMPTION',
                redemptionEventId: redemptionId,
                reversedByStaffId: actor.staffMembershipId,
                reason,
                idempotencyKey,
              },
              db,
            );
            await this.finish(
              actor,
              ctx,
              'redemption_reversed',
              'redemption.reversed',
              created.id,
              redemptionId,
              meta,
              db,
            );
            return {
              id: created.id,
              occurredAt: created.occurredAt,
              target: 'REDEMPTION' as const,
              targetId: redemptionId,
            };
          },
          meta,
        ),
      ),
    );
  }

  private prepare(rawReason: unknown, key: string | undefined) {
    if (!isValidIdempotencyKey(key)) {
      throw validation('A valid Idempotency-Key header is required (8-128 URL-safe characters).');
    }
    const cleaned = cleanReason(rawReason);
    if (!cleaned.ok) throw validation(cleaned.error);
    return { reason: cleaned.reason, idempotencyKey: key };
  }

  /**
   * The shared skeleton: look for a stored answer, run `lock` (finds the target and locks the card),
   * look again, run `apply`, then store the answer. Anything thrown rolls the whole transaction back.
   */
  private async run(
    actor: MerchantActor,
    operation: string,
    key: string,
    fingerprint: string,
    db: DbClient,
    lock: () => Promise<{ membershipId: string; programId: string; branchId: string | null }>,
    apply: (ctx: { membershipId: string; programId: string; branchId: string | null }) => Promise<{
      id: string;
      occurredAt: Date;
      target: 'STAMP' | 'REDEMPTION';
      targetId: string;
    }>,
    _meta: RequestMeta,
  ): Promise<ReversalResult> {
    const replay = async (): Promise<ReversalResult | null> => {
      const stored = await this.idempotency.find(
        actor.staffMembershipId,
        operation,
        key,
        fingerprint,
        db,
      );
      return stored ? { ...(stored as Stored), replayed: true } : null;
    };
    const early = await replay();
    if (early) return early;

    const ctx = await lock();
    const late = await replay();
    if (late) return late;

    const done = await apply(ctx);
    const state = await this.state(actor.merchantId, ctx.membershipId, ctx.programId, db);
    const body: Stored = {
      reversalId: done.id,
      target: done.target,
      targetId: done.targetId,
      occurredAt: done.occurredAt.toISOString(),
      progress: {
        ...progressFor(state.effectiveStamps, state.required),
        rewardsAvailable: state.summary.available.length,
      },
    };
    await this.idempotency.remember(
      {
        merchantId: actor.merchantId,
        staffMembershipId: actor.staffMembershipId,
        operation,
        key,
        fingerprint,
        response: body,
        membershipId: ctx.membershipId,
      },
      db,
    );
    return { ...body, replayed: false };
  }

  /** Wallet refresh + audit, in the reversal's transaction. The free-text reason is not audited. */
  private async finish(
    actor: MerchantActor,
    ctx: { membershipId: string; branchId: string | null },
    walletReason: string,
    auditAction: string,
    reversalId: string,
    targetId: string,
    meta: RequestMeta,
    db: DbClient,
  ): Promise<void> {
    await this.memberships.markPassesStale(actor.merchantId, ctx.membershipId, db);
    await this.outbox.enqueue(
      {
        merchantId: actor.merchantId,
        type: OutboxJobType.WALLET_PASS_UPDATE,
        aggregateType: 'membership',
        aggregateId: ctx.membershipId,
        payload: { reason: walletReason, reversalId },
      },
      db,
    );
    await this.audit.record(
      {
        action: auditAction,
        actorUserId: actor.userId,
        merchantId: actor.merchantId,
        branchId: ctx.branchId ?? undefined,
        targetType: 'reversal_event',
        targetId: reversalId,
        requestId: meta.requestId,
        metadata: { membershipId: ctx.membershipId, reversedEventId: targetId },
      },
      db,
    );
  }

  private async state(merchantId: string, membershipId: string, programId: string, db: DbClient) {
    const program = await this.programs.findById(merchantId, programId, db);
    if (!program) throw notFound('Program');
    const now = await this.stamps.dbNow(db);
    const effectiveStamps = await this.stamps.countEffective(merchantId, membershipId, db);
    const summary = await this.rewards.summarize(
      { merchantId, membershipId, effectiveStamps, required: program.stampsRequired, now },
      db,
    );
    return { effectiveStamps, required: program.stampsRequired, summary };
  }
}

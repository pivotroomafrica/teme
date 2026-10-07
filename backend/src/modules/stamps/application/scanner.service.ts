import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RequestMeta } from '../../../common/decorators/request-context.decorator';
import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { retryOnUniqueViolation } from '../../../common/db/retry-on-unique';
import type { Env } from '../../../config/env.schema';
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
import { MembershipRecord, MembershipsRepository, hashCardToken } from '../../memberships';
import { RewardsService } from '../../rewards';
import type { MerchantActor } from '../../tenancy';
import {
  MESSAGES,
  Message,
  RejectionReason,
  cooldownRemainingSeconds,
  effectiveCooldownSeconds,
} from '../domain/scan-policy';
import { Progress, completesCard, progressFor } from '../domain/stamp-progress';
import { StampsRepository } from '../infrastructure/stamps.repository';
import { CardAccessService } from './card-access.service';

export const OPERATION_CONFIRM = 'stamp.confirm';

export interface ScanInput {
  cardToken: string;
  branchId?: string;
}

export interface ConfirmInput extends ScanInput {
  device?: { platform?: string; appVersion?: string; deviceId?: string };
}

export interface ScanResult {
  outcome: 'ELIGIBLE' | 'STAMPED' | 'REJECTED';
  reason: RejectionReason | null;
  message: Message;
  retryAfterSeconds?: number;
  customer?: { firstName: string | null };
  progress?: Progress & { rewardsAvailable: number };
  stamp?: { id: string; occurredAt: string };
  reward?: {
    unlocked: boolean;
    unlockId?: string;
    nameEn?: string;
    nameAm?: string | null;
    expiresAt?: string | null;
  };
  wouldUnlockReward?: boolean;
  /** True when this response is a stored answer to an earlier request with the same key. */
  replayed: boolean;
}

type StoredScan = Omit<ScanResult, 'replayed'>;

type Evaluation =
  | { ok: false; result: StoredScan; branchId: string | null; membershipId: string | null }
  | {
      ok: true;
      branchId: string;
      membership: MembershipRecord;
      program: ProgramRecord;
      firstName: string | null;
      now: Date;
      effectiveStamps: number;
    };

function rejection(reason: RejectionReason, extra: Partial<StoredScan> = {}): StoredScan {
  return { outcome: 'REJECTED', reason, message: MESSAGES[reason], ...extra };
}

@Injectable()
export class ScannerService {
  constructor(
    private readonly access: CardAccessService,
    private readonly memberships: MembershipsRepository,
    private readonly programs: ProgramsRepository,
    private readonly customers: CustomersRepository,
    private readonly stamps: StampsRepository,
    private readonly rewards: RewardsService,
    private readonly idempotency: IdempotencyService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly transactions: TransactionManager,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Eligibility check. Read-only: nothing is written, no lock is taken, no key is needed. The
   * answer is advisory; the confirmation re-checks everything under a lock.
   */
  async validate(actor: MerchantActor, input: ScanInput): Promise<ScanResult> {
    const branchId = this.access.resolveBranchId(actor, input.branchId);
    const ev = await this.evaluate(actor, input.cardToken, branchId, undefined);
    if (!ev.ok) return { ...ev.result, replayed: false };

    return {
      outcome: 'ELIGIBLE',
      reason: null,
      message: MESSAGES.ELIGIBLE,
      customer: { firstName: ev.firstName },
      progress: await this.progressView(
        actor.merchantId,
        ev.membership.id,
        ev.program,
        ev.effectiveStamps,
        ev.now,
      ),
      wouldUnlockReward: completesCard(ev.effectiveStamps + 1, ev.program.stampsRequired),
      replayed: false,
    };
  }

  /**
   * Awards exactly one stamp, atomically, or refuses with a safe reason.
   *
   * One transaction covers: replay lookup, the membership row lock, validation, the stamp, the reward
   * unlock, the wallet-update outbox job, the audit event and the stored idempotent response.
   * The idempotency record is looked up before anything else and again after the lock is taken,
   * so concurrent retries with one key all converge on the first request's answer.
   */
  async confirm(
    actor: MerchantActor,
    input: ConfirmInput,
    idempotencyKey: string | undefined,
    meta: RequestMeta,
  ): Promise<ScanResult> {
    if (!isValidIdempotencyKey(idempotencyKey)) {
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        'A valid Idempotency-Key header is required (8-128 URL-safe characters).',
        400,
      );
    }
    const branchId = this.access.resolveBranchId(actor, input.branchId);
    const fingerprint = requestFingerprint(
      OPERATION_CONFIRM,
      hashCardToken(input.cardToken),
      branchId,
    );

    return retryOnUniqueViolation(() =>
      this.transactions.run((db) =>
        this.confirmInTransaction(actor, input, branchId, idempotencyKey, fingerprint, meta, db),
      ),
    );
  }

  private async confirmInTransaction(
    actor: MerchantActor,
    input: ConfirmInput,
    branchId: string,
    key: string,
    fingerprint: string,
    meta: RequestMeta,
    db: DbClient,
  ): Promise<ScanResult> {
    const replay = async (): Promise<ScanResult | null> => {
      const stored = await this.idempotency.find(
        actor.staffMembershipId,
        OPERATION_CONFIRM,
        key,
        fingerprint,
        db,
      );
      return stored ? { ...(stored as StoredScan), replayed: true } : null;
    };

    const early = await replay();
    if (early) return early;

    const ev = await this.evaluate(actor, input.cardToken, branchId, db);

    // The membership lock (inside evaluate) may have waited for a concurrent request with the same
    // key to commit: look again before acting.
    const late = await replay();
    if (late) return late;

    const remember = (response: StoredScan, membershipId: string | null) =>
      this.idempotency.remember(
        {
          merchantId: actor.merchantId,
          staffMembershipId: actor.staffMembershipId,
          operation: OPERATION_CONFIRM,
          key,
          fingerprint,
          response,
          membershipId,
        },
        db,
      );

    if (!ev.ok) {
      await this.audit.record(
        {
          action: 'scan.rejected',
          actorUserId: actor.userId,
          merchantId: actor.merchantId,
          branchId: ev.branchId ?? undefined,
          targetType: ev.membershipId ? 'membership' : undefined,
          targetId: ev.membershipId ?? undefined,
          requestId: meta.requestId,
          metadata: { reason: ev.result.reason, retryAfterSeconds: ev.result.retryAfterSeconds },
        },
        db,
      );
      await remember(ev.result, ev.membershipId);
      return { ...ev.result, replayed: false };
    }

    // ── All checks passed and the membership is locked: write the ledger. ──
    const { membership, program, now } = ev;
    const stamp = await this.stamps.createStamp(
      {
        merchantId: actor.merchantId,
        branchId,
        programId: program.id,
        membershipId: membership.id,
        staffMembershipId: actor.staffMembershipId,
        idempotencyKey: key,
        deviceMetadata: this.safeDevice(input.device),
        occurredAt: now,
      },
      db,
    );

    const total = await this.stamps.countEffective(actor.merchantId, membership.id, db);
    const unlock = await this.rewards.syncAfterStamp(
      {
        merchantId: actor.merchantId,
        programId: program.id,
        membershipId: membership.id,
        effectiveStamps: total,
        required: program.stampsRequired,
        triggeringStampId: stamp.id,
        now,
        reward: program.reward,
      },
      db,
    );
    // "Unlocked" means this stamp completed a card and a reward is now backed by stamps.
    const cardCompleted = completesCard(total, program.stampsRequired) && program.reward !== null;
    const reward: NonNullable<ScanResult['reward']> = cardCompleted
      ? {
          unlocked: true,
          unlockId: unlock?.id,
          nameEn: program.reward?.nameEn,
          nameAm: program.reward?.nameAm,
          expiresAt: unlock ? (unlock.expiresAt?.toISOString() ?? null) : undefined,
        }
      : { unlocked: false };

    // Wallet cards must show the new progress: flag them stale and queue the update in this same
    // transaction. A provider failure later can never undo the stamp.
    await this.memberships.markPassesStale(actor.merchantId, membership.id, db);
    await this.outbox.enqueue(
      {
        merchantId: actor.merchantId,
        type: OutboxJobType.WALLET_PASS_UPDATE,
        aggregateType: 'membership',
        aggregateId: membership.id,
        payload: { reason: reward.unlocked ? 'reward_unlocked' : 'stamp', stampId: stamp.id },
      },
      db,
    );

    const progress = await this.progressView(
      actor.merchantId,
      membership.id,
      program,
      total,
      now,
      db,
    );
    await this.audit.record(
      {
        action: 'stamp.issued',
        actorUserId: actor.userId,
        merchantId: actor.merchantId,
        branchId,
        targetType: 'stamp_event',
        targetId: stamp.id,
        requestId: meta.requestId,
        metadata: {
          membershipId: membership.id,
          programId: program.id,
          stampsOnCard: progress.current,
          completedCards: progress.completedCards,
          rewardUnlocked: reward.unlocked,
        },
      },
      db,
    );
    if (unlock) {
      await this.audit.record(
        {
          action: 'reward.unlocked',
          actorType: 'SYSTEM',
          merchantId: actor.merchantId,
          branchId,
          targetType: 'reward_unlock',
          targetId: unlock.id,
          requestId: meta.requestId,
          metadata: { membershipId: membership.id, triggeringStampId: stamp.id },
        },
        db,
      );
    }

    const body: StoredScan = {
      outcome: 'STAMPED',
      reason: null,
      message: reward.unlocked ? MESSAGES.REWARD_UNLOCKED : MESSAGES.STAMPED,
      customer: { firstName: ev.firstName },
      stamp: { id: stamp.id, occurredAt: stamp.occurredAt.toISOString() },
      progress,
      reward,
    };
    await remember(body, membership.id);
    return { ...body, replayed: false };
  }

  /**
   * Runs the eligibility rules in the documented order. With a transaction handle the membership
   * and program rows are locked; without one this is a plain read.
   */
  private async evaluate(
    actor: MerchantActor,
    cardToken: string,
    branchId: string,
    db: DbClient | undefined,
  ): Promise<Evaluation> {
    const merchantId = actor.merchantId;

    // 2-5. Branch, card and membership.
    const access = await this.access.resolve(actor, cardToken, branchId, db);
    if (!access.ok) {
      return {
        ok: false,
        result: rejection(access.reason),
        branchId: access.branchId,
        membershipId: access.membershipId,
      };
    }
    const { membership } = access;
    const fail = (reason: RejectionReason, extra: Partial<StoredScan> = {}): Evaluation => ({
      ok: false,
      result: rejection(reason, extra),
      branchId: access.branchId,
      membershipId: membership.id,
    });

    // Program must be active. The program row is share-locked so a concurrent pause or threshold
    // change waits for this stamp (or the reverse).
    const lockedStatus = db
      ? (await this.programs.lockForEnrollment(merchantId, membership.programId, db))?.status
      : undefined;
    const program = await this.programs.findById(merchantId, membership.programId, db);
    if (!program || program.status !== 'ACTIVE' || (lockedStatus && lockedStatus !== 'ACTIVE')) {
      return fail('PROGRAM_INACTIVE');
    }

    // Cooldown, measured on the database clock against the latest stamp that still counts.
    const now = await this.stamps.dbNow(db);
    const lastAt = await this.stamps.lastEffectiveStampAt(merchantId, membership.id, db);
    const cooldown = effectiveCooldownSeconds(
      program.cooldownMinutes,
      this.config.get('SCANNER_MIN_INTERVAL_SECONDS', { infer: true }),
    );
    const wait = cooldownRemainingSeconds(lastAt, now, cooldown);
    const effectiveStamps = await this.stamps.countEffective(merchantId, membership.id, db);
    if (wait > 0) {
      return fail('COOLDOWN_ACTIVE', {
        retryAfterSeconds: wait,
        customer: {
          firstName: await this.customers.findFirstName(merchantId, membership.customerId, db),
        },
        progress: await this.progressView(
          merchantId,
          membership.id,
          program,
          effectiveStamps,
          now,
          db,
        ),
      });
    }

    return {
      ok: true,
      branchId: access.branchId,
      membership,
      program,
      firstName: await this.customers.findFirstName(merchantId, membership.customerId, db),
      now,
      effectiveStamps,
    };
  }

  private async progressView(
    merchantId: string,
    membershipId: string,
    program: ProgramRecord,
    effectiveStamps: number,
    now: Date,
    db?: DbClient,
  ): Promise<Progress & { rewardsAvailable: number }> {
    const summary = await this.rewards.summarize(
      { merchantId, membershipId, effectiveStamps, required: program.stampsRequired, now },
      db,
    );
    return {
      ...progressFor(effectiveStamps, program.stampsRequired),
      rewardsAvailable: summary.available.length,
    };
  }

  /** Only whitelisted, non-identifying device facts are kept. */
  private safeDevice(device: ConfirmInput['device']): Record<string, unknown> | undefined {
    if (!device) return undefined;
    const out: Record<string, unknown> = {};
    if (device.platform) out.platform = device.platform;
    if (device.appVersion) out.appVersion = device.appVersion;
    if (device.deviceId) out.deviceId = device.deviceId;
    return Object.keys(out).length > 0 ? out : undefined;
  }
}

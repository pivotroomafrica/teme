import { Injectable, Logger } from '@nestjs/common';
import type { RequestMeta } from '../../../common/decorators/request-context.decorator';
import { TransactionManager } from '../../../database/transaction-manager';
import { AuditService } from '../../audit';
import { MerchantDirectory } from '../../merchants';
import type { MerchantActor } from '../../tenancy';
import {
  CLEANUP,
  inactivityCutoff,
  mergeRetention,
  type RetentionPolicy,
} from '../domain/retention-policy';
import { PrivacyRepository } from '../infrastructure/privacy.repository';
import { AnonymizationService } from './anonymization.service';

/** One run handles at most this many customers per merchant; the next run continues where this stopped. */
export const RETENTION_BATCH = 200;

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly merchants: MerchantDirectory,
    private readonly repository: PrivacyRepository,
    private readonly anonymization: AnonymizationService,
    private readonly audit: AuditService,
    private readonly transactions: TransactionManager,
  ) {}

  async get(merchantId: string): Promise<RetentionPolicy> {
    return mergeRetention(await this.merchants.retentionPolicy(merchantId));
  }

  async update(
    actor: MerchantActor,
    policy: RetentionPolicy,
    meta: RequestMeta,
  ): Promise<RetentionPolicy> {
    await this.transactions.run(async (db) => {
      await this.merchants.setRetentionPolicy(
        actor.merchantId,
        { inactiveCustomerMonths: policy.inactiveCustomerMonths },
        db,
      );
      await this.audit.record(
        {
          action: 'privacy.retention_updated',
          actorUserId: actor.userId,
          merchantId: actor.merchantId,
          targetType: 'merchant',
          targetId: actor.merchantId,
          requestId: meta.requestId,
          metadata: { inactiveCustomerMonths: policy.inactiveCustomerMonths },
        },
        db,
      );
    });
    return this.get(actor.merchantId);
  }

  /**
   * Anonymizes customers who have been inactive for longer than the merchant's retention period.
   * Customers with a reward still to claim are skipped, never forfeited by a background job.
   */
  async runForMerchant(
    merchantId: string,
    options: { actorUserId: string | null; requestId?: string; now?: Date } = {
      actorUserId: null,
    },
  ): Promise<{ anonymized: number; more: boolean }> {
    const now = options.now ?? new Date();
    const cutoff = inactivityCutoff(await this.get(merchantId), now);
    if (!cutoff) return { anonymized: 0, more: false };

    const ids = await this.repository.inactiveCandidates(merchantId, cutoff, now, RETENTION_BATCH);
    let anonymized = 0;
    for (const customerId of ids) {
      try {
        const result = await this.anonymization.anonymize({
          merchantId,
          customerId,
          reason: 'RETENTION_POLICY',
          acknowledgeOutstandingRewards: false,
          actorUserId: options.actorUserId,
          requestId: options.requestId,
        });
        if (result.anonymized) anonymized++;
      } catch (err) {
        // A customer who just earned a reward (or any other conflict) is simply left for the next run.
        this.logger.warn(`Retention skipped a customer: ${(err as Error).message}`);
      }
    }
    return { anonymized, more: ids.length === RETENTION_BATCH };
  }

  /** Platform-wide housekeeping on rows that carry no customer content. */
  async cleanup(now: Date = new Date()) {
    const hours = (h: number) => new Date(now.getTime() - h * 3_600_000);
    const days = (d: number) => hours(d * 24);
    return this.repository.purgeOperational({
      idempotencyBefore: hours(CLEANUP.idempotencyGraceHours),
      refreshTokensBefore: days(CLEANUP.refreshTokenDays),
      completedJobsBefore: days(CLEANUP.completedJobDays),
    });
  }
}

import { Injectable } from '@nestjs/common';
import type { RequestMeta } from '../../../common/decorators/request-context.decorator';
import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import {
  DEFAULT_PAGE_SIZE,
  Page,
  decodeCursor,
  encodeCursor,
} from '../../../common/http/pagination';
import { TransactionManager } from '../../../database/transaction-manager';
import { AuditService } from '../../audit';
import { MerchantDirectory } from '../../merchants';
import type { MerchantActor } from '../../tenancy';
import type { FraudIndicatorName } from '../domain/fraud-types';
import { FraudThresholds, changedFields, mergeThresholds } from '../domain/fraud-thresholds';
import { FlagRow, FraudRepository } from '../infrastructure/fraud.repository';

export interface FlagView extends FlagRow {
  /** Name of the staff member / branch / customer the flag is about (this merchant's own data). */
  subjectLabel: string | null;
}

export interface FlagListQuery {
  status?: 'OPEN' | 'DISMISSED' | 'CONFIRMED';
  indicator?: FraudIndicatorName;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

const notFound = () => new DomainError(ErrorCode.NOT_FOUND, 'Flag not found.', 404);
const validation = (m: string) => new DomainError(ErrorCode.VALIDATION_FAILED, m, 400);

@Injectable()
export class FraudFlagsService {
  constructor(
    private readonly repository: FraudRepository,
    private readonly merchants: MerchantDirectory,
    private readonly audit: AuditService,
    private readonly transactions: TransactionManager,
  ) {}

  async list(actor: MerchantActor, query: FlagListQuery): Promise<Page<FlagView>> {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      throw validation('from/to must be ISO 8601 timestamps.');
    }
    const rows = await this.repository.list(
      actor.merchantId,
      { status: query.status, indicator: query.indicator, from, to },
      limit + 1,
      decodeCursor(query.cursor),
    );
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: await this.withLabels(actor.merchantId, page),
      nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  async get(actor: MerchantActor, id: string): Promise<FlagView> {
    const flag = await this.repository.findById(actor.merchantId, id);
    if (!flag) throw notFound();
    return (await this.withLabels(actor.merchantId, [flag]))[0] as FlagView;
  }

  /**
   * A person's verdict on a flag. Recording it changes nothing else: no customer or staff member is
   * penalised, suspended or notified by the system. A flag can be reviewed once.
   */
  async review(
    actor: MerchantActor,
    id: string,
    verdict: { status: 'DISMISSED' | 'CONFIRMED'; note?: string },
    meta: RequestMeta,
  ): Promise<FlagView> {
    const note =
      verdict.note
        ?.replace(/\p{Cc}/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim() || null;
    await this.transactions.run(async (db) => {
      const flag = await this.repository.findById(actor.merchantId, id, db);
      if (!flag) throw notFound();
      const updated = await this.repository.review(
        actor.merchantId,
        id,
        { status: verdict.status, userId: actor.userId, note },
        db,
      );
      if (!updated) {
        throw new DomainError('ALREADY_REVIEWED', 'This flag has already been reviewed.', 409);
      }
      await this.audit.record(
        {
          action: 'fraud.flag_reviewed',
          actorUserId: actor.userId,
          merchantId: actor.merchantId,
          targetType: 'fraud_flag',
          targetId: id,
          requestId: meta.requestId,
          // The free-text note stays with the flag; the audit log only records the outcome.
          metadata: {
            indicator: flag.indicator,
            subjectType: flag.subjectType,
            status: verdict.status,
          },
        },
        db,
      );
    });
    return this.get(actor, id);
  }

  async getThresholds(actor: MerchantActor): Promise<FraudThresholds> {
    return mergeThresholds(await this.merchants.fraudThresholds(actor.merchantId));
  }

  /** Partial update merged over the current settings; only changed field NAMES are audited. */
  async updateThresholds(
    actor: MerchantActor,
    patch: Record<string, Record<string, unknown> | undefined>,
    meta: RequestMeta,
  ): Promise<FraudThresholds> {
    return this.transactions.run(async (db) => {
      const before = mergeThresholds(await this.merchants.fraudThresholds(actor.merchantId));
      const merged: Record<string, unknown> = JSON.parse(JSON.stringify(before));
      for (const [indicator, fields] of Object.entries(patch)) {
        if (fields) merged[indicator] = { ...(merged[indicator] as object), ...fields };
      }
      const after = mergeThresholds(merged);
      const changed = changedFields(before, after);
      if (changed.length > 0) {
        await this.merchants.setFraudThresholds(
          actor.merchantId,
          after as unknown as Record<string, unknown>,
          db,
        );
        await this.audit.record(
          {
            action: 'fraud.thresholds_changed',
            actorUserId: actor.userId,
            merchantId: actor.merchantId,
            targetType: 'merchant',
            targetId: actor.merchantId,
            requestId: meta.requestId,
            metadata: { changedFields: changed },
          },
          db,
        );
      }
      return after;
    });
  }

  private async withLabels(merchantId: string, rows: FlagRow[]): Promise<FlagView[]> {
    const labels = await this.repository.labels(merchantId, rows);
    return rows.map((r) => ({ ...r, subjectLabel: labels.get(r.subjectId) ?? null }));
  }
}

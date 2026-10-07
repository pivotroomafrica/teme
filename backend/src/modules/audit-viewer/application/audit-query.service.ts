import { Injectable } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import {
  DEFAULT_PAGE_SIZE,
  Page,
  decodeCursor,
  encodeCursor,
} from '../../../common/http/pagination';
import { AuditRepository, AuditService, sanitizeMetadata, type AuditRow } from '../../audit';
import { MerchantDirectory } from '../../merchants';
import type { MerchantActor, PlatformActor } from '../../tenancy';
import { resolveRange, stripNetworkMetadata } from '../domain/audit-range';

export interface AuditQuery {
  from?: string;
  to?: string;
  actorUserId?: string;
  branchId?: string;
  action?: string;
  actionPrefix?: string;
  targetType?: string;
  targetId?: string;
  limit?: number;
  cursor?: string;
}

export interface AuditEntryView {
  id: string;
  occurredAt: Date;
  action: string;
  actor: { type: 'USER' | 'SYSTEM'; userId: string | null; displayName: string | null };
  branchId: string | null;
  targetType: string | null;
  targetId: string | null;
  requestId: string | null;
  metadata: unknown;
}

const validation = (message: string) => new DomainError(ErrorCode.VALIDATION_FAILED, message, 400);

@Injectable()
export class AuditQueryService {
  constructor(
    private readonly repository: AuditRepository,
    private readonly merchants: MerchantDirectory,
    private readonly audit: AuditService,
  ) {}

  /**
   * A merchant sees ONLY its own history: the merchant id is taken from the authenticated membership and no
   * filter can widen it. Owners also see network details (IP, user agent); managers do not.
   */
  async forMerchant(actor: MerchantActor, query: AuditQuery): Promise<Page<AuditEntryView>> {
    const timezone = await this.merchants.timezone(actor.merchantId);
    return this.run(actor.merchantId, timezone, query, actor.roleKey === 'OWNER');
  }

  /**
   * Platform administrators need the explicit `platform:audit:read` permission. Without a merchant id they see
   * platform-level events only; naming a merchant is a deliberate act and is itself written to the audit
   * history of that merchant.
   */
  async forPlatform(
    actor: PlatformActor,
    merchantId: string | undefined,
    query: AuditQuery,
    requestId: string,
  ): Promise<Page<AuditEntryView>> {
    let timezone = 'UTC';
    if (merchantId) {
      if (!(await this.merchants.publicProfile(merchantId))) {
        throw new DomainError(ErrorCode.NOT_FOUND, 'Merchant not found.', 404);
      }
      timezone = await this.merchants.timezone(merchantId);
    }
    const page = await this.run(merchantId ?? null, timezone, query, true);
    await this.audit.record({
      action: 'audit.platform_accessed',
      actorUserId: actor.userId,
      merchantId: merchantId ?? null,
      requestId,
      metadata: {
        scope: merchantId ? 'merchant' : 'platform',
        filters: Object.keys(query).filter(
          (k) => k !== 'cursor' && (query as Record<string, unknown>)[k] !== undefined,
        ),
      },
    });
    return page;
  }

  private async run(
    merchantId: string | null,
    timezone: string,
    query: AuditQuery,
    includeNetwork: boolean,
  ): Promise<Page<AuditEntryView>> {
    const range = resolveRange(query.from, query.to, timezone, new Date());
    if (!range.ok) throw validation(range.error);
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;

    const rows = await this.repository.query(
      {
        merchantId,
        from: range.range.from,
        to: range.range.to,
        actorUserId: query.actorUserId,
        branchId: query.branchId,
        action: query.action,
        actionPrefix: query.actionPrefix,
        targetType: query.targetType,
        targetId: query.targetId,
      },
      limit + 1,
      decodeCursor(query.cursor),
    );
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => this.toView(r, includeNetwork)),
      nextCursor: rows.length > limit && last ? encodeCursor(last.occurredAt, last.id) : null,
    };
  }

  private toView(r: AuditRow, includeNetwork: boolean): AuditEntryView {
    // Sanitised again on the way out: defence in depth against anything stored before a rule existed.
    const clean = sanitizeMetadata(r.metadata);
    return {
      id: r.id,
      occurredAt: r.occurredAt,
      action: r.action,
      actor: {
        type: r.actorType,
        userId: r.actorUserId,
        displayName: r.actorUser?.displayName ?? null,
      },
      branchId: r.branchId,
      targetType: r.targetType,
      targetId: r.targetId,
      requestId: r.requestId,
      metadata: includeNetwork ? clean : stripNetworkMetadata(clean),
    };
  }
}

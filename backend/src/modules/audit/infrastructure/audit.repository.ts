import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { DbClient } from '../../../database/db-client';
import { PrismaService } from '../../../database/prisma.service';

export interface AuditFilter {
  /** null = platform-level events only (no tenant). */
  merchantId: string | null;
  from: Date;
  to: Date;
  actorUserId?: string;
  branchId?: string;
  action?: string;
  actionPrefix?: string;
  targetType?: string;
  targetId?: string;
}

export interface AuditRow {
  id: string;
  occurredAt: Date;
  action: string;
  actorType: 'USER' | 'SYSTEM';
  actorUserId: string | null;
  merchantId: string | null;
  branchId: string | null;
  targetType: string | null;
  targetId: string | null;
  requestId: string | null;
  metadata: unknown;
  actorUser: { displayName: string } | null;
}

@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Append-only: this repository intentionally has no update or delete. */
  async append(
    data: Prisma.AuditEventUncheckedCreateInput,
    db: DbClient = this.prisma,
  ): Promise<void> {
    await db.auditEvent.create({ data });
  }

  /** Newest first, keyset-paginated. Tenant scoping is the caller's responsibility via `filter.merchantId`. */
  async query(
    filter: AuditFilter,
    limit: number,
    after: { at: Date; id: string } | null,
  ): Promise<AuditRow[]> {
    const where: Prisma.AuditEventWhereInput = {
      merchantId: filter.merchantId,
      occurredAt: { gte: filter.from, lt: filter.to },
      ...(filter.actorUserId ? { actorUserId: filter.actorUserId } : {}),
      ...(filter.branchId ? { branchId: filter.branchId } : {}),
      ...(filter.action ? { action: filter.action } : {}),
      ...(filter.actionPrefix ? { action: { startsWith: filter.actionPrefix } } : {}),
      ...(filter.targetType ? { targetType: filter.targetType } : {}),
      ...(filter.targetId ? { targetId: filter.targetId } : {}),
    };
    if (after) {
      where.AND = [
        { OR: [{ occurredAt: { lt: after.at } }, { occurredAt: after.at, id: { lt: after.id } }] },
      ];
    }
    return this.prisma.auditEvent.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        occurredAt: true,
        action: true,
        actorType: true,
        actorUserId: true,
        merchantId: true,
        branchId: true,
        targetType: true,
        targetId: true,
        requestId: true,
        metadata: true,
        actorUser: { select: { displayName: true } },
      },
    });
  }
}

import { Injectable } from '@nestjs/common';
import type { FraudFlagStatus, FraudIndicator, FraudSubjectType, Prisma } from '@prisma/client';
import type { DbClient } from '../../../database/db-client';
import { PrismaService } from '../../../database/prisma.service';

export interface FlagRow {
  id: string;
  indicator: FraudIndicator;
  subjectType: FraudSubjectType;
  subjectId: string;
  windowStart: Date;
  windowEnd: Date;
  observed: number;
  threshold: number;
  details: Record<string, unknown>;
  status: FraudFlagStatus;
  reviewedAt: Date | null;
  reviewNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewFlag {
  merchantId: string;
  indicator: FraudIndicator;
  subjectType: FraudSubjectType;
  subjectId: string;
  windowStart: Date;
  windowEnd: Date;
  observed: number;
  threshold: number;
  details: Record<string, unknown>;
}

export interface FlagFilter {
  status?: FraudFlagStatus;
  indicator?: FraudIndicator;
  from?: Date;
  to?: Date;
}

const select = {
  id: true,
  indicator: true,
  subjectType: true,
  subjectId: true,
  windowStart: true,
  windowEnd: true,
  observed: true,
  threshold: true,
  details: true,
  status: true,
  reviewedAt: true,
  reviewNote: true,
  createdAt: true,
  updatedAt: true,
} as const;

const toRow = (r: Omit<FlagRow, 'details'> & { details: unknown }): FlagRow => ({
  ...r,
  details: (r.details ?? {}) as Record<string, unknown>,
});

export interface Count {
  id: string;
  count: number;
}

/**
 * Flags plus the read-only aggregate queries that feed the indicators. Every query is scoped to one
 * merchant and a half-open time range [start, end). The aggregates read the append-only ledgers directly:
 * they are set-based (one query per indicator), never per-event loops.
 */
@Injectable()
export class FraudRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ───────── flags ─────────

  /** Creates the flag, or refreshes its numbers while the bucket is still being filled. Returns whether it was new. */
  async upsertFlag(flag: NewFlag): Promise<boolean> {
    const where = {
      merchantId_indicator_subjectType_subjectId_windowStart: {
        merchantId: flag.merchantId,
        indicator: flag.indicator,
        subjectType: flag.subjectType,
        subjectId: flag.subjectId,
        windowStart: flag.windowStart,
      },
    };
    const existing = await this.prisma.fraudFlag.findUnique({ where, select: { id: true } });
    const details = flag.details as Prisma.InputJsonValue;
    await this.prisma.fraudFlag.upsert({
      where,
      // A reviewed flag keeps its verdict; only the measurements are brought up to date.
      update: {
        observed: flag.observed,
        threshold: flag.threshold,
        details,
        windowEnd: flag.windowEnd,
      },
      create: { ...flag, details },
    });
    return !existing;
  }

  async list(
    merchantId: string,
    filter: FlagFilter,
    limit: number,
    after: { at: Date; id: string } | null,
  ): Promise<FlagRow[]> {
    const where: Prisma.FraudFlagWhereInput = {
      merchantId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.indicator ? { indicator: filter.indicator } : {}),
      ...(filter.from || filter.to
        ? {
            createdAt: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lt: filter.to } : {}),
            },
          }
        : {}),
    };
    if (after) {
      where.AND = [
        { OR: [{ createdAt: { lt: after.at } }, { createdAt: after.at, id: { lt: after.id } }] },
      ];
    }
    const rows = await this.prisma.fraudFlag.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select,
    });
    return rows.map(toRow);
  }

  async findById(
    merchantId: string,
    id: string,
    db: DbClient = this.prisma,
  ): Promise<FlagRow | null> {
    const row = await db.fraudFlag.findFirst({ where: { id, merchantId }, select });
    return row ? toRow(row) : null;
  }

  /** Records a human verdict. Only an OPEN flag can be reviewed (race-safe). */
  async review(
    merchantId: string,
    id: string,
    verdict: { status: 'DISMISSED' | 'CONFIRMED'; userId: string; note: string | null },
    db: DbClient,
  ): Promise<boolean> {
    const res = await db.fraudFlag.updateMany({
      where: { id, merchantId, status: 'OPEN' },
      data: {
        status: verdict.status,
        reviewedByUserId: verdict.userId,
        reviewedAt: new Date(),
        reviewNote: verdict.note,
      },
    });
    return res.count === 1;
  }

  /** Human-readable names for the subjects of a page of flags (the merchant's own staff, branches, customers). */
  async labels(merchantId: string, flags: FlagRow[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    const ids = (t: FraudSubjectType) =>
      flags.filter((f) => f.subjectType === t).map((f) => f.subjectId);

    const staff = ids('STAFF');
    if (staff.length) {
      const rows = await this.prisma.staffMembership.findMany({
        where: { merchantId, id: { in: staff } },
        select: { id: true, user: { select: { displayName: true } } },
      });
      for (const r of rows) out.set(r.id, r.user.displayName);
    }
    const branches = ids('BRANCH');
    if (branches.length) {
      const rows = await this.prisma.branch.findMany({
        where: { merchantId, id: { in: branches } },
        select: { id: true, nameEn: true },
      });
      for (const r of rows) out.set(r.id, r.nameEn);
    }
    const memberships = ids('MEMBERSHIP');
    if (memberships.length) {
      const rows = await this.prisma.customerMembership.findMany({
        where: { merchantId, id: { in: memberships } },
        select: { id: true, customer: { select: { firstName: true } } },
      });
      for (const r of rows) out.set(r.id, r.customer.firstName);
    }
    return out;
  }

  // ───────── indicator aggregates ─────────

  stampsByStaff(merchantId: string, start: Date, end: Date, over: number): Promise<Count[]> {
    return this.counts`
      SELECT staff_membership_id::text AS id, count(*)::int AS count FROM stamp_events
      WHERE merchant_id = ${merchantId}::uuid AND occurred_at >= ${start} AND occurred_at < ${end}
      GROUP BY staff_membership_id HAVING count(*) > ${over}`;
  }

  /** Every scan of a card in the window, accepted (a stamp) or refused (an audited rejection). */
  scanAttemptsByMembership(
    merchantId: string,
    start: Date,
    end: Date,
    over: number,
  ): Promise<Array<Count & { stamps: number; rejected: number }>> {
    return this.prisma.$queryRaw<Array<Count & { stamps: number; rejected: number }>>`
      SELECT membership_id AS id,
             (sum(stamped) + sum(refused))::int AS count,
             sum(stamped)::int AS stamps, sum(refused)::int AS rejected
      FROM (
        SELECT membership_id::text AS membership_id, 1 AS stamped, 0 AS refused FROM stamp_events
        WHERE merchant_id = ${merchantId}::uuid AND occurred_at >= ${start} AND occurred_at < ${end}
        UNION ALL
        SELECT target_id, 0, 1 FROM audit_events
        WHERE merchant_id = ${merchantId}::uuid AND action = 'scan.rejected' AND target_type = 'membership'
          AND occurred_at >= ${start} AND occurred_at < ${end}
      ) attempts
      GROUP BY membership_id HAVING sum(stamped) + sum(refused) > ${over}`;
  }

  cooldownRejectionsByMembership(
    merchantId: string,
    start: Date,
    end: Date,
    over: number,
  ): Promise<Count[]> {
    return this.counts`
      SELECT target_id AS id, count(*)::int AS count FROM audit_events
      WHERE merchant_id = ${merchantId}::uuid AND action = 'scan.rejected' AND target_type = 'membership'
        AND metadata ->> 'reason' = 'COOLDOWN_ACTIVE'
        AND occurred_at >= ${start} AND occurred_at < ${end}
      GROUP BY target_id HAVING count(*) > ${over}`;
  }

  redemptionsByStaff(merchantId: string, start: Date, end: Date, over: number): Promise<Count[]> {
    return this.counts`
      SELECT staff_membership_id::text AS id, count(*)::int AS count FROM redemption_events
      WHERE merchant_id = ${merchantId}::uuid AND occurred_at >= ${start} AND occurred_at < ${end}
      GROUP BY staff_membership_id HAVING count(*) > ${over}`;
  }

  /** Stamps per branch inside [start, end): used for the current bucket and, summed, for the baseline. */
  stampsByBranch(merchantId: string, start: Date, end: Date, atLeast: number): Promise<Count[]> {
    return this.counts`
      SELECT branch_id::text AS id, count(*)::int AS count FROM stamp_events
      WHERE merchant_id = ${merchantId}::uuid AND occurred_at >= ${start} AND occurred_at < ${end}
      GROUP BY branch_id HAVING count(*) >= ${atLeast}`;
  }

  /** Per staff member: stamps issued in the window and how many of them were later reversed. */
  reversalsByStaff(
    merchantId: string,
    start: Date,
    end: Date,
    minStamps: number,
  ): Promise<Array<{ id: string; total: number; reversed: number }>> {
    return this.prisma.$queryRaw<Array<{ id: string; total: number; reversed: number }>>`
      SELECT s.staff_membership_id::text AS id, count(*)::int AS total, count(r.id)::int AS reversed
      FROM stamp_events s LEFT JOIN reversal_events r ON r.stamp_event_id = s.id
      WHERE s.merchant_id = ${merchantId}::uuid AND s.occurred_at >= ${start} AND s.occurred_at < ${end}
      GROUP BY s.staff_membership_id HAVING count(*) >= ${minStamps}`;
  }

  private counts(strings: TemplateStringsArray, ...values: unknown[]): Promise<Count[]> {
    return this.prisma.$queryRaw<Count[]>(strings as never, ...values);
  }
}

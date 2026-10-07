import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

export interface ActivityEvent {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  branchId: string | null;
  occurredAt: Date;
}

export interface ActivitySummary {
  stampsIssued: number;
  redemptionsProcessed: number;
  reversalsPerformed: number;
  lastActiveAt: Date | null;
}

@Injectable()
export class StaffActivityRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Counts come from the append-only ledgers, restricted to one merchant and one staff membership. */
  async summary(
    merchantId: string,
    staffMembershipId: string,
    userId: string,
  ): Promise<ActivitySummary> {
    const [stamps, redemptions, reversals, last] = await Promise.all([
      this.prisma.stampEvent.count({ where: { merchantId, staffMembershipId } }),
      this.prisma.redemptionEvent.count({ where: { merchantId, staffMembershipId } }),
      this.prisma.reversalEvent.count({
        where: { merchantId, reversedByStaffId: staffMembershipId },
      }),
      this.prisma.auditEvent.aggregate({
        where: { merchantId, actorUserId: userId },
        _max: { occurredAt: true },
      }),
    ]);
    return {
      stampsIssued: stamps,
      redemptionsProcessed: redemptions,
      reversalsPerformed: reversals,
      lastActiveAt: last._max.occurredAt,
    };
  }

  /** Newest first, keyset-paginated. Metadata is deliberately not selected. */
  events(
    merchantId: string,
    userId: string,
    limit: number,
    after: { at: Date; id: string } | null,
  ): Promise<ActivityEvent[]> {
    return this.prisma.auditEvent.findMany({
      where: {
        merchantId,
        actorUserId: userId,
        ...(after
          ? {
              OR: [
                { occurredAt: { lt: after.at } },
                { occurredAt: after.at, id: { lt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        branchId: true,
        occurredAt: true,
      },
    });
  }
}

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { DbClient } from '../../../database/db-client';
import { PrismaService } from '../../../database/prisma.service';

export interface NewRedemption {
  merchantId: string;
  branchId: string;
  membershipId: string;
  rewardUnlockId: string;
  staffMembershipId: string;
  attemptNumber: number;
  idempotencyKey: string;
  deviceMetadata?: Record<string, unknown>;
  occurredAt: Date;
}

export interface RedemptionRecord {
  id: string;
  membershipId: string;
  rewardUnlockId: string;
  occurredAt: Date;
  reversed: boolean;
}

export interface NewReversal {
  merchantId: string;
  membershipId: string;
  targetType: 'STAMP' | 'REDEMPTION';
  stampEventId?: string;
  redemptionEventId?: string;
  reversedByStaffId: string;
  reason: string;
  idempotencyKey: string;
}

export interface LedgerReversal {
  id: string;
  occurredAt: Date;
  targetType: 'STAMP' | 'REDEMPTION';
  targetId: string;
  reversedByStaffId: string;
  reason: string;
}

export interface LedgerRedemption {
  id: string;
  occurredAt: Date;
  branchId: string;
  staffMembershipId: string;
  rewardUnlockId: string;
  reversed: boolean;
}

/**
 * Append-only access to redemption and reversal events. There is deliberately no update or delete:
 * corrections are new reversal rows that point at the original.
 */
@Injectable()
export class RedemptionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createRedemption(
    r: NewRedemption,
    db: DbClient,
  ): Promise<{ id: string; occurredAt: Date }> {
    return db.redemptionEvent.create({
      data: { ...r, deviceMetadata: r.deviceMetadata as Prisma.InputJsonValue | undefined },
      select: { id: true, occurredAt: true },
    });
  }

  async findRedemption(
    merchantId: string,
    id: string,
    db: DbClient = this.prisma,
  ): Promise<RedemptionRecord | null> {
    const row = await db.redemptionEvent.findFirst({
      where: { id, merchantId },
      select: {
        id: true,
        membershipId: true,
        rewardUnlockId: true,
        occurredAt: true,
        reversal: { select: { id: true } },
      },
    });
    return row
      ? {
          id: row.id,
          membershipId: row.membershipId,
          rewardUnlockId: row.rewardUnlockId,
          occurredAt: row.occurredAt,
          reversed: row.reversal !== null,
        }
      : null;
  }

  async createReversal(r: NewReversal, db: DbClient): Promise<{ id: string; occurredAt: Date }> {
    return db.reversalEvent.create({ data: r, select: { id: true, occurredAt: true } });
  }

  async listRedemptions(
    merchantId: string,
    membershipId: string,
    limit: number,
    db: DbClient = this.prisma,
  ): Promise<LedgerRedemption[]> {
    const rows = await db.redemptionEvent.findMany({
      where: { merchantId, membershipId },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        occurredAt: true,
        branchId: true,
        staffMembershipId: true,
        rewardUnlockId: true,
        reversal: { select: { id: true } },
      },
    });
    return rows.map((r) => ({ ...r, reversed: r.reversal !== null }));
  }

  async listReversals(
    merchantId: string,
    membershipId: string,
    limit: number,
    db: DbClient = this.prisma,
  ): Promise<LedgerReversal[]> {
    const rows = await db.reversalEvent.findMany({
      where: { merchantId, membershipId },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        occurredAt: true,
        targetType: true,
        stampEventId: true,
        redemptionEventId: true,
        reversedByStaffId: true,
        reason: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt,
      targetType: r.targetType,
      targetId: (r.stampEventId ?? r.redemptionEventId) as string,
      reversedByStaffId: r.reversedByStaffId,
      reason: r.reason,
    }));
  }
}

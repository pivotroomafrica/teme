import { Injectable } from '@nestjs/common';
import type { DbClient } from '../../../database/db-client';
import { PrismaService } from '../../../database/prisma.service';

export interface UnlockRow {
  id: string;
  unlockedAt: Date;
  expiresAt: Date | null;
  triggeringStampId: string;
  reward: {
    nameEn: string;
    nameAm: string | null;
    descriptionEn: string | null;
    descriptionAm: string | null;
  };
  /** Every redemption ever made against this unlock (newest last), reversed or not. */
  redemptions: Array<{ id: string; occurredAt: Date; reversed: boolean }>;
}

export interface NewUnlock {
  merchantId: string;
  programId: string;
  membershipId: string;
  rewardDefinitionId: string;
  triggeringStampId: string;
  unlockedAt: Date;
  expiresAt: Date | null;
}

/** Reads and appends reward unlocks. Unlock rows are never updated or deleted. */
@Injectable()
export class RewardsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listForMembership(
    merchantId: string,
    membershipId: string,
    db: DbClient = this.prisma,
  ): Promise<UnlockRow[]> {
    const rows = await db.rewardUnlock.findMany({
      where: { merchantId, membershipId },
      orderBy: [{ unlockedAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        unlockedAt: true,
        expiresAt: true,
        triggeringStampId: true,
        rewardDefinition: {
          select: { nameEn: true, nameAm: true, descriptionEn: true, descriptionAm: true },
        },
        redemptions: {
          orderBy: { attemptNumber: 'asc' },
          select: { id: true, occurredAt: true, reversal: { select: { id: true } } },
        },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      unlockedAt: r.unlockedAt,
      expiresAt: r.expiresAt,
      triggeringStampId: r.triggeringStampId,
      reward: r.rewardDefinition,
      redemptions: r.redemptions.map((x) => ({
        id: x.id,
        occurredAt: x.occurredAt,
        reversed: x.reversal !== null,
      })),
    }));
  }

  createUnlock(unlock: NewUnlock, db: DbClient): Promise<{ id: string }> {
    return db.rewardUnlock.create({ data: unlock, select: { id: true } });
  }
}

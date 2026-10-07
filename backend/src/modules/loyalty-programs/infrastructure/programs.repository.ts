import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { DbClient } from '../../../database/db-client';
import { PrismaService } from '../../../database/prisma.service';
import type { ProgramStatus } from '../domain/program-lifecycle';

export interface RewardRecord {
  id: string;
  nameEn: string;
  nameAm: string | null;
  descriptionEn: string | null;
  descriptionAm: string | null;
  validForDays: number | null;
}

export interface ProgramRecord {
  id: string;
  merchantId: string;
  nameEn: string;
  nameAm: string | null;
  termsEn: string | null;
  termsAm: string | null;
  stampsRequired: number;
  cooldownMinutes: number;
  status: ProgramStatus;
  isDefault: boolean;
  brandColor: string | null;
  cardDisplay: Record<string, unknown>;
  reward: RewardRecord | null;
  membershipCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProgramFields {
  nameEn?: string;
  nameAm?: string | null;
  termsEn?: string | null;
  termsAm?: string | null;
  stampsRequired?: number;
  cooldownMinutes?: number;
  brandColor?: string | null;
  cardDisplay?: object;
}

export interface RewardFields {
  nameEn?: string;
  nameAm?: string | null;
  descriptionEn?: string | null;
  descriptionAm?: string | null;
  validForDays?: number | null;
}

const rewardSelect = {
  id: true,
  nameEn: true,
  nameAm: true,
  descriptionEn: true,
  descriptionAm: true,
  validForDays: true,
} as const;

const select = {
  id: true,
  merchantId: true,
  nameEn: true,
  nameAm: true,
  termsEn: true,
  termsAm: true,
  stampsRequired: true,
  cooldownMinutes: true,
  status: true,
  isDefault: true,
  brandColor: true,
  cardDisplay: true,
  createdAt: true,
  updatedAt: true,
  rewardDefinitions: { where: { status: 'ACTIVE' as const }, take: 1, select: rewardSelect },
  _count: { select: { memberships: true } },
} satisfies Prisma.LoyaltyProgramSelect;

type Row = Prisma.LoyaltyProgramGetPayload<{ select: typeof select }>;

const toRecord = (r: Row): ProgramRecord => ({
  id: r.id,
  merchantId: r.merchantId,
  nameEn: r.nameEn,
  nameAm: r.nameAm,
  termsEn: r.termsEn,
  termsAm: r.termsAm,
  stampsRequired: r.stampsRequired,
  cooldownMinutes: r.cooldownMinutes,
  status: r.status,
  isDefault: r.isDefault,
  brandColor: r.brandColor,
  cardDisplay: (r.cardDisplay ?? {}) as Record<string, unknown>,
  reward: r.rewardDefinitions[0] ?? null,
  membershipCount: r._count.memberships,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/** Every query is scoped by merchantId. There is deliberately no delete: history must survive. */
@Injectable()
export class ProgramsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(merchantId: string, status?: ProgramStatus): Promise<ProgramRecord[]> {
    const rows = await this.prisma.loyaltyProgram.findMany({
      where: { merchantId, ...(status ? { status } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select,
    });
    return rows.map(toRecord);
  }

  async findById(
    merchantId: string,
    id: string,
    db: DbClient = this.prisma,
  ): Promise<ProgramRecord | null> {
    const row = await db.loyaltyProgram.findFirst({ where: { id, merchantId }, select });
    return row ? toRecord(row) : null;
  }

  /** The program new customers join: the merchant's default ACTIVE program. */
  async findActiveDefault(
    merchantId: string,
    db: DbClient = this.prisma,
  ): Promise<ProgramRecord | null> {
    const row = await db.loyaltyProgram.findFirst({
      where: { merchantId, status: 'ACTIVE', isDefault: true },
      select,
    });
    return row ? toRecord(row) : null;
  }

  async create(
    merchantId: string,
    data: ProgramFields & { nameEn: string; stampsRequired: number; cooldownMinutes: number },
    reward: RewardFields & { nameEn: string },
    db: DbClient,
  ): Promise<string> {
    const { cardDisplay, ...rest } = data;
    const program = await db.loyaltyProgram.create({
      data: {
        merchantId,
        ...rest,
        cardDisplay: (cardDisplay ?? {}) as unknown as Prisma.InputJsonValue,
        status: 'DRAFT',
        isDefault: false,
      },
      select: { id: true },
    });
    await db.rewardDefinition.create({
      data: { merchantId, programId: program.id, ...reward },
    });
    return program.id;
  }

  async update(merchantId: string, id: string, data: ProgramFields, db: DbClient): Promise<void> {
    const { cardDisplay, ...rest } = data;
    await db.loyaltyProgram.updateMany({
      where: { id, merchantId },
      data: {
        ...rest,
        ...(cardDisplay !== undefined
          ? { cardDisplay: cardDisplay as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
  }

  async updateReward(
    merchantId: string,
    programId: string,
    rewardId: string,
    data: RewardFields,
    db: DbClient,
  ): Promise<void> {
    await db.rewardDefinition.updateMany({ where: { id: rewardId, merchantId, programId }, data });
  }

  async setStatus(
    merchantId: string,
    id: string,
    status: ProgramStatus,
    isDefault: boolean,
    db: DbClient,
  ): Promise<void> {
    await db.loyaltyProgram.updateMany({ where: { id, merchantId }, data: { status, isDefault } });
  }

  /** Locks every program of the merchant for the transaction; serialises lifecycle changes. */
  async lockAll(
    merchantId: string,
    db: DbClient,
  ): Promise<Array<{ id: string; status: ProgramStatus; isDefault: boolean }>> {
    const rows = await db.$queryRaw<
      Array<{ id: string; status: ProgramStatus; is_default: boolean }>
    >`
      SELECT id, status::text AS status, is_default FROM loyalty_programs
      WHERE merchant_id = ${merchantId}::uuid
      FOR UPDATE`;
    return rows.map((r) => ({ id: r.id, status: r.status, isDefault: r.is_default }));
  }

  /**
   * Shares a read lock on one program row for the transaction. Enrollment holds it while inserting a
   * membership; program updates take the exclusive lock first, so stamp-threshold checks and new
   * memberships can never interleave. Returns the locked status, or null when not found.
   */
  async lockForEnrollment(
    merchantId: string,
    programId: string,
    db: DbClient,
  ): Promise<{ status: ProgramStatus; isDefault: boolean } | null> {
    const rows = await db.$queryRaw<Array<{ status: ProgramStatus; is_default: boolean }>>`
      SELECT status::text AS status, is_default FROM loyalty_programs
      WHERE id = ${programId}::uuid AND merchant_id = ${merchantId}::uuid
      FOR SHARE`;
    const row = rows[0];
    return row ? { status: row.status, isDefault: row.is_default } : null;
  }
}

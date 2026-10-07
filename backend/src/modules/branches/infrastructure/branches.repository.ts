import { Injectable } from '@nestjs/common';
import type { BranchStatus } from '@prisma/client';
import type { DbClient } from '../../../database/db-client';
import { PrismaService } from '../../../database/prisma.service';
import type { BranchScope } from '../../tenancy';

export interface BranchRecord {
  id: string;
  nameEn: string;
  nameAm: string | null;
  addressText: string | null;
  city: string | null;
  phoneE164: string | null;
  status: BranchStatus;
}

export interface BranchData {
  nameEn?: string;
  nameAm?: string | null;
  addressText?: string | null;
  city?: string | null;
  phoneE164?: string | null;
}

const select = {
  id: true,
  nameEn: true,
  nameAm: true,
  addressText: true,
  city: true,
  phoneE164: true,
  status: true,
} as const;

/** Every query takes merchantId; there is no method that reads or writes branches without it. */
@Injectable()
export class BranchesRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(merchantId: string, scope: BranchScope): Promise<BranchRecord[]> {
    return this.prisma.branch.findMany({
      where: { merchantId, ...(scope === 'ALL' ? {} : { id: { in: [...scope] } }) },
      orderBy: { nameEn: 'asc' },
      select,
    });
  }

  findById(
    merchantId: string,
    id: string,
    scope: BranchScope,
    db: DbClient = this.prisma,
  ): Promise<BranchRecord | null> {
    // Scope is checked in code: a second "id" key in the where clause would overwrite the requested id.
    if (scope !== 'ALL' && !scope.includes(id)) return Promise.resolve(null);
    return db.branch.findFirst({ where: { id, merchantId }, select });
  }

  create(
    merchantId: string,
    data: BranchData & { nameEn: string },
    db: DbClient,
  ): Promise<BranchRecord> {
    return db.branch.create({ data: { merchantId, ...data }, select });
  }

  async update(merchantId: string, id: string, data: BranchData, db: DbClient): Promise<void> {
    await db.branch.updateMany({ where: { id, merchantId }, data });
  }

  async setStatus(
    merchantId: string,
    id: string,
    status: BranchStatus,
    now: Date,
    db: DbClient,
  ): Promise<void> {
    await db.branch.updateMany({
      where: { id, merchantId },
      data: { status, deactivatedAt: status === 'INACTIVE' ? now : null },
    });
  }

  /** Locks the merchant's active branches for the transaction (serialises "last branch" checks). */
  async lockActiveBranchIds(merchantId: string, db: DbClient): Promise<string[]> {
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM branches
      WHERE merchant_id = ${merchantId}::uuid AND status = 'ACTIVE'
      FOR UPDATE`;
    return rows.map((r) => r.id);
  }
}

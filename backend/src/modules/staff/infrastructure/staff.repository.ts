import { Injectable } from '@nestjs/common';
import type { AccountStatus, Language, StaffStatus } from '@prisma/client';
import type { DbClient } from '../../../database/db-client';
import { PrismaService } from '../../../database/prisma.service';

export interface StaffRecord {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  roleKey: string;
  status: StaffStatus;
  userStatus: AccountStatus;
  branchIds: string[];
  activatedAt: Date | null;
  deactivatedAt: Date | null;
}

const select = {
  id: true,
  userId: true,
  status: true,
  activatedAt: true,
  deactivatedAt: true,
  user: { select: { displayName: true, email: true, status: true } },
  role: { select: { key: true } },
  branchAssignments: { select: { branchId: true } },
} as const;

type Row = {
  id: string;
  userId: string;
  status: StaffStatus;
  activatedAt: Date | null;
  deactivatedAt: Date | null;
  user: { displayName: string; email: string; status: AccountStatus };
  role: { key: string };
  branchAssignments: { branchId: string }[];
};

const toRecord = (r: Row): StaffRecord => ({
  id: r.id,
  userId: r.userId,
  displayName: r.user.displayName,
  email: r.user.email,
  roleKey: r.role.key,
  status: r.status,
  userStatus: r.user.status,
  branchIds: r.branchAssignments.map((b) => b.branchId).sort(),
  activatedAt: r.activatedAt,
  deactivatedAt: r.deactivatedAt,
});

export interface NewInvitedStaff {
  merchantId: string;
  email: string;
  displayName: string;
  language: Language;
  passwordHash: string;
  roleId: string;
  branchIds: string[];
}

/** Every query is scoped by merchantId. */
@Injectable()
export class StaffRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(merchantId: string): Promise<StaffRecord[]> {
    const rows = await this.prisma.staffMembership.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'asc' },
      select,
    });
    return rows.map(toRecord);
  }

  async findById(
    merchantId: string,
    id: string,
    db: DbClient = this.prisma,
  ): Promise<StaffRecord | null> {
    const row = await db.staffMembership.findFirst({ where: { id, merchantId }, select });
    return row ? toRecord(row) : null;
  }

  async findRoleId(key: string, db: DbClient = this.prisma): Promise<string | null> {
    const role = await db.role.findFirst({
      where: { key, scope: 'MERCHANT' },
      select: { id: true },
    });
    return role?.id ?? null;
  }

  /**
   * Locks the merchant's active owner rows for the rest of the transaction and returns their ids.
   * Serialises concurrent "remove an owner" requests so the last owner can never be removed.
   */
  async lockActiveOwners(merchantId: string, db: DbClient): Promise<string[]> {
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT sm.id FROM staff_memberships sm
      JOIN roles r ON r.id = sm.role_id
      WHERE sm.merchant_id = ${merchantId}::uuid AND sm.status = 'ACTIVE' AND r.key = 'OWNER'
      FOR UPDATE OF sm`;
    return rows.map((r) => r.id);
  }

  async updateRole(merchantId: string, id: string, roleId: string, db: DbClient): Promise<void> {
    await db.staffMembership.updateMany({ where: { id, merchantId }, data: { roleId } });
  }

  async deactivate(merchantId: string, id: string, now: Date, db: DbClient): Promise<void> {
    await db.staffMembership.updateMany({
      where: { id, merchantId },
      data: { status: 'DEACTIVATED', deactivatedAt: now },
    });
  }

  async activate(merchantId: string, id: string, now: Date, db: DbClient): Promise<void> {
    await db.staffMembership.updateMany({
      where: { id, merchantId },
      data: { status: 'ACTIVE', deactivatedAt: null, activatedAt: now },
    });
  }

  async emailExists(email: string, db: DbClient = this.prisma): Promise<boolean> {
    return (await db.platformUser.count({ where: { email } })) > 0;
  }

  /** True when every id is an ACTIVE branch of this merchant (foreign or unknown ids make it false). */
  async allActiveBranches(merchantId: string, ids: string[], db: DbClient): Promise<boolean> {
    if (ids.length === 0) return true;
    const count = await db.branch.count({
      where: { merchantId, status: 'ACTIVE', id: { in: ids } },
    });
    return count === ids.length;
  }

  /** Creates the login account (unusable password), the INVITED membership and its branches. */
  async createInvited(
    data: NewInvitedStaff,
    db: DbClient,
  ): Promise<{ staffId: string; userId: string }> {
    const user = await db.platformUser.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
        displayName: data.displayName,
        accountType: 'MERCHANT_USER',
        preferredLanguage: data.language,
      },
      select: { id: true },
    });
    const staff = await db.staffMembership.create({
      data: {
        merchantId: data.merchantId,
        userId: user.id,
        roleId: data.roleId,
        status: 'INVITED',
      },
      select: { id: true },
    });
    if (data.branchIds.length > 0) {
      await db.staffBranchAssignment.createMany({
        data: data.branchIds.map((branchId) => ({
          staffMembershipId: staff.id,
          branchId,
          merchantId: data.merchantId,
        })),
      });
    }
    return { staffId: staff.id, userId: user.id };
  }

  async replaceBranches(
    merchantId: string,
    staffId: string,
    branchIds: string[],
    db: DbClient,
  ): Promise<{ added: string[]; removed: string[] }> {
    const existing = (
      await db.staffBranchAssignment.findMany({
        where: { merchantId, staffMembershipId: staffId },
        select: { branchId: true },
      })
    ).map((a) => a.branchId);
    const added = branchIds.filter((id) => !existing.includes(id));
    const removed = existing.filter((id) => !branchIds.includes(id));
    if (removed.length > 0) {
      await db.staffBranchAssignment.deleteMany({
        where: { merchantId, staffMembershipId: staffId, branchId: { in: removed } },
      });
    }
    if (added.length > 0) {
      await db.staffBranchAssignment.createMany({
        data: added.map((branchId) => ({ staffMembershipId: staffId, branchId, merchantId })),
      });
    }
    return { added, removed };
  }
}

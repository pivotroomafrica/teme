import { Injectable } from '@nestjs/common';
import type { AccountStatus, AccountType, Language } from '@prisma/client';
import type { DbClient } from '../../../database/db-client';
import { PrismaService } from '../../../database/prisma.service';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  accountType: AccountType;
  status: AccountStatus;
  preferredLanguage: Language;
  lockedUntil: Date | null;
}

export interface ActiveMembership {
  id: string;
  merchantId: string;
  roleKey: string;
  permissions: string[];
  /** Active branches the member is assigned to. */
  branchIds: string[];
}

export interface PlatformRole {
  key: string;
  permissions: string[];
}

const userSelect = {
  id: true,
  email: true,
  passwordHash: true,
  displayName: true,
  accountType: true,
  status: true,
  preferredLanguage: true,
  lockedUntil: true,
} as const;

@Injectable()
export class IdentityRepository {
  constructor(private readonly prisma: PrismaService) {}

  findUserByEmail(email: string, db: DbClient = this.prisma): Promise<UserRecord | null> {
    return db.platformUser.findUnique({ where: { email }, select: userSelect });
  }

  findUserById(id: string, db: DbClient = this.prisma): Promise<UserRecord | null> {
    return db.platformUser.findUnique({ where: { id }, select: userSelect });
  }

  /** Merchant of any membership (used to scope failed-login audit rows to the right tenant). */
  async findAnyMembershipMerchantId(
    userId: string,
    db: DbClient = this.prisma,
  ): Promise<string | null> {
    const m = await db.staffMembership.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { merchantId: true },
    });
    return m?.merchantId ?? null;
  }

  /** The user's ACTIVE membership at an ACTIVE merchant, optionally pinned to a membership id. */
  async findActiveMembership(
    userId: string,
    membershipId?: string,
    db: DbClient = this.prisma,
  ): Promise<ActiveMembership | null> {
    const m = await db.staffMembership.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        merchant: { status: 'ACTIVE' },
        role: { scope: 'MERCHANT' },
        ...(membershipId ? { id: membershipId } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        merchantId: true,
        role: {
          select: { key: true, permissions: { select: { permission: { select: { key: true } } } } },
        },
        branchAssignments: { where: { branch: { status: 'ACTIVE' } }, select: { branchId: true } },
      },
    });
    if (!m) return null;
    return {
      id: m.id,
      merchantId: m.merchantId,
      roleKey: m.role.key,
      permissions: m.role.permissions.map((p) => p.permission.key),
      branchIds: m.branchAssignments.map((b) => b.branchId),
    };
  }

  async findPlatformRole(db: DbClient = this.prisma): Promise<PlatformRole | null> {
    const role = await db.role.findFirst({
      where: { key: 'PLATFORM_ADMIN', scope: 'PLATFORM' },
      select: { key: true, permissions: { select: { permission: { select: { key: true } } } } },
    });
    return role
      ? { key: role.key, permissions: role.permissions.map((p) => p.permission.key) }
      : null;
  }

  /** Atomic increment; locks the account when the threshold is reached. */
  async registerFailedLogin(
    userId: string,
    max: number,
    lockUntil: Date,
    db: DbClient = this.prisma,
  ): Promise<void> {
    await db.$executeRaw`
      UPDATE platform_users
      SET failed_login_count = CASE WHEN failed_login_count + 1 >= ${max} THEN 0 ELSE failed_login_count + 1 END,
          locked_until = CASE WHEN failed_login_count + 1 >= ${max} THEN ${lockUntil} ELSE locked_until END
      WHERE id = ${userId}::uuid`;
  }

  async markLoginSuccess(userId: string, now: Date, db: DbClient = this.prisma): Promise<void> {
    await db.platformUser.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });
  }

  async deactivateUser(userId: string, now: Date, db: DbClient = this.prisma): Promise<void> {
    await db.platformUser.update({
      where: { id: userId },
      data: { status: 'DEACTIVATED', deactivatedAt: now },
    });
  }
}

import { Injectable } from '@nestjs/common';
import type { AccountStatus, MerchantStatus, StaffStatus } from '@prisma/client';
import type { DbClient } from '../../../database/db-client';
import { PrismaService } from '../../../database/prisma.service';

export interface InvitationRecord {
  id: string;
  merchantId: string;
  staffMembershipId: string;
  userId: string;
  email: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  staffStatus: StaffStatus;
  userStatus: AccountStatus;
  merchantStatus: MerchantStatus;
}

@Injectable()
export class StaffInvitationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: {
      merchantId: string;
      staffMembershipId: string;
      tokenHash: string;
      invitedByUserId: string;
      expiresAt: Date;
    },
    db: DbClient,
  ): Promise<void> {
    await db.staffInvitation.create({ data });
  }

  /** Invalidates every outstanding invitation of one membership (used on reissue and deactivation). */
  async revokePending(
    merchantId: string,
    staffMembershipId: string,
    now: Date,
    db: DbClient,
  ): Promise<number> {
    const res = await db.staffInvitation.updateMany({
      where: { merchantId, staffMembershipId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    return res.count;
  }

  async findByTokenHash(
    tokenHash: string,
    db: DbClient = this.prisma,
  ): Promise<InvitationRecord | null> {
    const row = await db.staffInvitation.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        merchantId: true,
        staffMembershipId: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        staffMembership: {
          select: {
            status: true,
            userId: true,
            user: { select: { email: true, status: true } },
            merchant: { select: { status: true } },
          },
        },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      merchantId: row.merchantId,
      staffMembershipId: row.staffMembershipId,
      userId: row.staffMembership.userId,
      email: row.staffMembership.user.email,
      expiresAt: row.expiresAt,
      acceptedAt: row.acceptedAt,
      revokedAt: row.revokedAt,
      staffStatus: row.staffMembership.status,
      userStatus: row.staffMembership.user.status,
      merchantStatus: row.staffMembership.merchant.status,
    };
  }

  /** Race-safe single use: only one caller can flip a pending invitation to accepted. */
  async markAccepted(id: string, now: Date, db: DbClient): Promise<boolean> {
    const res = await db.staffInvitation.updateMany({
      where: { id, acceptedAt: null, revokedAt: null },
      data: { acceptedAt: now },
    });
    return res.count === 1;
  }

  /** Completes onboarding: sets the chosen password and activates the membership. */
  async activateAccount(
    input: {
      userId: string;
      merchantId: string;
      staffMembershipId: string;
      passwordHash: string;
      displayName?: string;
      now: Date;
    },
    db: DbClient,
  ): Promise<void> {
    await db.platformUser.update({
      where: { id: input.userId },
      data: {
        passwordHash: input.passwordHash,
        failedLoginCount: 0,
        lockedUntil: null,
        ...(input.displayName ? { displayName: input.displayName } : {}),
      },
    });
    await db.staffMembership.updateMany({
      where: { id: input.staffMembershipId, merchantId: input.merchantId, status: 'INVITED' },
      data: { status: 'ACTIVE', activatedAt: input.now },
    });
  }
}

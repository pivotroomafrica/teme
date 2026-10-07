import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { DbClient } from '../../../database/db-client';
import { PrismaService } from '../../../database/prisma.service';
import { EXPORT_EVENT_CAP, type RawCustomerData } from '../domain/customer-export';

/** Every query is scoped by merchantId. Ledger and audit tables are only ever read here. */
@Injectable()
export class PrivacyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async collect(
    merchantId: string,
    customerId: string,
    db: DbClient = this.prisma,
  ): Promise<RawCustomerData | null> {
    const customer = await db.customer.findFirst({
      where: { id: customerId, merchantId },
      select: {
        id: true,
        firstName: true,
        phoneE164: true,
        preferredLanguage: true,
        status: true,
        createdAt: true,
        anonymizedAt: true,
        merchant: { select: { nameEn: true } },
        consents: {
          orderBy: { occurredAt: 'asc' },
          select: { type: true, action: true, version: true, source: true, occurredAt: true },
        },
        memberships: {
          orderBy: { joinedAt: 'asc' },
          select: {
            id: true,
            status: true,
            joinedAt: true,
            deactivatedAt: true,
            program: { select: { nameEn: true, nameAm: true } },
            walletPasses: {
              orderBy: { createdAt: 'asc' },
              select: { provider: true, status: true, createdAt: true },
            },
            stampEvents: {
              orderBy: { occurredAt: 'asc' },
              take: EXPORT_EVENT_CAP,
              select: {
                id: true,
                occurredAt: true,
                branch: { select: { nameEn: true } },
                reversal: { select: { id: true } },
              },
            },
            redemptionEvents: {
              orderBy: { occurredAt: 'asc' },
              take: EXPORT_EVENT_CAP,
              select: {
                id: true,
                occurredAt: true,
                branch: { select: { nameEn: true } },
                reversal: { select: { id: true } },
              },
            },
            reversalEvents: {
              orderBy: { occurredAt: 'asc' },
              select: { occurredAt: true, targetType: true, reason: true },
            },
            rewardUnlocks: {
              orderBy: { unlockedAt: 'asc' },
              select: { unlockedAt: true, expiresAt: true },
            },
          },
        },
      },
    });
    if (!customer) return null;
    return {
      merchantName: customer.merchant.nameEn,
      customer: {
        id: customer.id,
        firstName: customer.firstName,
        phoneE164: customer.phoneE164,
        preferredLanguage: customer.preferredLanguage,
        status: customer.status,
        createdAt: customer.createdAt,
        anonymizedAt: customer.anonymizedAt,
      },
      consents: customer.consents,
      memberships: customer.memberships.map((m) => ({
        id: m.id,
        status: m.status,
        joinedAt: m.joinedAt,
        deactivatedAt: m.deactivatedAt,
        program: m.program,
        walletPasses: m.walletPasses,
        stamps: m.stampEvents.map((s) => ({
          id: s.id,
          occurredAt: s.occurredAt,
          branchName: s.branch.nameEn,
          reversed: s.reversal !== null,
        })),
        redemptions: m.redemptionEvents.map((r) => ({
          id: r.id,
          occurredAt: r.occurredAt,
          branchName: r.branch.nameEn,
          reversed: r.reversal !== null,
        })),
        reversals: m.reversalEvents,
        rewardUnlocks: m.rewardUnlocks,
      })),
    };
  }

  /** Rewards the customer could still claim: not expired, not redeemed, and earned by a stamp still standing. */
  async outstandingRewards(
    merchantId: string,
    customerId: string,
    now: Date,
    db: DbClient = this.prisma,
  ): Promise<number> {
    const rows = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n
      FROM reward_unlocks ru
      JOIN customer_memberships m ON m.id = ru.membership_id AND m.merchant_id = ru.merchant_id
      WHERE ru.merchant_id = ${merchantId}::uuid
        AND m.customer_id = ${customerId}::uuid
        AND (ru.expires_at IS NULL OR ru.expires_at > ${now})
        AND NOT EXISTS (
          SELECT 1 FROM redemption_events re
          WHERE re.reward_unlock_id = ru.id
            AND NOT EXISTS (SELECT 1 FROM reversal_events rv WHERE rv.redemption_event_id = re.id)
        )
        AND NOT EXISTS (SELECT 1 FROM reversal_events rv WHERE rv.stamp_event_id = ru.triggering_stamp_id)`;
    return Number(rows[0]?.n ?? 0);
  }

  /** Locks the memberships of one customer (serialises with scans) and returns their ids. */
  async lockMemberships(merchantId: string, customerId: string, db: DbClient): Promise<string[]> {
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM customer_memberships
      WHERE merchant_id = ${merchantId}::uuid AND customer_id = ${customerId}::uuid
      ORDER BY id
      FOR UPDATE`;
    return rows.map((r) => r.id);
  }

  /**
   * Irreversibly removes the personal data. The phone number is freed (a new sign-up with it starts a new
   * customer), every card token is replaced by an unguessable value, and cached scanner answers that
   * might quote the name are dropped. Ledger and audit rows contain no personal data and stay.
   */
  async anonymize(
    merchantId: string,
    customerId: string,
    membershipIds: string[],
    now: Date,
    db: DbClient,
  ): Promise<void> {
    await db.customer.updateMany({
      where: { id: customerId, merchantId },
      data: { firstName: null, phoneE164: null, status: 'ANONYMIZED', anonymizedAt: now },
    });
    for (const id of membershipIds) {
      await db.customerMembership.updateMany({
        where: { id, merchantId },
        data: {
          status: 'INACTIVE',
          deactivatedAt: now,
          tokenHash: `anon:${randomBytes(24).toString('hex')}`,
        },
      });
    }
    if (membershipIds.length > 0) {
      await db.idempotencyRecord.deleteMany({
        where: { merchantId, membershipId: { in: membershipIds } },
      });
    }
  }

  /** Active customers with no activity since the cutoff and no reward left to claim. */
  async inactiveCandidates(
    merchantId: string,
    cutoff: Date,
    now: Date,
    limit: number,
  ): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT c.id
      FROM customers c
      WHERE c.merchant_id = ${merchantId}::uuid
        AND c.status = 'ACTIVE'
        AND c.created_at < ${cutoff}
        AND NOT EXISTS (
          SELECT 1 FROM stamp_events s
          JOIN customer_memberships m ON m.id = s.membership_id
          WHERE m.customer_id = c.id AND s.occurred_at >= ${cutoff})
        AND NOT EXISTS (
          SELECT 1 FROM redemption_events r
          JOIN customer_memberships m ON m.id = r.membership_id
          WHERE m.customer_id = c.id AND r.occurred_at >= ${cutoff})
        AND NOT EXISTS (
          SELECT 1 FROM reward_unlocks ru
          JOIN customer_memberships m ON m.id = ru.membership_id
          WHERE m.customer_id = c.id
            AND (ru.expires_at IS NULL OR ru.expires_at > ${now})
            AND NOT EXISTS (
              SELECT 1 FROM redemption_events re
              WHERE re.reward_unlock_id = ru.id
                AND NOT EXISTS (SELECT 1 FROM reversal_events rv WHERE rv.redemption_event_id = re.id))
            AND NOT EXISTS (SELECT 1 FROM reversal_events rv WHERE rv.stamp_event_id = ru.triggering_stamp_id))
      ORDER BY c.created_at
      LIMIT ${limit}`;
    return rows.map((r) => r.id);
  }

  /** Operational clean-up: rows that are expired or finished and hold no customer content. */
  async purgeOperational(limits: {
    idempotencyBefore: Date;
    refreshTokensBefore: Date;
    completedJobsBefore: Date;
  }): Promise<{ idempotency: number; refreshTokens: number; outboxJobs: number }> {
    const idempotency = await this.prisma.idempotencyRecord.deleteMany({
      where: { expiresAt: { lt: limits.idempotencyBefore } },
    });
    const refreshTokens = await this.prisma.refreshToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: limits.refreshTokensBefore } },
          { revokedAt: { lt: limits.refreshTokensBefore } },
        ],
      },
    });
    const outboxJobs = await this.prisma.outboxJob.deleteMany({
      where: { status: 'COMPLETED', completedAt: { lt: limits.completedJobsBefore } },
    });
    return {
      idempotency: idempotency.count,
      refreshTokens: refreshTokens.count,
      outboxJobs: outboxJobs.count,
    };
  }
}

import { Injectable } from '@nestjs/common';
import type { MembershipStatus } from '@prisma/client';
import type { DbClient } from '../../../database/db-client';
import { PrismaService } from '../../../database/prisma.service';

export interface MembershipRecord {
  id: string;
  merchantId: string;
  customerId: string;
  programId: string;
  status: MembershipStatus;
}

const select = {
  id: true,
  merchantId: true,
  customerId: true,
  programId: true,
  status: true,
} as const;

/** Every lookup except the token lookup is scoped by merchantId. */
@Injectable()
export class MembershipsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByCustomerAndProgram(
    merchantId: string,
    customerId: string,
    programId: string,
    db: DbClient = this.prisma,
  ): Promise<MembershipRecord | null> {
    return db.customerMembership.findFirst({
      where: { merchantId, customerId, programId },
      select,
    });
  }

  findById(
    merchantId: string,
    id: string,
    db: DbClient = this.prisma,
  ): Promise<MembershipRecord | null> {
    return db.customerMembership.findFirst({ where: { id, merchantId }, select });
  }

  /** The token IS the credential, so this is the one lookup that is not tenant-scoped up front. */
  findByTokenHash(tokenHash: string, db: DbClient = this.prisma): Promise<MembershipRecord | null> {
    return db.customerMembership.findUnique({ where: { tokenHash }, select });
  }

  /** Tenant-scoped token lookup without locking (read-only eligibility checks). */
  findByTokenHashForMerchant(
    merchantId: string,
    tokenHash: string,
    db: DbClient = this.prisma,
  ): Promise<MembershipRecord | null> {
    return db.customerMembership.findFirst({
      where: {
        merchantId,
        OR: [
          { tokenHash },
          // A wallet pass's own barcode identifies the membership while that pass is ACTIVE.
          { walletPasses: { some: { barcodeHash: tokenHash, status: 'ACTIVE' } } },
        ],
      },
      select,
    });
  }

  /**
   * Tenant-scoped token lookup that row-locks the membership until the transaction ends. Two scans of
   * one card therefore run one after the other, which makes "check cooldown, then insert the stamp"
   * atomic. A token belonging to another merchant simply finds nothing.
   */
  async lockByTokenHash(
    merchantId: string,
    tokenHash: string,
    db: DbClient,
  ): Promise<MembershipRecord | null> {
    const rows = await db.$queryRaw<
      Array<{ id: string; customer_id: string; program_id: string; status: MembershipStatus }>
    >`
      SELECT m.id, m.customer_id, m.program_id, m.status::text AS status
      FROM customer_memberships m
      WHERE m.merchant_id = ${merchantId}::uuid
        AND (
          m.token_hash = ${tokenHash}
          OR EXISTS (
            SELECT 1 FROM wallet_passes p
            WHERE p.membership_id = m.id AND p.barcode_hash = ${tokenHash} AND p.status = 'ACTIVE'
          )
        )
      FOR UPDATE OF m`;
    const r = rows[0];
    return r
      ? {
          id: r.id,
          merchantId,
          customerId: r.customer_id,
          programId: r.program_id,
          status: r.status,
        }
      : null;
  }

  /** Row-locks one membership by id (used by reversals) so it serialises with scans and redemptions. */
  async lockById(merchantId: string, id: string, db: DbClient): Promise<MembershipRecord | null> {
    const rows = await db.$queryRaw<
      Array<{ customer_id: string; program_id: string; status: MembershipStatus }>
    >`
      SELECT customer_id, program_id, status::text AS status FROM customer_memberships
      WHERE id = ${id}::uuid AND merchant_id = ${merchantId}::uuid
      FOR UPDATE`;
    const r = rows[0];
    return r
      ? { id, merchantId, customerId: r.customer_id, programId: r.program_id, status: r.status }
      : null;
  }

  async create(
    data: { merchantId: string; customerId: string; programId: string; tokenHash: string },
    db: DbClient,
  ): Promise<string> {
    const row = await db.customerMembership.create({ data, select: { id: true } });
    return row.id;
  }

  /** The always-available web fallback pass. Apple/Google passes are created by the wallet module. */
  async ensureWebPass(merchantId: string, membershipId: string, db: DbClient): Promise<void> {
    const existing = await db.walletPass.findFirst({
      where: { merchantId, membershipId, provider: 'WEB', status: { not: 'INVALIDATED' } },
      select: { id: true },
    });
    if (existing) return;
    await db.walletPass.create({
      data: { merchantId, membershipId, provider: 'WEB', status: 'ACTIVE', syncStatus: 'SYNCED' },
    });
  }

  async setStatus(
    merchantId: string,
    id: string,
    status: 'ACTIVE' | 'INACTIVE',
    now: Date,
    db: DbClient,
  ): Promise<void> {
    await db.customerMembership.updateMany({
      where: { id, merchantId },
      data: { status, deactivatedAt: status === 'INACTIVE' ? now : null },
    });
  }

  /** Replaces the card token; the old one stops working at once. */
  async rotateToken(
    merchantId: string,
    id: string,
    tokenHash: string,
    db: DbClient,
  ): Promise<boolean> {
    const res = await db.customerMembership.updateMany({
      where: { id, merchantId },
      data: { tokenHash },
    });
    if (res.count !== 1) return false;
    // Passes embed the barcode, so they must be refreshed (processed by the wallet step).
    await this.markPassesStale(merchantId, id, db);
    return true;
  }

  /** Flags every wallet pass of the membership for refresh (new content to push). */
  async markPassesStale(merchantId: string, membershipId: string, db: DbClient): Promise<void> {
    await db.walletPass.updateMany({
      where: { merchantId, membershipId },
      data: { passVersion: { increment: 1 }, syncStatus: 'PENDING' },
    });
  }
}

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { DbClient } from '../../../database/db-client';
import { PrismaService } from '../../../database/prisma.service';

export interface NewStamp {
  merchantId: string;
  branchId: string;
  programId: string;
  membershipId: string;
  staffMembershipId: string;
  idempotencyKey: string;
  deviceMetadata?: Record<string, unknown>;
  occurredAt: Date;
}

export interface StampRecord {
  id: string;
  membershipId: string;
  programId: string;
  branchId: string;
  occurredAt: Date;
  reversed: boolean;
}

/**
 * Access to the append-only stamp and unlock ledgers. There is intentionally no update or delete,
 * and every method is scoped by merchantId.
 */
@Injectable()
export class StampsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Database wall-clock time: one consistent clock for ordering and cooldown across app instances. */
  async dbNow(db: DbClient = this.prisma): Promise<Date> {
    const rows = await db.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    return (rows[0] as { now: Date }).now;
  }

  /** Time of the latest stamp that has not been reversed (a reversed visit does not count). */
  async lastEffectiveStampAt(
    merchantId: string,
    membershipId: string,
    db: DbClient = this.prisma,
  ): Promise<Date | null> {
    const row = await db.stampEvent.findFirst({
      where: { merchantId, membershipId, reversal: { is: null } },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      select: { occurredAt: true },
    });
    return row?.occurredAt ?? null;
  }

  /** Stamps that currently count toward progress: the ledger minus reversed stamps. */
  countEffective(
    merchantId: string,
    membershipId: string,
    db: DbClient = this.prisma,
  ): Promise<number> {
    return db.stampEvent.count({ where: { merchantId, membershipId, reversal: { is: null } } });
  }

  async createStamp(stamp: NewStamp, db: DbClient): Promise<{ id: string; occurredAt: Date }> {
    return db.stampEvent.create({
      data: {
        ...stamp,
        deviceMetadata: stamp.deviceMetadata as Prisma.InputJsonValue | undefined,
      },
      select: { id: true, occurredAt: true },
    });
  }

  /** One stamp of this merchant, with whether it has been reversed. */
  async findById(
    merchantId: string,
    id: string,
    db: DbClient = this.prisma,
  ): Promise<StampRecord | null> {
    const row = await db.stampEvent.findFirst({
      where: { id, merchantId },
      select: {
        id: true,
        membershipId: true,
        programId: true,
        branchId: true,
        occurredAt: true,
        reversal: { select: { id: true } },
      },
    });
    return row
      ? {
          id: row.id,
          membershipId: row.membershipId,
          programId: row.programId,
          branchId: row.branchId,
          occurredAt: row.occurredAt,
          reversed: row.reversal !== null,
        }
      : null;
  }

  /** Newest first. Used for the manager ledger view; the cap keeps responses bounded. */
  async listForMembership(
    merchantId: string,
    membershipId: string,
    limit: number,
    db: DbClient = this.prisma,
  ): Promise<
    Array<{
      id: string;
      branchId: string;
      staffMembershipId: string;
      occurredAt: Date;
      reversed: boolean;
    }>
  > {
    const rows = await db.stampEvent.findMany({
      where: { merchantId, membershipId },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        branchId: true,
        staffMembershipId: true,
        occurredAt: true,
        reversal: { select: { id: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      branchId: r.branchId,
      staffMembershipId: r.staffMembershipId,
      occurredAt: r.occurredAt,
      reversed: r.reversal !== null,
    }));
  }
}

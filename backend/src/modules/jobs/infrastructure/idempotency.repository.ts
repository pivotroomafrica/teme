import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { DbClient } from '../../../database/db-client';
import { PrismaService } from '../../../database/prisma.service';

export interface StoredResponse {
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
}

/**
 * Remembers the outcome of state-changing requests per (staff member, operation, key), so a retry
 * returns the original result instead of repeating the work.
 */
@Injectable()
export class IdempotencyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async find(
    staffMembershipId: string,
    operation: string,
    key: string,
    db: DbClient = this.prisma,
  ): Promise<StoredResponse | null> {
    const row = await db.idempotencyRecord.findUnique({
      where: { staffMembershipId_operation_key: { staffMembershipId, operation, key } },
      select: { requestHash: true, responseStatus: true, responseBody: true, expiresAt: true },
    });
    // Expired records behave as absent (a cleanup job removes them later).
    if (!row || row.expiresAt.getTime() <= Date.now()) return null;
    return {
      requestHash: row.requestHash,
      responseStatus: row.responseStatus,
      responseBody: row.responseBody,
    };
  }

  async store(
    data: {
      merchantId: string;
      staffMembershipId: string;
      operation: string;
      key: string;
      membershipId?: string | null;
      requestHash: string;
      responseStatus: number;
      responseBody: unknown;
      expiresAt: Date;
    },
    db: DbClient,
  ): Promise<void> {
    await db.idempotencyRecord.create({
      data: { ...data, responseBody: data.responseBody as Prisma.InputJsonValue },
    });
  }
}

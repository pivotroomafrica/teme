import { Injectable } from '@nestjs/common';
import type { DbClient } from '../../../database/db-client';
import { PrismaService } from '../../../database/prisma.service';

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface NewRefreshToken {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  deviceLabel?: string;
  userAgent?: string;
}

@Injectable()
export class RefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: NewRefreshToken, db: DbClient = this.prisma): Promise<void> {
    await db.refreshToken.create({ data });
  }

  findByHash(tokenHash: string, db: DbClient = this.prisma): Promise<RefreshTokenRecord | null> {
    return db.refreshToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, familyId: true, expiresAt: true, revokedAt: true },
    });
  }

  /** Returns true only for the caller that actually flipped the token to revoked (race-safe). */
  async revokeIfActive(
    id: string,
    reason: string,
    now: Date,
    replacedByTokenId?: string,
    db: DbClient = this.prisma,
  ): Promise<boolean> {
    const res = await db.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason, replacedByTokenId: replacedByTokenId ?? null },
    });
    return res.count === 1;
  }

  async revokeFamily(
    familyId: string,
    reason: string,
    now: Date,
    db: DbClient = this.prisma,
  ): Promise<number> {
    const res = await db.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
    return res.count;
  }

  async revokeAllForUser(
    userId: string,
    reason: string,
    now: Date,
    db: DbClient = this.prisma,
  ): Promise<number> {
    const res = await db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
    return res.count;
  }
}

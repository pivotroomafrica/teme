import { Injectable } from '@nestjs/common';
import type { WalletPassStatus, WalletProvider, WalletSyncStatus } from '@prisma/client';
import type { DbClient } from '../../../database/db-client';
import { PrismaService } from '../../../database/prisma.service';

export interface PassRow {
  id: string;
  merchantId: string;
  membershipId: string;
  provider: WalletProvider;
  status: WalletPassStatus;
  providerPassId: string | null;
  passVersion: number;
  lastSyncedVersion: number;
  syncStatus: WalletSyncStatus;
  barcodeVersion: number;
  lastSyncedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const select = {
  id: true,
  merchantId: true,
  membershipId: true,
  provider: true,
  status: true,
  providerPassId: true,
  passVersion: true,
  lastSyncedVersion: true,
  syncStatus: true,
  barcodeVersion: true,
  lastSyncedAt: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Wallet passes and Apple device registrations. Tenant-scoped except the Apple lookups by pass id. */
@Injectable()
export class WalletPassesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The live (non-invalidated) pass of a provider for a membership. */
  findLive(
    merchantId: string,
    membershipId: string,
    provider: WalletProvider,
    db: DbClient = this.prisma,
  ): Promise<PassRow | null> {
    return db.walletPass.findFirst({
      where: { merchantId, membershipId, provider, status: { not: 'INVALIDATED' } },
      select,
    });
  }

  findById(merchantId: string, id: string, db: DbClient = this.prisma): Promise<PassRow | null> {
    return db.walletPass.findFirst({ where: { id, merchantId }, select });
  }

  /**
   * Apple and download links address a pass by its serial number alone; the pass itself tells us the
   * tenant. Only use this where the caller has proven access to that exact pass.
   */
  findAnyTenantById(id: string, db: DbClient = this.prisma): Promise<PassRow | null> {
    return db.walletPass.findUnique({ where: { id }, select });
  }

  listForMembership(
    merchantId: string,
    membershipId: string,
    db: DbClient = this.prisma,
  ): Promise<PassRow[]> {
    return db.walletPass.findMany({
      where: { merchantId, membershipId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select,
    });
  }

  /** Passes that still owe the provider an update (never confirmed, newer than last delivery, or failed). */
  async listStale(
    merchantId: string,
    membershipId: string,
    db: DbClient = this.prisma,
  ): Promise<PassRow[]> {
    const rows = await this.listForMembership(merchantId, membershipId, db);
    return rows.filter((p) =>
      p.status !== 'PENDING'
        ? p.passVersion > p.lastSyncedVersion || p.syncStatus === 'FAILED'
        : true,
    );
  }

  async create(
    data: {
      id: string;
      merchantId: string;
      membershipId: string;
      provider: WalletProvider;
      barcodeHash: string | null;
    },
    db: DbClient = this.prisma,
  ): Promise<PassRow> {
    return db.walletPass.create({
      data: { ...data, status: 'PENDING', syncStatus: 'PENDING' },
      select,
    });
  }

  /** The provider confirmed the pass exists: it becomes ACTIVE and is considered delivered at its version. */
  async markCreated(
    id: string,
    providerPassId: string,
    version: number,
    db: DbClient = this.prisma,
  ): Promise<void> {
    await db.walletPass.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: 'ACTIVE',
        providerPassId,
        lastSyncedVersion: version,
        syncStatus: 'SYNCED',
        lastSyncedAt: new Date(),
        lastError: null,
      },
    });
  }

  /**
   * Records that `version` reached the provider. If the pass moved on meanwhile (a newer stamp), it
   * stays PENDING so the next job delivers the newer content.
   */
  async markSynced(id: string, version: number, db: DbClient = this.prisma): Promise<void> {
    await db.$executeRaw`
      UPDATE wallet_passes
      SET last_synced_version = GREATEST(last_synced_version, ${version}),
          last_synced_at = clock_timestamp(),
          last_error = NULL,
          sync_status = CASE WHEN pass_version > ${version} THEN 'PENDING'::wallet_sync_status
                             ELSE 'SYNCED'::wallet_sync_status END
      WHERE id = ${id}::uuid`;
  }

  async markFailed(id: string, error: string, db: DbClient = this.prisma): Promise<void> {
    await db.walletPass.updateMany({
      where: { id },
      data: { syncStatus: 'FAILED', lastError: error.slice(0, 500) },
    });
  }

  /** Flags a pass for refresh (new content to push). */
  async bumpVersion(id: string, db: DbClient = this.prisma): Promise<void> {
    await db.walletPass.updateMany({
      where: { id },
      data: { passVersion: { increment: 1 }, syncStatus: 'PENDING' },
    });
  }

  async setStatus(id: string, status: WalletPassStatus, db: DbClient = this.prisma): Promise<void> {
    await db.walletPass.updateMany({
      where: { id },
      data: { status, passVersion: { increment: 1 }, syncStatus: 'PENDING' },
    });
  }

  // ───────── Apple device registrations ─────────

  /** Returns true when a new registration was created (Apple expects 201 vs 200). */
  async upsertRegistration(
    pass: { id: string; merchantId: string },
    deviceLibraryIdentifier: string,
    pushToken: string,
    db: DbClient = this.prisma,
  ): Promise<boolean> {
    const existing = await db.appleDeviceRegistration.findUnique({
      where: {
        walletPassId_deviceLibraryIdentifier: { walletPassId: pass.id, deviceLibraryIdentifier },
      },
      select: { id: true },
    });
    if (existing) {
      await db.appleDeviceRegistration.update({ where: { id: existing.id }, data: { pushToken } });
      return false;
    }
    await db.appleDeviceRegistration.create({
      data: {
        merchantId: pass.merchantId,
        walletPassId: pass.id,
        deviceLibraryIdentifier,
        pushToken,
      },
    });
    return true;
  }

  async removeRegistration(
    walletPassId: string,
    deviceLibraryIdentifier: string,
    db: DbClient = this.prisma,
  ): Promise<void> {
    await db.appleDeviceRegistration.deleteMany({
      where: { walletPassId, deviceLibraryIdentifier },
    });
  }

  /** Forgets every Apple device registration of a pass (device ids and push tokens are personal data). */
  async deleteRegistrationsForPass(
    walletPassId: string,
    db: DbClient = this.prisma,
  ): Promise<number> {
    const res = await db.appleDeviceRegistration.deleteMany({ where: { walletPassId } });
    return res.count;
  }

  pushTargets(
    walletPassId: string,
    db: DbClient = this.prisma,
  ): Promise<Array<{ deviceLibraryIdentifier: string; pushToken: string }>> {
    return db.appleDeviceRegistration.findMany({
      where: { walletPassId },
      select: { deviceLibraryIdentifier: true, pushToken: true },
    });
  }

  /** Serial numbers (pass ids) registered to a device, optionally only those changed after `since`. */
  async serialsForDevice(
    deviceLibraryIdentifier: string,
    since: Date | null,
    db: DbClient = this.prisma,
  ): Promise<Array<{ serial: string; updatedAt: Date }>> {
    const rows = await db.appleDeviceRegistration.findMany({
      where: {
        deviceLibraryIdentifier,
        walletPass: { provider: 'APPLE', ...(since ? { updatedAt: { gt: since } } : {}) },
      },
      select: { walletPass: { select: { id: true, updatedAt: true } } },
    });
    return rows.map((r) => ({ serial: r.walletPass.id, updatedAt: r.walletPass.updatedAt }));
  }
}

import { Injectable } from '@nestjs/common';
import type { Language, MerchantStatus, Prisma } from '@prisma/client';
import type { DbClient } from '../../../database/db-client';
import { PrismaService } from '../../../database/prisma.service';

export interface ProfileRecord {
  id: string;
  slug: string;
  nameEn: string;
  nameAm: string | null;
  status: MerchantStatus;
  timezone: string;
  defaultLanguage: Language;
  joinReference: string;
  supportEmail: string | null;
  supportPhoneE164: string | null;
  logoStorageKey: string | null;
  logoContentType: string | null;
  defaultStampsRequired: number;
  defaultCooldownMinutes: number;
}

export interface ProfileChanges {
  merchant?: {
    nameEn?: string;
    nameAm?: string | null;
    timezone?: string;
    defaultLanguage?: Language;
  };
  settings?: {
    supportEmail?: string | null;
    supportPhoneE164?: string | null;
    defaultStampsRequired?: number;
    defaultCooldownMinutes?: number;
  };
}

/** The merchant row and its settings row are always addressed by the caller's merchantId. */
@Injectable()
export class MerchantProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  async get(merchantId: string, db: DbClient = this.prisma): Promise<ProfileRecord | null> {
    const m = await db.merchant.findUnique({
      where: { id: merchantId },
      select: {
        id: true,
        slug: true,
        nameEn: true,
        nameAm: true,
        status: true,
        timezone: true,
        defaultLanguage: true,
        joinReference: true,
        settings: {
          select: {
            supportEmail: true,
            supportPhoneE164: true,
            logoStorageKey: true,
            logoContentType: true,
            defaultStampsRequired: true,
            defaultCooldownMinutes: true,
          },
        },
      },
    });
    if (!m) return null;
    return {
      id: m.id,
      slug: m.slug,
      nameEn: m.nameEn,
      nameAm: m.nameAm,
      status: m.status,
      timezone: m.timezone,
      defaultLanguage: m.defaultLanguage,
      joinReference: m.joinReference,
      supportEmail: m.settings?.supportEmail ?? null,
      supportPhoneE164: m.settings?.supportPhoneE164 ?? null,
      logoStorageKey: m.settings?.logoStorageKey ?? null,
      logoContentType: m.settings?.logoContentType ?? null,
      defaultStampsRequired: m.settings?.defaultStampsRequired ?? 10,
      defaultCooldownMinutes: m.settings?.defaultCooldownMinutes ?? 0,
    };
  }

  /** Public join lookup: only the fields a join page may show. */
  findByJoinReference(
    joinReference: string,
    db: DbClient = this.prisma,
  ): Promise<{
    id: string;
    nameEn: string;
    nameAm: string | null;
    status: MerchantStatus;
    defaultLanguage: Language;
  } | null> {
    return db.merchant.findUnique({
      where: { joinReference },
      select: { id: true, nameEn: true, nameAm: true, status: true, defaultLanguage: true },
    });
  }

  async update(merchantId: string, changes: ProfileChanges, db: DbClient): Promise<void> {
    if (changes.merchant && Object.keys(changes.merchant).length > 0) {
      await db.merchant.update({ where: { id: merchantId }, data: changes.merchant });
    }
    if (changes.settings && Object.keys(changes.settings).length > 0) {
      await db.merchantSettings.upsert({
        where: { merchantId },
        update: changes.settings,
        create: { merchantId, ...changes.settings },
      });
    }
  }

  /** The per-merchant policy documents stored in merchant_settings (validated by their owning modules). */
  async getPolicies(
    merchantId: string,
    db: DbClient = this.prisma,
  ): Promise<{ fraudThresholds: unknown; retentionPolicy: unknown }> {
    const s = await db.merchantSettings.findUnique({
      where: { merchantId },
      select: { fraudThresholds: true, retentionPolicy: true },
    });
    return { fraudThresholds: s?.fraudThresholds ?? {}, retentionPolicy: s?.retentionPolicy ?? {} };
  }

  async setPolicy(
    merchantId: string,
    field: 'fraudThresholds' | 'retentionPolicy',
    value: Record<string, unknown>,
    db: DbClient,
  ): Promise<void> {
    const json = value as Prisma.InputJsonValue;
    await db.merchantSettings.upsert({
      where: { merchantId },
      update: { [field]: json },
      create: { merchantId, [field]: json },
    });
  }

  async listActiveMerchantIds(db: DbClient = this.prisma): Promise<string[]> {
    const rows = await db.merchant.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  async setLogo(
    merchantId: string,
    logo: { storageKey: string; contentType: string } | null,
    db: DbClient,
  ): Promise<void> {
    const data = {
      logoStorageKey: logo?.storageKey ?? null,
      logoContentType: logo?.contentType ?? null,
    };
    await db.merchantSettings.upsert({
      where: { merchantId },
      update: data,
      create: { merchantId, ...data },
    });
  }
}

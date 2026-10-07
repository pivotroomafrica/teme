import { Injectable } from '@nestjs/common';
import type { DbClient } from '../../../database/db-client';
import { MerchantProfileRepository } from '../infrastructure/merchant-profile.repository';

export interface JoinTarget {
  id: string;
  nameEn: string;
  nameAm: string | null;
  defaultLanguage: 'EN' | 'AM';
}

/** Read-only lookups other modules may use without touching merchant tables themselves. */
@Injectable()
export class MerchantDirectory {
  constructor(private readonly repository: MerchantProfileRepository) {}

  /** Returns null for unknown references and for merchants that are not ACTIVE. */
  async findJoinTarget(joinReference: string): Promise<JoinTarget | null> {
    const m = await this.repository.findByJoinReference(joinReference);
    if (!m || m.status !== 'ACTIVE') return null;
    return { id: m.id, nameEn: m.nameEn, nameAm: m.nameAm, defaultLanguage: m.defaultLanguage };
  }

  /** Names and contact details a customer-facing card may show. */
  async publicProfile(merchantId: string): Promise<{
    nameEn: string;
    nameAm: string | null;
    supportEmail: string | null;
    supportPhone: string | null;
  } | null> {
    const p = await this.repository.get(merchantId);
    return p
      ? {
          nameEn: p.nameEn,
          nameAm: p.nameAm,
          supportEmail: p.supportEmail,
          supportPhone: p.supportPhoneE164,
        }
      : null;
  }

  /** The merchant's configured IANA time zone (UTC if the merchant is unknown). */
  async timezone(merchantId: string): Promise<string> {
    return (await this.repository.get(merchantId))?.timezone ?? 'UTC';
  }

  /** Raw stored fraud thresholds (the fraud module merges and validates them). */
  async fraudThresholds(merchantId: string): Promise<unknown> {
    return (await this.repository.getPolicies(merchantId)).fraudThresholds;
  }
  async retentionPolicy(merchantId: string): Promise<unknown> {
    return (await this.repository.getPolicies(merchantId)).retentionPolicy;
  }
  setFraudThresholds(
    merchantId: string,
    value: Record<string, unknown>,
    db: DbClient,
  ): Promise<void> {
    return this.repository.setPolicy(merchantId, 'fraudThresholds', value, db);
  }
  setRetentionPolicy(
    merchantId: string,
    value: Record<string, unknown>,
    db: DbClient,
  ): Promise<void> {
    return this.repository.setPolicy(merchantId, 'retentionPolicy', value, db);
  }
  listActiveMerchantIds(): Promise<string[]> {
    return this.repository.listActiveMerchantIds();
  }

  async programDefaults(
    merchantId: string,
  ): Promise<{ stampsRequired: number; cooldownMinutes: number }> {
    const p = await this.repository.get(merchantId);
    return {
      stampsRequired: p?.defaultStampsRequired ?? 10,
      cooldownMinutes: p?.defaultCooldownMinutes ?? 0,
    };
  }
}

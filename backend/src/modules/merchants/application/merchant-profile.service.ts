import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { RequestMeta } from '../../../common/decorators/request-context.decorator';
import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { normalizeEthiopianPhone } from '../../../common/phone/ethiopian-phone';
import { TransactionManager } from '../../../database/transaction-manager';
import { AuditService } from '../../audit';
import type { MerchantActor } from '../../tenancy';
import { isValidTimezone } from '../domain/timezone';
import {
  MerchantProfileRepository,
  ProfileChanges,
  ProfileRecord,
} from '../infrastructure/merchant-profile.repository';

export interface UpdateProfileInput {
  nameEn?: string;
  nameAm?: string | null;
  timezone?: string;
  defaultLanguage?: 'EN' | 'AM';
  supportEmail?: string | null;
  supportPhone?: string | null;
  defaultStampsRequired?: number;
  defaultCooldownMinutes?: number;
}

export const LOGO_CONTENT_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
} as const;

const validation = (message: string) => new DomainError(ErrorCode.VALIDATION_FAILED, message, 400);

@Injectable()
export class MerchantProfileService {
  constructor(
    private readonly repository: MerchantProfileRepository,
    private readonly audit: AuditService,
    private readonly transactions: TransactionManager,
  ) {}

  async get(actor: MerchantActor): Promise<ProfileRecord> {
    const profile = await this.repository.get(actor.merchantId);
    if (!profile) throw new DomainError(ErrorCode.NOT_FOUND, 'Merchant not found.', 404);
    return profile;
  }

  async update(
    actor: MerchantActor,
    input: UpdateProfileInput,
    meta: RequestMeta,
  ): Promise<ProfileRecord> {
    if (Object.values(input).every((v) => v === undefined)) {
      throw validation('Provide at least one field to update.');
    }
    if (input.timezone !== undefined && !isValidTimezone(input.timezone)) {
      throw validation('Unknown timezone. Use an IANA name such as "Africa/Addis_Ababa".');
    }
    let supportPhone: string | null | undefined;
    if (input.supportPhone !== undefined) {
      supportPhone =
        input.supportPhone === null ? null : normalizeEthiopianPhone(input.supportPhone);
      if (supportPhone === undefined || (input.supportPhone !== null && supportPhone === null)) {
        throw validation('Support phone must be a valid Ethiopian phone number.');
      }
    }

    return this.transactions.run(async (db) => {
      const current = await this.repository.get(actor.merchantId, db);
      if (!current) throw new DomainError(ErrorCode.NOT_FOUND, 'Merchant not found.', 404);

      const next: ProfileChanges = { merchant: {}, settings: {} };
      const changed: string[] = [];
      const set = <K extends string, V>(
        field: K,
        newValue: V | undefined,
        currentValue: V,
        target: Record<string, unknown>,
        column: string,
      ) => {
        if (newValue !== undefined && newValue !== currentValue) {
          target[column] = newValue;
          changed.push(field);
        }
      };
      set('nameEn', input.nameEn?.trim(), current.nameEn, next.merchant!, 'nameEn');
      set(
        'nameAm',
        input.nameAm === null ? null : input.nameAm?.trim(),
        current.nameAm,
        next.merchant!,
        'nameAm',
      );
      set('timezone', input.timezone, current.timezone, next.merchant!, 'timezone');
      set(
        'defaultLanguage',
        input.defaultLanguage,
        current.defaultLanguage,
        next.merchant!,
        'defaultLanguage',
      );
      set(
        'supportEmail',
        input.supportEmail === null ? null : input.supportEmail?.toLowerCase(),
        current.supportEmail,
        next.settings!,
        'supportEmail',
      );
      set(
        'supportPhone',
        supportPhone,
        current.supportPhoneE164,
        next.settings!,
        'supportPhoneE164',
      );
      set(
        'defaultStampsRequired',
        input.defaultStampsRequired,
        current.defaultStampsRequired,
        next.settings!,
        'defaultStampsRequired',
      );
      set(
        'defaultCooldownMinutes',
        input.defaultCooldownMinutes,
        current.defaultCooldownMinutes,
        next.settings!,
        'defaultCooldownMinutes',
      );

      if (changed.length === 0) return current;
      await this.repository.update(actor.merchantId, next, db);
      // Field names only: contact details are personal data and stay out of the audit trail.
      await this.audit.record(
        {
          action: 'merchant.profile_updated',
          actorUserId: actor.userId,
          merchantId: actor.merchantId,
          targetType: 'merchant',
          targetId: actor.merchantId,
          requestId: meta.requestId,
          metadata: { changedFields: changed },
        },
        db,
      );
      return (await this.repository.get(actor.merchantId, db)) as ProfileRecord;
    });
  }

  /**
   * Records logo metadata and reserves a storage key under the merchant's own prefix.
   * File storage is not implemented yet: a later step will hand out an upload URL for this key.
   */
  async setLogo(
    actor: MerchantActor,
    contentType: keyof typeof LOGO_CONTENT_TYPES,
    meta: RequestMeta,
  ): Promise<{ storageKey: string; contentType: string }> {
    const ext = LOGO_CONTENT_TYPES[contentType];
    if (!ext) throw validation('Unsupported logo type.');
    const logo = {
      storageKey: `merchants/${actor.merchantId}/logo/${randomUUID()}.${ext}`,
      contentType,
    };
    await this.transactions.run(async (db) => {
      await this.repository.setLogo(actor.merchantId, logo, db);
      await this.audit.record(
        {
          action: 'merchant.logo_updated',
          actorUserId: actor.userId,
          merchantId: actor.merchantId,
          targetType: 'merchant',
          targetId: actor.merchantId,
          requestId: meta.requestId,
          metadata: { contentType },
        },
        db,
      );
    });
    return logo;
  }

  async clearLogo(actor: MerchantActor, meta: RequestMeta): Promise<void> {
    await this.transactions.run(async (db) => {
      await this.repository.setLogo(actor.merchantId, null, db);
      await this.audit.record(
        {
          action: 'merchant.logo_removed',
          actorUserId: actor.userId,
          merchantId: actor.merchantId,
          targetType: 'merchant',
          targetId: actor.merchantId,
          requestId: meta.requestId,
        },
        db,
      );
    });
  }
}

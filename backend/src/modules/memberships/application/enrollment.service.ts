import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RequestMeta } from '../../../common/decorators/request-context.decorator';
import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { normalizeEthiopianPhone } from '../../../common/phone/ethiopian-phone';
import type { Env } from '../../../config/env.schema';
import { TransactionManager } from '../../../database/transaction-manager';
import { AuditService } from '../../audit';
import { CURRENT_CONSENT_VERSION, ConsentRepository, CustomersRepository } from '../../customers';
import { ProgramRecord, ProgramsRepository } from '../../loyalty-programs';
import { MerchantDirectory } from '../../merchants';
import { newCardToken } from '../domain/card-token';
import { MembershipsRepository } from '../infrastructure/memberships.repository';

export interface EnrollInput {
  phone: string;
  firstName: string;
  preferredLanguage: 'EN' | 'AM';
  acceptTerms: boolean;
  marketingConsent?: boolean;
  consentVersion?: string;
}

export interface WalletOption {
  provider: 'WEB' | 'APPLE' | 'GOOGLE';
  available: boolean;
  reason: 'NOT_CONFIGURED' | null;
  /** Add-to-wallet link; populated by the wallet step. */
  addUrl: string | null;
}

export interface JoinInfo {
  merchant: { nameEn: string; nameAm: string | null; defaultLanguage: 'EN' | 'AM' };
  program: {
    nameEn: string;
    nameAm: string | null;
    stampsRequired: number;
    brandColor: string | null;
    cardDisplay: Record<string, unknown>;
    termsEn: string | null;
    termsAm: string | null;
    reward: {
      nameEn: string;
      nameAm: string | null;
      descriptionEn: string | null;
      descriptionAm: string | null;
    } | null;
  };
  consent: { version: string };
  wallet: WalletOption[];
}

export interface EnrollmentResult extends JoinInfo {
  /** CREATED: new member (card issued now). EXISTING: already a member (no card is re-sent). */
  status: 'CREATED' | 'EXISTING';
  /** Echo of what the caller submitted, never stored data about an existing customer. */
  customer: { firstName: string; preferredLanguage: 'EN' | 'AM' };
  /** The opaque card token (QR / barcode value). Returned once, only for a new membership. */
  card: { token: string } | null;
}

/** Unknown reference, suspended merchant and "no joinable program" are indistinguishable. */
const notJoinable = () =>
  new DomainError(ErrorCode.NOT_FOUND, 'This join link is not available.', 404);

@Injectable()
export class EnrollmentService {
  constructor(
    private readonly directory: MerchantDirectory,
    private readonly programs: ProgramsRepository,
    private readonly customers: CustomersRepository,
    private readonly consents: ConsentRepository,
    private readonly memberships: MembershipsRepository,
    private readonly audit: AuditService,
    private readonly transactions: TransactionManager,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async joinInfo(joinReference: string): Promise<JoinInfo> {
    const target = await this.directory.findJoinTarget(joinReference);
    const program = target ? await this.programs.findActiveDefault(target.id) : null;
    if (!target || !program) throw notJoinable();
    return this.describe(target, program);
  }

  async enroll(
    joinReference: string,
    input: EnrollInput,
    meta: RequestMeta,
  ): Promise<EnrollmentResult> {
    const target = await this.directory.findJoinTarget(joinReference);
    if (!target) throw notJoinable();

    if (!input.acceptTerms) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, 'You must accept the terms to join.', 400);
    }
    if (input.consentVersion !== undefined && input.consentVersion !== CURRENT_CONSENT_VERSION) {
      throw new DomainError(
        'CONSENT_VERSION_STALE',
        'The terms have been updated. Please reload the page and review them.',
        409,
      );
    }
    const phone = normalizeEthiopianPhone(input.phone);
    if (!phone) {
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        'Enter a valid Ethiopian phone number.',
        400,
      );
    }
    const firstName = input.firstName.trim();

    // Two simultaneous sign-ups for one phone: the loser hits a unique index and simply retries,
    // finding the winner's rows.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.transactions.run(async (db) => {
          const program = await this.programs.findActiveDefault(target.id, db);
          if (!program) throw notJoinable();
          const lock = await this.programs.lockForEnrollment(target.id, program.id, db);
          if (!lock || lock.status !== 'ACTIVE' || !lock.isDefault) throw notJoinable();

          let customer = await this.customers.findByPhone(target.id, phone, db);
          const newCustomer = customer === null;
          let customerId = customer?.id;
          if (!customerId) {
            customerId = await this.customers.create(
              target.id,
              { phoneE164: phone, firstName, preferredLanguage: input.preferredLanguage },
              db,
            );
          } else if (!customer?.firstName) {
            await this.customers.fillMissing(target.id, customerId, { firstName }, db);
          }
          customer = null;

          const existing = await this.memberships.findByCustomerAndProgram(
            target.id,
            customerId,
            program.id,
            db,
          );
          let card: { token: string } | null = null;

          if (!existing) {
            const issued = newCardToken();
            const membershipId = await this.memberships.create(
              {
                merchantId: target.id,
                customerId,
                programId: program.id,
                tokenHash: issued.hash,
              },
              db,
            );
            await this.memberships.ensureWebPass(target.id, membershipId, db);
            card = { token: issued.token };

            // Consent is recorded for the person who actually signed up. Re-enrolling an existing
            // customer can never change their stored choices (a third party must not be able to
            // grant or withdraw consent for someone else's number).
            const history = (await this.consents.forCustomers(target.id, [customerId], db)).get(
              customerId,
            );
            const hasTerms = history?.some(
              (r) => r.type === 'LOYALTY_TERMS' && r.action === 'GRANTED',
            );
            await this.consents.append(
              target.id,
              [
                ...(hasTerms
                  ? []
                  : [
                      {
                        customerId,
                        type: 'LOYALTY_TERMS' as const,
                        action: 'GRANTED' as const,
                        version: CURRENT_CONSENT_VERSION,
                        source: 'JOIN_FORM' as const,
                      },
                    ]),
                ...(newCustomer && input.marketingConsent
                  ? [
                      {
                        customerId,
                        type: 'MARKETING' as const,
                        action: 'GRANTED' as const,
                        version: CURRENT_CONSENT_VERSION,
                        source: 'JOIN_FORM' as const,
                      },
                    ]
                  : []),
              ],
              db,
            );
            await this.audit.record(
              {
                action: 'customer.enrolled',
                actorType: 'SYSTEM',
                merchantId: target.id,
                targetType: 'membership',
                targetId: membershipId,
                requestId: meta.requestId,
                metadata: {
                  source: 'join_form',
                  newCustomer,
                  programId: program.id,
                  marketingConsent: newCustomer ? Boolean(input.marketingConsent) : undefined,
                  consentVersion: CURRENT_CONSENT_VERSION,
                },
              },
              db,
            );
          }

          return {
            ...this.describe(target, program),
            status: existing ? ('EXISTING' as const) : ('CREATED' as const),
            customer: { firstName, preferredLanguage: input.preferredLanguage },
            card,
          };
        });
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002' && attempt < 2) continue;
        throw err;
      }
    }
  }

  private describe(
    target: { nameEn: string; nameAm: string | null; defaultLanguage: 'EN' | 'AM' },
    program: ProgramRecord,
  ): JoinInfo {
    return {
      merchant: {
        nameEn: target.nameEn,
        nameAm: target.nameAm,
        defaultLanguage: target.defaultLanguage,
      },
      program: {
        nameEn: program.nameEn,
        nameAm: program.nameAm,
        stampsRequired: program.stampsRequired,
        brandColor: program.brandColor,
        cardDisplay: program.cardDisplay,
        termsEn: program.termsEn,
        termsAm: program.termsAm,
        reward: program.reward && {
          nameEn: program.reward.nameEn,
          nameAm: program.reward.nameAm,
          descriptionEn: program.reward.descriptionEn,
          descriptionAm: program.reward.descriptionAm,
        },
      },
      consent: { version: CURRENT_CONSENT_VERSION },
      wallet: this.walletOptions(),
    };
  }

  /** The web card always works; Apple and Google appear once those providers are configured. */
  private walletOptions(): WalletOption[] {
    const apple = this.config.get('WALLET_APPLE_ENABLED', { infer: true });
    const google = this.config.get('WALLET_GOOGLE_ENABLED', { infer: true });
    return [
      { provider: 'WEB', available: true, reason: null, addUrl: null },
      {
        provider: 'APPLE',
        available: apple,
        reason: apple ? null : 'NOT_CONFIGURED',
        addUrl: null,
      },
      {
        provider: 'GOOGLE',
        available: google,
        reason: google ? null : 'NOT_CONFIGURED',
        addUrl: null,
      },
    ];
  }
}

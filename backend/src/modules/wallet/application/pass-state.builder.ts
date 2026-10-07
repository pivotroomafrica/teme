import { Injectable } from '@nestjs/common';
import type { DbClient } from '../../../database/db-client';
import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { CustomersRepository } from '../../customers';
import { ProgramsRepository } from '../../loyalty-programs';
import { MembershipsRepository } from '../../memberships';
import { MerchantDirectory } from '../../merchants';
import { RewardsService } from '../../rewards';
import { StampsRepository, progressFor } from '../../stamps';
import { deriveBarcode } from '../domain/credentials';
import type { PassState, PassStatus } from '../domain/pass-state';
import type { PassRow } from '../infrastructure/wallet-passes.repository';

/**
 * Builds the neutral snapshot a wallet card shows, straight from the ledger. Because it is rebuilt at
 * delivery time, a retried or coalesced update always carries the latest truth.
 */
@Injectable()
export class PassStateBuilder {
  constructor(
    private readonly memberships: MembershipsRepository,
    private readonly programs: ProgramsRepository,
    private readonly merchants: MerchantDirectory,
    private readonly customers: CustomersRepository,
    private readonly stamps: StampsRepository,
    private readonly rewards: RewardsService,
  ) {}

  async build(pass: PassRow, barcodeSecret: string | undefined, db?: DbClient): Promise<PassState> {
    const missing = () => new DomainError(ErrorCode.NOT_FOUND, 'Pass data not found.', 404);

    const membership = await this.memberships.findById(pass.merchantId, pass.membershipId, db);
    if (!membership) throw missing();
    const [program, merchant, customer] = await Promise.all([
      this.programs.findById(pass.merchantId, membership.programId, db),
      this.merchants.publicProfile(pass.merchantId),
      this.customers.findDisplay(pass.merchantId, membership.customerId, db),
    ]);
    if (!program || !merchant) throw missing();

    const now = await this.stamps.dbNow(db);
    const effective = await this.stamps.countEffective(pass.merchantId, membership.id, db);
    const summary = await this.rewards.summarize(
      {
        merchantId: pass.merchantId,
        membershipId: membership.id,
        effectiveStamps: effective,
        required: program.stampsRequired,
        now,
      },
      db,
    );
    const progress = progressFor(effective, program.stampsRequired);

    // A deactivated customer's cards stop working even if nobody touched the pass itself.
    const status: PassStatus =
      pass.status === 'ACTIVE' && membership.status !== 'ACTIVE' ? 'SUSPENDED' : pass.status;

    return {
      passId: pass.id,
      membershipId: membership.id,
      programId: program.id,
      provider: pass.provider,
      status,
      language: customer?.preferredLanguage ?? 'EN',
      version: pass.passVersion,
      updatedAt: pass.updatedAt,
      merchantName: { en: merchant.nameEn, am: merchant.nameAm },
      programName: { en: program.nameEn, am: program.nameAm },
      firstName: customer?.firstName ?? null,
      brandColor: program.brandColor,
      stampsRequired: program.stampsRequired,
      currentStamps: progress.current,
      completedCards: progress.completedCards,
      rewardsAvailable: summary.available.length,
      reward: program.reward
        ? {
            name: { en: program.reward.nameEn, am: program.reward.nameAm },
            description: {
              en: program.reward.descriptionEn ?? '',
              am: program.reward.descriptionAm,
            },
          }
        : null,
      terms: { en: program.termsEn ?? '', am: program.termsAm },
      barcode:
        pass.provider !== 'WEB' && barcodeSecret
          ? deriveBarcode(barcodeSecret, pass.id, pass.barcodeVersion)
          : null,
    };
  }
}

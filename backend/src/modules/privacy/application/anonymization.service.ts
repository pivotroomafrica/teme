import { Injectable } from '@nestjs/common';
import type { RequestMeta } from '../../../common/decorators/request-context.decorator';
import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { TransactionManager } from '../../../database/transaction-manager';
import { AuditService } from '../../audit';
import { CustomersRepository } from '../../customers';
import type { MerchantActor } from '../../tenancy';
import { WalletService } from '../../wallet';
import type { AnonymizationReason } from '../domain/customer-export';
import { PrivacyRepository } from '../infrastructure/privacy.repository';

export interface AnonymizeInput {
  merchantId: string;
  customerId: string;
  reason: AnonymizationReason;
  /** The merchant accepts that unclaimed rewards are lost. Automatic runs never set this. */
  acknowledgeOutstandingRewards: boolean;
  /** null = the system (retention job). */
  actorUserId: string | null;
  requestId?: string;
}

export interface AnonymizeResult {
  customerId: string;
  /** False when the customer had already been anonymized (the call is then a no-op). */
  anonymized: boolean;
  membershipsClosed: number;
}

/**
 * Erases a customer's personal data while keeping the records the business and its security depend on.
 * Stamps, redemptions, reversals and the audit trail identify people only by internal id, so they stay;
 * name, phone number, card tokens, wallet passes and cached scanner answers do not.
 */
@Injectable()
export class AnonymizationService {
  constructor(
    private readonly repository: PrivacyRepository,
    private readonly customers: CustomersRepository,
    private readonly wallet: WalletService,
    private readonly audit: AuditService,
    private readonly transactions: TransactionManager,
  ) {}

  forActor(
    actor: MerchantActor,
    customerId: string,
    options: { reason: AnonymizationReason; acknowledgeOutstandingRewards: boolean },
    meta: RequestMeta,
  ): Promise<AnonymizeResult> {
    return this.anonymize({
      merchantId: actor.merchantId,
      customerId,
      reason: options.reason,
      acknowledgeOutstandingRewards: options.acknowledgeOutstandingRewards,
      actorUserId: actor.userId,
      requestId: meta.requestId,
    });
  }

  async anonymize(input: AnonymizeInput): Promise<AnonymizeResult> {
    return this.transactions.run(async (db) => {
      const customer = await this.customers.findById(input.merchantId, input.customerId, db);
      if (!customer) throw new DomainError(ErrorCode.NOT_FOUND, 'Customer not found.', 404);
      if (customer.status === 'ANONYMIZED') {
        return { customerId: input.customerId, anonymized: false, membershipsClosed: 0 };
      }

      // Same lock the scanner takes, so no stamp can slip in half-way through.
      const membershipIds = await this.repository.lockMemberships(
        input.merchantId,
        input.customerId,
        db,
      );
      const now = new Date();
      const outstanding = await this.repository.outstandingRewards(
        input.merchantId,
        input.customerId,
        now,
        db,
      );
      if (outstanding > 0 && !input.acknowledgeOutstandingRewards) {
        throw new DomainError(
          'REWARDS_OUTSTANDING',
          `This customer still has ${outstanding} unclaimed reward(s). Anonymizing forfeits them; repeat the request with acknowledgeOutstandingRewards to proceed.`,
          409,
          { outstandingRewards: outstanding },
        );
      }

      for (const membershipId of membershipIds) {
        await this.wallet.revokeAllForMembership(input.merchantId, membershipId, db);
      }
      await this.repository.anonymize(input.merchantId, input.customerId, membershipIds, now, db);
      await this.audit.record(
        {
          action: 'customer.anonymized',
          actorType: input.actorUserId ? 'USER' : 'SYSTEM',
          actorUserId: input.actorUserId,
          merchantId: input.merchantId,
          targetType: 'customer',
          targetId: input.customerId,
          requestId: input.requestId,
          metadata: {
            reason: input.reason,
            memberships: membershipIds.length,
            forfeitedRewards: outstanding,
          },
        },
        db,
      );
      return {
        customerId: input.customerId,
        anonymized: true,
        membershipsClosed: membershipIds.length,
      };
    });
  }
}

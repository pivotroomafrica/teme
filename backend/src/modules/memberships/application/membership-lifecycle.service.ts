import { Injectable } from '@nestjs/common';
import type { RequestMeta } from '../../../common/decorators/request-context.decorator';
import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { TransactionManager } from '../../../database/transaction-manager';
import { AuditService } from '../../audit';
import { CustomersRepository } from '../../customers';
import { OutboxJobType, OutboxService } from '../../jobs';
import type { MerchantActor } from '../../tenancy';
import { MembershipsRepository } from '../infrastructure/memberships.repository';

const notFound = () => new DomainError(ErrorCode.NOT_FOUND, 'Membership not found.', 404);

/**
 * Ends or resumes a customer's participation in a program without touching history: stamps, redemptions and
 * reversals stay exactly as they were, and the customer's data is kept (see anonymization for erasing it).
 */
@Injectable()
export class MembershipLifecycleService {
  constructor(
    private readonly memberships: MembershipsRepository,
    private readonly customers: CustomersRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly transactions: TransactionManager,
  ) {}

  /** Idempotent. The card stops working at the counter at once; wallet cards are refreshed to a suspended state. */
  async deactivate(actor: MerchantActor, membershipId: string, meta: RequestMeta): Promise<void> {
    await this.change(actor, membershipId, 'INACTIVE', 'membership.deactivated', meta);
  }

  /** Idempotent. Not possible once the customer has been anonymized. */
  async reactivate(actor: MerchantActor, membershipId: string, meta: RequestMeta): Promise<void> {
    await this.change(actor, membershipId, 'ACTIVE', 'membership.reactivated', meta);
  }

  private async change(
    actor: MerchantActor,
    membershipId: string,
    target: 'ACTIVE' | 'INACTIVE',
    action: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.transactions.run(async (db) => {
      const membership = await this.memberships.lockById(actor.merchantId, membershipId, db);
      if (!membership) throw notFound();
      if (membership.status === target) return;
      if (target === 'ACTIVE') {
        const customer = await this.customers.findById(actor.merchantId, membership.customerId, db);
        if (!customer || customer.status !== 'ACTIVE') {
          throw new DomainError(
            'CUSTOMER_ANONYMIZED',
            'This customer has been anonymized and cannot rejoin.',
            409,
          );
        }
      }
      await this.memberships.setStatus(actor.merchantId, membershipId, target, new Date(), db);
      await this.memberships.markPassesStale(actor.merchantId, membershipId, db);
      await this.outbox.enqueue(
        {
          merchantId: actor.merchantId,
          type: OutboxJobType.WALLET_PASS_UPDATE,
          aggregateType: 'membership',
          aggregateId: membershipId,
          payload: {
            reason: target === 'INACTIVE' ? 'membership_deactivated' : 'membership_reactivated',
          },
        },
        db,
      );
      await this.audit.record(
        {
          action,
          actorUserId: actor.userId,
          merchantId: actor.merchantId,
          targetType: 'membership',
          targetId: membershipId,
          requestId: meta.requestId,
        },
        db,
      );
    });
  }
}

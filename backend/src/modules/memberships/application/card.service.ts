import { Injectable } from '@nestjs/common';
import type { RequestMeta } from '../../../common/decorators/request-context.decorator';
import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { TransactionManager } from '../../../database/transaction-manager';
import { AuditService } from '../../audit';
import { ConsentService } from '../../customers';
import type { MerchantActor } from '../../tenancy';
import { hashCardToken, looksLikeCardToken, newCardToken } from '../domain/card-token';
import { MembershipsRepository } from '../infrastructure/memberships.repository';

const cardNotFound = () => new DomainError(ErrorCode.NOT_FOUND, 'Card not found.', 404);

@Injectable()
export class CardService {
  constructor(
    private readonly memberships: MembershipsRepository,
    private readonly consent: ConsentService,
    private readonly audit: AuditService,
    private readonly transactions: TransactionManager,
  ) {}

  /**
   * Customer self-service: the card token proves ownership. Marketing consent is withdrawn;
   * the membership, card and stamp history are untouched. Idempotent.
   */
  async withdrawMarketingByCard(token: string, meta: RequestMeta): Promise<void> {
    if (!looksLikeCardToken(token)) throw cardNotFound();
    const membership = await this.memberships.findByTokenHash(hashCardToken(token));
    if (!membership) throw cardNotFound();
    await this.transactions.run((db) =>
      this.consent.withdrawMarketing(
        {
          merchantId: membership.merchantId,
          customerId: membership.customerId,
          source: 'PRIVACY_REQUEST',
          actorUserId: null,
          requestId: meta.requestId,
        },
        db,
      ),
    );
  }

  /**
   * Staff-assisted recovery for a lost phone or compromised card: issues a new token and invalidates
   * the old one. The new token is shown once.
   */
  async reissueCard(
    actor: MerchantActor,
    membershipId: string,
    meta: RequestMeta,
  ): Promise<{ token: string }> {
    const issued = newCardToken();
    await this.transactions.run(async (db) => {
      const membership = await this.memberships.findById(actor.merchantId, membershipId, db);
      if (!membership) throw new DomainError(ErrorCode.NOT_FOUND, 'Membership not found.', 404);
      if (membership.status !== 'ACTIVE') {
        throw new DomainError(ErrorCode.CONFLICT, 'Only active memberships can be reissued.', 409);
      }
      await this.memberships.rotateToken(actor.merchantId, membershipId, issued.hash, db);
      await this.audit.record(
        {
          action: 'membership.card_reissued',
          actorUserId: actor.userId,
          merchantId: actor.merchantId,
          targetType: 'membership',
          targetId: membershipId,
          requestId: meta.requestId,
        },
        db,
      );
    });
    return { token: issued.token };
  }
}

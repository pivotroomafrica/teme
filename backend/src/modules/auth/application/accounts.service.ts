import { Injectable } from '@nestjs/common';
import type { RequestMeta } from '../../../common/decorators/request-context.decorator';
import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { TransactionManager } from '../../../database/transaction-manager';
import { AuditService } from '../../audit';
import type { PlatformActor } from '../../tenancy';
import { IdentityRepository } from '../infrastructure/identity.repository';
import { RefreshTokenRepository } from '../infrastructure/refresh-token.repository';

@Injectable()
export class AccountsService {
  constructor(
    private readonly identity: IdentityRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly audit: AuditService,
    private readonly transactions: TransactionManager,
  ) {}

  /** Platform-level account deactivation: blocks login and revokes every session. Idempotent. */
  async deactivateUser(actor: PlatformActor, userId: string, meta: RequestMeta): Promise<void> {
    if (userId === actor.userId) {
      throw new DomainError(ErrorCode.CONFLICT, 'You cannot deactivate your own account.', 409);
    }
    const target = await this.identity.findUserById(userId);
    if (!target) throw new DomainError(ErrorCode.NOT_FOUND, 'User not found.', 404);
    if (target.status === 'DEACTIVATED') return;

    const now = new Date();
    await this.transactions.run(async (db) => {
      await this.identity.deactivateUser(userId, now, db);
      const revoked = await this.refreshTokens.revokeAllForUser(
        userId,
        'ACCOUNT_DEACTIVATED',
        now,
        db,
      );
      await this.audit.record(
        {
          action: 'user.deactivated',
          actorUserId: actor.userId,
          merchantId: await this.identity.findAnyMembershipMerchantId(userId, db),
          targetType: 'user',
          targetId: userId,
          requestId: meta.requestId,
          metadata: { sessionsRevoked: revoked, accountType: target.accountType },
        },
        db,
      );
    });
  }
}

import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { RequestMeta } from '../../../common/decorators/request-context.decorator';
import { DomainError } from '../../../common/errors/domain-error';
import type { DbClient } from '../../../database/db-client';
import { TransactionManager } from '../../../database/transaction-manager';
import { AuditService } from '../../audit';
import type { MerchantActor, PlatformActor } from '../../tenancy';
import { LOCKOUT_MINUTES, MAX_FAILED_LOGINS, isLocked, lockoutExpiry } from '../domain/lockout';
import {
  ActiveMembership,
  IdentityRepository,
  UserRecord,
} from '../infrastructure/identity.repository';
import { RefreshTokenRepository } from '../infrastructure/refresh-token.repository';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

export interface SessionResult {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: {
    id: string;
    displayName: string;
    accountType: 'PLATFORM_ADMIN' | 'MERCHANT_USER';
    role: string;
    merchantId: string | null;
  };
}

type SessionContext =
  { kind: 'platform'; roleKey: string } | { kind: 'merchant'; membership: ActiveMembership };

const invalidCredentials = () =>
  new DomainError('INVALID_CREDENTIALS', 'Invalid email or password.', 401);
const invalidRefresh = () =>
  new DomainError('INVALID_REFRESH_TOKEN', 'The refresh token is invalid or expired.', 401);

@Injectable()
export class AuthService {
  constructor(
    private readonly identity: IdentityRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly transactions: TransactionManager,
  ) {}

  async login(
    input: { email: string; password: string; deviceLabel?: string },
    meta: RequestMeta,
  ): Promise<SessionResult> {
    const email = input.email.trim().toLowerCase();
    const now = new Date();
    const user = await this.identity.findUserByEmail(email);

    if (!user) {
      await this.passwords.verifyAgainstDummy(input.password); // equalise timing
      await this.auditLoginFailure(null, 'unknown_account', email, meta);
      throw invalidCredentials();
    }
    if (isLocked(user.lockedUntil, now)) {
      await this.auditLoginFailure(user, 'account_locked', email, meta);
      throw invalidCredentials();
    }
    if (!(await this.passwords.verify(user.passwordHash, input.password))) {
      await this.identity.registerFailedLogin(user.id, MAX_FAILED_LOGINS, lockoutExpiry(now));
      await this.auditLoginFailure(user, 'bad_password', email, meta);
      throw invalidCredentials();
    }
    if (user.status !== 'ACTIVE') {
      await this.auditLoginFailure(user, 'account_deactivated', email, meta);
      throw invalidCredentials();
    }
    const context = await this.resolveContext(user);
    if (!context) {
      await this.auditLoginFailure(user, 'no_active_membership', email, meta);
      throw invalidCredentials();
    }

    return this.transactions.run(async (db) => {
      await this.identity.markLoginSuccess(user.id, now, db);
      const session = await this.issueSession(user, context, randomUUID(), randomUUID(), meta, db, {
        deviceLabel: input.deviceLabel,
      });
      await this.audit.record(
        {
          action: 'auth.login',
          actorUserId: user.id,
          merchantId: context.kind === 'merchant' ? context.membership.merchantId : null,
          targetType: 'user',
          targetId: user.id,
          requestId: meta.requestId,
          metadata: { ip: meta.ip, userAgent: meta.userAgent, deviceLabel: input.deviceLabel },
        },
        db,
      );
      return session;
    });
  }

  /** Rotates the refresh token. Presenting an already-used token revokes the whole family. */
  async refresh(refreshToken: string, meta: RequestMeta): Promise<SessionResult> {
    const hash = this.tokens.hashRefreshToken(refreshToken);
    const now = new Date();

    const outcome = await this.transactions.run(async (db) => {
      const row = await this.refreshTokens.findByHash(hash, db);
      if (!row) return { kind: 'invalid' as const };

      const reuse = async () => {
        await this.refreshTokens.revokeFamily(row.familyId, 'REUSE_DETECTED', now, db);
        await this.audit.record(
          {
            action: 'auth.refresh_reuse_detected',
            actorUserId: row.userId,
            merchantId: await this.identity.findAnyMembershipMerchantId(row.userId, db),
            targetType: 'user',
            targetId: row.userId,
            requestId: meta.requestId,
            metadata: { ip: meta.ip, userAgent: meta.userAgent },
          },
          db,
        );
        return { kind: 'reuse' as const };
      };

      if (row.revokedAt) return reuse();
      if (row.expiresAt.getTime() <= now.getTime()) return { kind: 'invalid' as const };

      const user = await this.identity.findUserById(row.userId, db);
      const context = user && user.status === 'ACTIVE' ? await this.resolveContext(user, db) : null;
      if (!user || !context) {
        await this.refreshTokens.revokeFamily(row.familyId, 'ACCESS_REMOVED', now, db);
        return { kind: 'invalid' as const };
      }

      const newTokenId = randomUUID();
      const flipped = await this.refreshTokens.revokeIfActive(
        row.id,
        'ROTATED',
        now,
        newTokenId,
        db,
      );
      if (!flipped) return reuse(); // lost a race: the same token was presented twice

      const session = await this.issueSession(user, context, row.familyId, newTokenId, meta, db);
      return { kind: 'ok' as const, session };
    });

    if (outcome.kind !== 'ok') throw invalidRefresh();
    return outcome.session;
  }

  /** Ends one device session (the refresh-token family). Always succeeds: no token oracle. */
  async logout(refreshToken: string, meta: RequestMeta): Promise<void> {
    const row = await this.refreshTokens.findByHash(this.tokens.hashRefreshToken(refreshToken));
    if (!row || row.revokedAt) return;
    const now = new Date();
    await this.transactions.run(async (db) => {
      await this.refreshTokens.revokeFamily(row.familyId, 'LOGOUT', now, db);
      await this.audit.record(
        {
          action: 'auth.logout',
          actorUserId: row.userId,
          merchantId: await this.identity.findAnyMembershipMerchantId(row.userId, db),
          targetType: 'user',
          targetId: row.userId,
          requestId: meta.requestId,
          metadata: { scope: 'device' },
        },
        db,
      );
    });
  }

  /** Ends every device session of the authenticated user. */
  async logoutAll(actor: MerchantActor | PlatformActor, meta: RequestMeta): Promise<void> {
    const now = new Date();
    await this.transactions.run(async (db) => {
      const revoked = await this.refreshTokens.revokeAllForUser(
        actor.userId,
        'LOGOUT_ALL',
        now,
        db,
      );
      await this.audit.record(
        {
          action: 'auth.logout_all',
          actorUserId: actor.userId,
          merchantId: actor.kind === 'merchant' ? actor.merchantId : null,
          targetType: 'user',
          targetId: actor.userId,
          requestId: meta.requestId,
          metadata: { scope: 'all_devices', sessionsRevoked: revoked },
        },
        db,
      );
    });
  }

  private async resolveContext(user: UserRecord, db?: DbClient): Promise<SessionContext | null> {
    if (user.accountType === 'PLATFORM_ADMIN') {
      const role = await this.identity.findPlatformRole(db);
      return role ? { kind: 'platform', roleKey: role.key } : null;
    }
    const membership = await this.identity.findActiveMembership(user.id, undefined, db);
    return membership ? { kind: 'merchant', membership } : null;
  }

  private async issueSession(
    user: UserRecord,
    context: SessionContext,
    familyId: string,
    tokenId: string,
    meta: RequestMeta,
    db: DbClient,
    extra: { deviceLabel?: string } = {},
  ): Promise<SessionResult> {
    const refresh = this.tokens.newRefreshToken();
    await this.refreshTokens.create(
      {
        id: tokenId,
        userId: user.id,
        familyId,
        tokenHash: refresh.hash,
        expiresAt: new Date(Date.now() + this.tokens.refreshTtlMs),
        deviceLabel: extra.deviceLabel,
        userAgent: meta.userAgent,
      },
      db,
    );
    const accessToken = await this.tokens.signAccessToken(
      context.kind === 'platform'
        ? { sub: user.id, typ: 'platform' }
        : {
            sub: user.id,
            typ: 'merchant',
            sid: context.membership.id,
            mid: context.membership.merchantId,
          },
    );
    return {
      accessToken,
      refreshToken: refresh.token,
      tokenType: 'Bearer',
      expiresIn: this.tokens.accessTtlSeconds,
      user: {
        id: user.id,
        displayName: user.displayName,
        accountType: user.accountType,
        role: context.kind === 'platform' ? context.roleKey : context.membership.roleKey,
        merchantId: context.kind === 'merchant' ? context.membership.merchantId : null,
      },
    };
  }

  private async auditLoginFailure(
    user: UserRecord | null,
    reason: string,
    email: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.audit.record({
      action: 'auth.login_failed',
      actorUserId: user?.id ?? null,
      merchantId: user ? await this.identity.findAnyMembershipMerchantId(user.id) : null,
      targetType: user ? 'user' : undefined,
      targetId: user?.id,
      requestId: meta.requestId,
      metadata: {
        reason,
        ip: meta.ip,
        userAgent: meta.userAgent,
        // The attempted address is never stored; a short fingerprint lets investigators correlate.
        fingerprint: createHash('sha256').update(email).digest('hex').slice(0, 12),
        lockoutMinutes: reason === 'account_locked' ? LOCKOUT_MINUTES : undefined,
      },
    });
  }
}

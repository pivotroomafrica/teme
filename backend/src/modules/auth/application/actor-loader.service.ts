import { Injectable } from '@nestjs/common';
import { BRANCH_RESTRICTED_ROLES, type Actor } from '../../tenancy';
import { IdentityRepository } from '../infrastructure/identity.repository';
import { TokenService } from './token.service';

/**
 * Turns an access token into an Actor. The token only identifies WHO; status, role, permissions,
 * merchant and branch scope are re-read from the database on every request, so deactivation and
 * role changes take effect immediately.
 */
@Injectable()
export class ActorLoader {
  constructor(
    private readonly tokens: TokenService,
    private readonly identity: IdentityRepository,
  ) {}

  /** Returns null for any invalid, expired, mismatched or deactivated principal. */
  async fromAccessToken(token: string): Promise<Actor | null> {
    let claims;
    try {
      claims = await this.tokens.verifyAccessToken(token);
    } catch {
      return null;
    }

    const user = await this.identity.findUserById(claims.sub);
    if (!user || user.status !== 'ACTIVE') return null;

    if (claims.typ === 'platform') {
      if (user.accountType !== 'PLATFORM_ADMIN') return null;
      const role = await this.identity.findPlatformRole();
      if (!role) return null;
      return {
        kind: 'platform',
        userId: user.id,
        roleKey: role.key,
        permissions: new Set(role.permissions),
      };
    }

    if (user.accountType !== 'MERCHANT_USER' || !claims.sid || !claims.mid) return null;
    const membership = await this.identity.findActiveMembership(user.id, claims.sid);
    if (!membership || membership.merchantId !== claims.mid) return null;
    return {
      kind: 'merchant',
      userId: user.id,
      roleKey: membership.roleKey,
      merchantId: membership.merchantId,
      staffMembershipId: membership.id,
      permissions: new Set(membership.permissions),
      branchScope: BRANCH_RESTRICTED_ROLES.has(membership.roleKey) ? membership.branchIds : 'ALL',
    };
  }
}

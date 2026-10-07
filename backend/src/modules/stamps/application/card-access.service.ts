import { Injectable } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import type { DbClient } from '../../../database/db-client';
import { BranchesRepository } from '../../branches';
import {
  MembershipRecord,
  MembershipsRepository,
  hashCardToken,
  looksLikeCardToken,
} from '../../memberships';
import { canAccessBranch, type MerchantActor } from '../../tenancy';
import type { RejectionReason } from '../domain/scan-policy';

export type CardAccess =
  | {
      ok: false;
      reason: Extract<
        RejectionReason,
        'BRANCH_NOT_PERMITTED' | 'INVALID_TOKEN' | 'MEMBERSHIP_INACTIVE'
      >;
      /** Only set when the branch really belongs to the caller's merchant (safe to audit). */
      branchId: string | null;
      membershipId: string | null;
    }
  | { ok: true; branchId: string; membership: MembershipRecord };

/**
 * The checks every counter operation shares: which branch the device is at, which card was presented,
 * and whether the membership is usable. With a transaction handle the membership row is locked.
 */
@Injectable()
export class CardAccessService {
  constructor(
    private readonly branches: BranchesRepository,
    private readonly memberships: MembershipsRepository,
  ) {}

  /**
   * The device's branch. Branch staff with a single branch may omit it; everyone else must say where
   * they are. The value is only a claim: `resolve` checks it against the staff member's scope.
   */
  resolveBranchId(actor: MerchantActor, requested: string | undefined): string {
    if (requested) return requested;
    if (actor.branchScope !== 'ALL' && actor.branchScope.length === 1) {
      return actor.branchScope[0] as string;
    }
    throw new DomainError(ErrorCode.VALIDATION_FAILED, 'branchId is required.', 400);
  }

  async resolve(
    actor: MerchantActor,
    cardToken: string,
    branchId: string,
    db: DbClient | undefined,
  ): Promise<CardAccess> {
    const merchantId = actor.merchantId;

    // Branch: unknown, foreign, unassigned and inactive branches are indistinguishable.
    const branch = canAccessBranch(actor, branchId)
      ? await this.branches.findById(merchantId, branchId, 'ALL', db)
      : null;
    const verifiedBranchId = branch?.id ?? null;
    if (!branch || branch.status !== 'ACTIVE') {
      return {
        ok: false,
        reason: 'BRANCH_NOT_PERMITTED',
        branchId: verifiedBranchId,
        membershipId: null,
      };
    }

    // Card: scoped to this merchant, so another tenant's card is simply "not valid".
    if (!looksLikeCardToken(cardToken)) {
      return { ok: false, reason: 'INVALID_TOKEN', branchId: verifiedBranchId, membershipId: null };
    }
    const tokenHash = hashCardToken(cardToken);
    const membership = db
      ? await this.memberships.lockByTokenHash(merchantId, tokenHash, db)
      : await this.memberships.findByTokenHashForMerchant(merchantId, tokenHash);
    if (!membership) {
      return { ok: false, reason: 'INVALID_TOKEN', branchId: verifiedBranchId, membershipId: null };
    }
    if (membership.status !== 'ACTIVE') {
      return {
        ok: false,
        reason: 'MEMBERSHIP_INACTIVE',
        branchId: verifiedBranchId,
        membershipId: membership.id,
      };
    }
    return { ok: true, branchId: branch.id, membership };
  }
}

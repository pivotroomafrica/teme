import { Injectable } from '@nestjs/common';
import type { RequestMeta } from '../../../common/decorators/request-context.decorator';
import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { TransactionManager } from '../../../database/transaction-manager';
import { AuditService } from '../../audit';
import { RefreshTokenRepository } from '../../auth';
import type { MerchantActor } from '../../tenancy';
import { MERCHANT_ROLES, assertCanManageStaff } from '../domain/staff-policy';
import { StaffInvitationRepository } from '../infrastructure/staff-invitation.repository';
import { StaffRecord, StaffRepository } from '../infrastructure/staff.repository';

const notFound = () => new DomainError(ErrorCode.NOT_FOUND, 'Staff member not found.', 404);
const lastOwner = () =>
  new DomainError('LAST_OWNER', 'A merchant must keep at least one active owner.', 409);
const invalidBranches = () =>
  new DomainError(ErrorCode.VALIDATION_FAILED, 'One or more branches are invalid.', 400);

@Injectable()
export class StaffService {
  constructor(
    private readonly repository: StaffRepository,
    private readonly invitations: StaffInvitationRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly audit: AuditService,
    private readonly transactions: TransactionManager,
  ) {}

  list(actor: MerchantActor): Promise<StaffRecord[]> {
    return this.repository.list(actor.merchantId);
  }

  async get(actor: MerchantActor, staffId: string): Promise<StaffRecord> {
    const staff = await this.repository.findById(actor.merchantId, staffId);
    if (!staff) throw notFound();
    return staff;
  }

  async changeRole(
    actor: MerchantActor,
    staffId: string,
    newRole: string,
    meta: RequestMeta,
  ): Promise<StaffRecord> {
    if (!(MERCHANT_ROLES as readonly string[]).includes(newRole)) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Unknown role.', 400);
    }
    return this.transactions.run(async (db) => {
      // Lock first so concurrent owner changes serialise; then re-read the target under the lock.
      const owners = await this.repository.lockActiveOwners(actor.merchantId, db);
      const target = await this.repository.findById(actor.merchantId, staffId, db);
      if (!target) throw notFound();
      if (target.status === 'DEACTIVATED') {
        throw new DomainError(ErrorCode.CONFLICT, 'Deactivated staff cannot be changed.', 409);
      }
      assertCanManageStaff(actor, target, newRole);
      if (target.roleKey === newRole) return target;
      if (target.roleKey === 'OWNER' && owners.length <= 1) throw lastOwner();

      const roleId = await this.repository.findRoleId(newRole, db);
      if (!roleId) throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Unknown role.', 400);
      await this.repository.updateRole(actor.merchantId, staffId, roleId, db);
      await this.audit.record(
        {
          action: 'staff.role_changed',
          actorUserId: actor.userId,
          merchantId: actor.merchantId,
          targetType: 'staff_membership',
          targetId: staffId,
          requestId: meta.requestId,
          metadata: { from: target.roleKey, to: newRole, targetUserId: target.userId },
        },
        db,
      );
      return { ...target, roleKey: newRole };
    });
  }

  /** Replaces the set of branches a staff member may operate at. */
  async setBranches(
    actor: MerchantActor,
    staffId: string,
    branchIds: string[],
    meta: RequestMeta,
  ): Promise<StaffRecord> {
    const wanted = [...new Set(branchIds)];
    return this.transactions.run(async (db) => {
      const target = await this.repository.findById(actor.merchantId, staffId, db);
      if (!target) throw notFound();
      if (target.status === 'DEACTIVATED') {
        throw new DomainError(ErrorCode.CONFLICT, 'Deactivated staff cannot be changed.', 409);
      }
      assertCanManageStaff(actor, target);
      if (target.roleKey === 'STAFF' && wanted.length === 0) {
        throw new DomainError(
          ErrorCode.VALIDATION_FAILED,
          'Branch staff must be assigned to at least one branch.',
          400,
        );
      }
      // Newly added branches must be active branches of THIS merchant; foreign and unknown ids are
      // indistinguishable. Branches already assigned may stay even if since deactivated.
      const additions = wanted.filter((id) => !target.branchIds.includes(id));
      if (!(await this.repository.allActiveBranches(actor.merchantId, additions, db))) {
        throw invalidBranches();
      }

      const { added, removed } = await this.repository.replaceBranches(
        actor.merchantId,
        staffId,
        wanted,
        db,
      );
      if (added.length > 0 || removed.length > 0) {
        await this.audit.record(
          {
            action: 'staff.branches_changed',
            actorUserId: actor.userId,
            merchantId: actor.merchantId,
            targetType: 'staff_membership',
            targetId: staffId,
            requestId: meta.requestId,
            metadata: { added, removed, targetUserId: target.userId },
          },
          db,
        );
      }
      return { ...target, branchIds: [...wanted].sort() };
    });
  }

  /** Deactivates the membership. The record and all of its history are preserved. */
  async deactivate(actor: MerchantActor, staffId: string, meta: RequestMeta): Promise<void> {
    const now = new Date();
    await this.transactions.run(async (db) => {
      const owners = await this.repository.lockActiveOwners(actor.merchantId, db);
      const target = await this.repository.findById(actor.merchantId, staffId, db);
      if (!target) throw notFound();
      if (target.status === 'DEACTIVATED') return; // idempotent
      assertCanManageStaff(actor, target);
      if (target.roleKey === 'OWNER' && target.status === 'ACTIVE' && owners.length <= 1) {
        throw lastOwner();
      }

      await this.repository.deactivate(actor.merchantId, staffId, now, db);
      await this.invitations.revokePending(actor.merchantId, staffId, now, db);
      const revoked = await this.refreshTokens.revokeAllForUser(
        target.userId,
        'ACCOUNT_DEACTIVATED',
        now,
        db,
      );
      await this.audit.record(
        {
          action: 'staff.deactivated',
          actorUserId: actor.userId,
          merchantId: actor.merchantId,
          targetType: 'staff_membership',
          targetId: staffId,
          requestId: meta.requestId,
          metadata: { role: target.roleKey, targetUserId: target.userId, sessionsRevoked: revoked },
        },
        db,
      );
    });
  }

  /** Re-activates a deactivated member (never a pending invitation: that must be accepted). */
  async activate(actor: MerchantActor, staffId: string, meta: RequestMeta): Promise<StaffRecord> {
    const now = new Date();
    return this.transactions.run(async (db) => {
      const target = await this.repository.findById(actor.merchantId, staffId, db);
      if (!target) throw notFound();
      if (target.status === 'ACTIVE') return target; // idempotent
      if (target.status === 'INVITED') {
        throw new DomainError(
          ErrorCode.CONFLICT,
          'This member has not accepted the invitation yet.',
          409,
        );
      }
      assertCanManageStaff(actor, target);
      if (target.userStatus !== 'ACTIVE') {
        throw new DomainError(ErrorCode.CONFLICT, 'The underlying account is deactivated.', 409);
      }
      await this.repository.activate(actor.merchantId, staffId, now, db);
      await this.audit.record(
        {
          action: 'staff.activated',
          actorUserId: actor.userId,
          merchantId: actor.merchantId,
          targetType: 'staff_membership',
          targetId: staffId,
          requestId: meta.requestId,
          metadata: { role: target.roleKey, targetUserId: target.userId },
        },
        db,
      );
      return { ...target, status: 'ACTIVE', deactivatedAt: null, activatedAt: now };
    });
  }
}

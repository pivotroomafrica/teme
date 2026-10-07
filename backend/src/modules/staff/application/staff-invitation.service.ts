import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { RequestMeta } from '../../../common/decorators/request-context.decorator';
import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { TransactionManager } from '../../../database/transaction-manager';
import { AuditService } from '../../audit';
import { PasswordService, checkPassword } from '../../auth';
import type { MerchantActor } from '../../tenancy';
import { MERCHANT_ROLES, assertCanInvite, assertCanManageStaff } from '../domain/staff-policy';
import { StaffInvitationRepository } from '../infrastructure/staff-invitation.repository';
import { StaffRecord, StaffRepository } from '../infrastructure/staff.repository';

export const INVITATION_TTL_DAYS = 7;

export interface InviteInput {
  email: string;
  displayName: string;
  role: string;
  branchIds: string[];
  preferredLanguage?: 'EN' | 'AM';
}

export interface IssuedInvitation {
  /** Shown once to the inviter. Only its hash is stored. */
  token: string;
  expiresAt: Date;
}

const validation = (message: string) => new DomainError(ErrorCode.VALIDATION_FAILED, message, 400);
/** Same answer for "already registered here", "registered elsewhere" and "race lost". */
const cannotInvite = () =>
  new DomainError('INVITE_NOT_POSSIBLE', 'This email address cannot be invited.', 409);
const invalidInvitation = () =>
  new DomainError('INVALID_INVITATION', 'This invitation is invalid or has expired.', 400);

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class StaffInvitationService {
  constructor(
    private readonly staff: StaffRepository,
    private readonly invitations: StaffInvitationRepository,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly transactions: TransactionManager,
  ) {}

  async invite(
    actor: MerchantActor,
    input: InviteInput,
    meta: RequestMeta,
  ): Promise<{ staff: StaffRecord; invitation: IssuedInvitation }> {
    if (!(MERCHANT_ROLES as readonly string[]).includes(input.role)) {
      throw validation('Unknown role.');
    }
    assertCanInvite(actor, input.role);
    const branchIds = [...new Set(input.branchIds)];
    if (input.role === 'STAFF' && branchIds.length === 0) {
      throw validation('Branch staff must be assigned to at least one branch.');
    }
    const email = input.email.trim().toLowerCase();
    // The account has no usable password until the invitation is accepted.
    const unusablePassword = await this.passwords.hash(randomBytes(32).toString('base64url'));
    const issued = this.newToken();

    let staffId: string;
    try {
      staffId = await this.transactions.run(async (db) => {
        if (!(await this.staff.allActiveBranches(actor.merchantId, branchIds, db))) {
          throw validation('One or more branches are invalid.');
        }
        if (await this.staff.emailExists(email, db)) throw cannotInvite();
        const roleId = await this.staff.findRoleId(input.role, db);
        if (!roleId) throw validation('Unknown role.');

        const created = await this.staff.createInvited(
          {
            merchantId: actor.merchantId,
            email,
            displayName: input.displayName.trim(),
            language: input.preferredLanguage ?? 'EN',
            passwordHash: unusablePassword,
            roleId,
            branchIds,
          },
          db,
        );
        await this.invitations.create(
          {
            merchantId: actor.merchantId,
            staffMembershipId: created.staffId,
            tokenHash: issued.hash,
            invitedByUserId: actor.userId,
            expiresAt: issued.expiresAt,
          },
          db,
        );
        await this.audit.record(
          {
            action: 'staff.invited',
            actorUserId: actor.userId,
            merchantId: actor.merchantId,
            targetType: 'staff_membership',
            targetId: created.staffId,
            requestId: meta.requestId,
            metadata: { role: input.role, branchIds, targetUserId: created.userId },
          },
          db,
        );
        return created.staffId;
      });
    } catch (err) {
      // Concurrent invites of the same address: the loser hits the unique email index.
      if ((err as { code?: string }).code === 'P2002') throw cannotInvite();
      throw err;
    }

    const staff = (await this.staff.findById(actor.merchantId, staffId)) as StaffRecord;
    return { staff, invitation: { token: issued.token, expiresAt: issued.expiresAt } };
  }

  /** Invalidates any outstanding link and issues a fresh one for a member who has not accepted yet. */
  async reissue(
    actor: MerchantActor,
    staffId: string,
    meta: RequestMeta,
  ): Promise<IssuedInvitation> {
    const issued = this.newToken();
    await this.transactions.run(async (db) => {
      const target = await this.staff.findById(actor.merchantId, staffId, db);
      if (!target) throw new DomainError(ErrorCode.NOT_FOUND, 'Staff member not found.', 404);
      assertCanManageStaff(actor, target);
      if (target.status !== 'INVITED') {
        throw new DomainError(ErrorCode.CONFLICT, 'Only pending invitations can be reissued.', 409);
      }
      const now = new Date();
      await this.invitations.revokePending(actor.merchantId, staffId, now, db);
      await this.invitations.create(
        {
          merchantId: actor.merchantId,
          staffMembershipId: staffId,
          tokenHash: issued.hash,
          invitedByUserId: actor.userId,
          expiresAt: issued.expiresAt,
        },
        db,
      );
      await this.audit.record(
        {
          action: 'staff.invitation_reissued',
          actorUserId: actor.userId,
          merchantId: actor.merchantId,
          targetType: 'staff_membership',
          targetId: staffId,
          requestId: meta.requestId,
        },
        db,
      );
    });
    return { token: issued.token, expiresAt: issued.expiresAt };
  }

  /** Public: the invitation token is the credential. All failures look the same. */
  async accept(
    input: { token: string; password: string; displayName?: string },
    meta: RequestMeta,
  ): Promise<void> {
    const now = new Date();
    const invitation = await this.invitations.findByTokenHash(hashToken(input.token));
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt.getTime() <= now.getTime() ||
      invitation.staffStatus !== 'INVITED' ||
      invitation.userStatus !== 'ACTIVE' ||
      invitation.merchantStatus !== 'ACTIVE'
    ) {
      throw invalidInvitation();
    }
    const problem = checkPassword(input.password, invitation.email);
    if (problem) throw validation(problem);
    const passwordHash = await this.passwords.hash(input.password);

    await this.transactions.run(async (db) => {
      if (!(await this.invitations.markAccepted(invitation.id, now, db))) throw invalidInvitation();
      await this.invitations.activateAccount(
        {
          userId: invitation.userId,
          merchantId: invitation.merchantId,
          staffMembershipId: invitation.staffMembershipId,
          passwordHash,
          displayName: input.displayName?.trim() || undefined,
          now,
        },
        db,
      );
      await this.audit.record(
        {
          action: 'staff.invitation_accepted',
          actorUserId: invitation.userId,
          merchantId: invitation.merchantId,
          targetType: 'staff_membership',
          targetId: invitation.staffMembershipId,
          requestId: meta.requestId,
          metadata: { ip: meta.ip },
        },
        db,
      );
    });
  }

  private newToken(): { token: string; hash: string; expiresAt: Date } {
    const token = randomBytes(32).toString('base64url');
    return {
      token,
      hash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000),
    };
  }
}

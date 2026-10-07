import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';

export const MERCHANT_ROLES = ['OWNER', 'MANAGER', 'STAFF'] as const;
export type MerchantRoleKey = (typeof MERCHANT_ROLES)[number];

const forbidden = (message: string) => new DomainError(ErrorCode.FORBIDDEN, message, 403);

/**
 * Who may change whom.
 *  - Nobody may change their own role or status (no self-promotion).
 *  - Owners may manage everyone.
 *  - Managers may manage branch staff only, and cannot grant any role above STAFF.
 */
export function assertCanManageStaff(
  actor: { staffMembershipId: string; roleKey: string },
  target: { id: string; roleKey: string },
  newRole?: string,
): void {
  if (target.id === actor.staffMembershipId) {
    throw forbidden('You cannot change your own role or status.');
  }
  if (actor.roleKey === 'OWNER') return;
  if (actor.roleKey === 'MANAGER') {
    if (target.roleKey !== 'STAFF') throw forbidden('Managers can only manage branch staff.');
    if (newRole !== undefined && newRole !== 'STAFF') {
      throw forbidden('Managers cannot grant the manager or owner role.');
    }
    return;
  }
  throw forbidden('You do not have permission to manage staff.');
}

/** Owners may invite any merchant role; managers may invite branch staff only. */
export function assertCanInvite(actor: { roleKey: string }, role: string): void {
  if (actor.roleKey === 'OWNER') return;
  if (actor.roleKey === 'MANAGER' && role === 'STAFF') return;
  throw forbidden(
    actor.roleKey === 'MANAGER'
      ? 'Managers can only invite branch staff.'
      : 'You do not have permission to invite staff.',
  );
}

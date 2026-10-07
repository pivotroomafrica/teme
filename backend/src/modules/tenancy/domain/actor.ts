/**
 * The authenticated principal, rebuilt from the database on every request.
 * Platform administrators and merchant users are disjoint types: a platform actor never
 * carries a merchant id, and a merchant actor can never satisfy a platform permission.
 */
export type BranchScope = 'ALL' | readonly string[];

interface BaseActor {
  readonly userId: string;
  readonly roleKey: string;
  readonly permissions: ReadonlySet<string>;
}

export interface PlatformActor extends BaseActor {
  readonly kind: 'platform';
}

export interface MerchantActor extends BaseActor {
  readonly kind: 'merchant';
  /** Always derived from the staff membership in the database, never from client input. */
  readonly merchantId: string;
  readonly staffMembershipId: string;
  /** Branch staff are limited to assigned branches; owners and managers see all. */
  readonly branchScope: BranchScope;
}

export type Actor = PlatformActor | MerchantActor;

export const PLATFORM_PERMISSION_PREFIX = 'platform:';

/** Roles whose access is limited to explicitly assigned branches. */
export const BRANCH_RESTRICTED_ROLES: ReadonlySet<string> = new Set(['STAFF']);

export function isPlatformPermission(permission: string): boolean {
  return permission.startsWith(PLATFORM_PERMISSION_PREFIX);
}

/** Platform permissions require a platform actor; everything else requires a merchant actor. */
export function actorHasPermission(actor: Actor, permission: string): boolean {
  if (isPlatformPermission(permission) !== (actor.kind === 'platform')) return false;
  return actor.permissions.has(permission);
}

export function canAccessBranch(actor: MerchantActor, branchId: string): boolean {
  return actor.branchScope === 'ALL' || actor.branchScope.includes(branchId);
}

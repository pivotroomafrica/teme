import { Actor, MerchantActor, PlatformActor, actorHasPermission, canAccessBranch } from './actor';

const merchant = (
  perms: string[],
  branchScope: MerchantActor['branchScope'] = 'ALL',
): MerchantActor => ({
  kind: 'merchant',
  userId: 'u',
  roleKey: 'OWNER',
  merchantId: 'm',
  staffMembershipId: 's',
  permissions: new Set(perms),
  branchScope,
});
const platform = (perms: string[]): PlatformActor => ({
  kind: 'platform',
  userId: 'p',
  roleKey: 'PLATFORM_ADMIN',
  permissions: new Set(perms),
});

describe('actorHasPermission', () => {
  it('grants a held merchant permission to a merchant actor', () => {
    expect(actorHasPermission(merchant(['staff:read']), 'staff:read')).toBe(true);
    expect(actorHasPermission(merchant(['staff:read']), 'staff:manage')).toBe(false);
  });

  it('never lets a merchant actor satisfy a platform permission, even if listed', () => {
    const sneaky: Actor = merchant(['platform:manage']);
    expect(actorHasPermission(sneaky, 'platform:manage')).toBe(false);
  });

  it('never lets a platform actor satisfy a merchant permission, even if listed', () => {
    const sneaky: Actor = platform(['staff:read']);
    expect(actorHasPermission(sneaky, 'staff:read')).toBe(false);
    expect(actorHasPermission(platform(['platform:manage']), 'platform:manage')).toBe(true);
  });
});

describe('canAccessBranch', () => {
  it('allows every branch for ALL scope', () => {
    expect(canAccessBranch(merchant([], 'ALL'), 'any')).toBe(true);
  });
  it('limits scoped actors to assigned branches', () => {
    const a = merchant([], ['b1', 'b2']);
    expect(canAccessBranch(a, 'b1')).toBe(true);
    expect(canAccessBranch(a, 'b3')).toBe(false);
    expect(canAccessBranch(merchant([], []), 'b1')).toBe(false);
  });
});

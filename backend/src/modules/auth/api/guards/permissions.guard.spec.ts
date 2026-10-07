import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AuthenticatedOnly,
  Permissions,
  Public,
} from '../../../../common/decorators/access.decorators';
import type { Actor } from '../../../tenancy';
import { PermissionsGuard } from './permissions.guard';

class Routes {
  @Public() open() {}
  @AuthenticatedOnly() anyone() {}
  @Permissions('staff:read') staff() {}
  @Permissions('platform:manage') platform() {}
  forgotten() {}
}

const merchant: Actor = {
  kind: 'merchant',
  userId: 'u',
  roleKey: 'MANAGER',
  merchantId: 'm',
  staffMembershipId: 's',
  permissions: new Set(['staff:read', 'platform:manage']),
  branchScope: 'ALL',
};
const platform: Actor = {
  kind: 'platform',
  userId: 'p',
  roleKey: 'PLATFORM_ADMIN',
  permissions: new Set(['platform:manage']),
};

function ctx(handler: keyof Routes, actor?: Actor): ExecutionContext {
  return {
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => ({ actor }) }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('allows public routes without an actor', () => {
    expect(guard.canActivate(ctx('open'))).toBe(true);
  });

  it('requires an actor on non-public routes', () => {
    expect(() => guard.canActivate(ctx('anyone'))).toThrow(/Authentication required/);
  });

  it('allows any authenticated actor on @AuthenticatedOnly routes', () => {
    expect(guard.canActivate(ctx('anyone', merchant))).toBe(true);
    expect(guard.canActivate(ctx('anyone', platform))).toBe(true);
  });

  it('fails closed on routes with no access declaration', () => {
    expect(() => guard.canActivate(ctx('forgotten', merchant))).toThrow(/permission/);
    expect(() => guard.canActivate(ctx('forgotten', platform))).toThrow(/permission/);
  });

  it('enforces permissions and keeps platform and merchant permissions apart', () => {
    expect(guard.canActivate(ctx('staff', merchant))).toBe(true);
    expect(() => guard.canActivate(ctx('staff', platform))).toThrow(/permission/);
    expect(guard.canActivate(ctx('platform', platform))).toBe(true);
    // A merchant actor listing a platform permission still cannot use platform routes.
    expect(() => guard.canActivate(ctx('platform', merchant))).toThrow(/permission/);
  });
});

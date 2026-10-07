import { assertCanInvite, assertCanManageStaff } from './staff-policy';

const owner = { staffMembershipId: 'o1', roleKey: 'OWNER' };
const manager = { staffMembershipId: 'm1', roleKey: 'MANAGER' };
const staff = { staffMembershipId: 's1', roleKey: 'STAFF' };

describe('assertCanManageStaff', () => {
  it('blocks everyone from changing themselves', () => {
    for (const actor of [owner, manager, staff]) {
      expect(() =>
        assertCanManageStaff(
          actor,
          { id: actor.staffMembershipId, roleKey: actor.roleKey },
          'OWNER',
        ),
      ).toThrow(/own role/);
    }
  });

  it('lets owners manage managers, staff and other owners', () => {
    for (const roleKey of ['OWNER', 'MANAGER', 'STAFF']) {
      expect(() => assertCanManageStaff(owner, { id: 'x', roleKey }, 'MANAGER')).not.toThrow();
    }
  });

  it('lets managers manage staff but not escalate them', () => {
    expect(() => assertCanManageStaff(manager, { id: 'x', roleKey: 'STAFF' })).not.toThrow();
    expect(() => assertCanManageStaff(manager, { id: 'x', roleKey: 'STAFF' }, 'MANAGER')).toThrow(
      /cannot grant/,
    );
    expect(() => assertCanManageStaff(manager, { id: 'x', roleKey: 'STAFF' }, 'OWNER')).toThrow(
      /cannot grant/,
    );
  });

  it('stops managers touching managers or owners', () => {
    expect(() => assertCanManageStaff(manager, { id: 'x', roleKey: 'MANAGER' })).toThrow(
      /only manage branch staff/,
    );
    expect(() => assertCanManageStaff(manager, { id: 'x', roleKey: 'OWNER' })).toThrow(
      /only manage branch staff/,
    );
  });

  it('denies branch staff', () => {
    expect(() => assertCanManageStaff(staff, { id: 'x', roleKey: 'STAFF' })).toThrow(/permission/);
  });
});

describe('assertCanInvite', () => {
  it('lets owners invite any role', () => {
    for (const role of ['OWNER', 'MANAGER', 'STAFF'])
      expect(() => assertCanInvite(owner, role)).not.toThrow();
  });
  it('lets managers invite branch staff only', () => {
    expect(() => assertCanInvite(manager, 'STAFF')).not.toThrow();
    expect(() => assertCanInvite(manager, 'MANAGER')).toThrow(/only invite branch staff/);
    expect(() => assertCanInvite(manager, 'OWNER')).toThrow(/only invite branch staff/);
  });
  it('denies branch staff', () => {
    expect(() => assertCanInvite(staff, 'STAFF')).toThrow(/permission/);
  });
});

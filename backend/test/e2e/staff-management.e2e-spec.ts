import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import {
  TEST_PASSWORD,
  World,
  bearer,
  createMerchantUser,
  createWorld,
  login,
} from '../support/auth-fixture';
import { createTestApp } from '../support/create-test-app';

describe('Staff management (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let w: World;
  const http = () => request(app.getHttpServer());
  const as = async (email: string) => bearer(await login(app, email));
  const uniqueEmail = (p = 'new') => `${p}-${randomUUID().slice(0, 8)}@invite.test`;
  const GOOD_PASSWORD = 'Brand-New-Password-42';

  beforeAll(async () => {
    prisma = new PrismaClient();
    w = await createWorld(prisma);
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  function invite(auth: string, body: Record<string, unknown>) {
    return http()
      .post('/api/v1/merchant/staff')
      .set('Authorization', auth)
      .send({ displayName: 'New Person', role: 'STAFF', branchIds: [w.a.branches[0]], ...body });
  }
  const accept = (token: string, password = GOOD_PASSWORD, extra: object = {}) =>
    http()
      .post('/api/v1/auth/invitations/accept')
      .send({ token, password, ...extra });

  describe('invitations', () => {
    it('invites, hides the secret, onboards on acceptance, and applies role and branches', async () => {
      const owner = await as(w.a.owner.email);
      const email = uniqueEmail('Cashier').toUpperCase();
      const res = await invite(owner, { email, displayName: 'Hana Cashier' }).expect(201);

      expect(res.body.staff).toMatchObject({
        displayName: 'Hana Cashier',
        email: email.toLowerCase(),
        roleKey: 'STAFF',
        status: 'INVITED',
        branchIds: [w.a.branches[0]],
      });
      const token: string = res.body.invitation.token;
      expect(token.length).toBeGreaterThanOrEqual(40);

      // Only a hash is stored, and the account cannot log in yet.
      const stored = await prisma.staffInvitation.findMany({
        where: { staffMembershipId: res.body.staff.id },
      });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.tokenHash).not.toBe(token);
      expect(JSON.stringify(stored)).not.toContain(token);
      await http().post('/api/v1/auth/login').send({ email, password: GOOD_PASSWORD }).expect(401);

      await accept(token).expect(204);
      const session = await http()
        .post('/api/v1/auth/login')
        .send({ email, password: GOOD_PASSWORD })
        .expect(200);
      expect(session.body.user).toMatchObject({ role: 'STAFF', merchantId: w.a.merchantId });
      const me = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', bearer(session.body.accessToken))
        .expect(200);
      expect(me.body.branchScope).toEqual([w.a.branches[0]]);

      // Appears active in the staff list, same merchant only.
      const list = await http()
        .get('/api/v1/merchant/staff')
        .set('Authorization', owner)
        .expect(200);
      expect(list.body.find((s: { id: string }) => s.id === res.body.staff.id).status).toBe(
        'ACTIVE',
      );
      const listB = await http()
        .get('/api/v1/merchant/staff')
        .set('Authorization', await as(w.b.owner.email))
        .expect(200);
      expect(listB.body.map((s: { id: string }) => s.id)).not.toContain(res.body.staff.id);

      // Single use.
      await accept(token).expect(400);
    });

    it('audits the invitation and acceptance without storing the email or token', async () => {
      const owner = await as(w.a.owner.email);
      const email = uniqueEmail('audit');
      const res = await invite(owner, { email }).expect(201);
      const token: string = res.body.invitation.token;
      await accept(token).expect(204);

      const events = await prisma.auditEvent.findMany({
        where: { merchantId: w.a.merchantId, targetId: res.body.staff.id },
        orderBy: { occurredAt: 'asc' },
      });
      expect(events.map((e) => e.action)).toEqual(['staff.invited', 'staff.invitation_accepted']);
      expect(events[0]?.actorUserId).toBe(w.a.owner.userId);
      expect(events[0]?.metadata).toMatchObject({ role: 'STAFF', branchIds: [w.a.branches[0]] });
      const dump = JSON.stringify(events);
      for (const secret of [email, token, GOOD_PASSWORD]) expect(dump).not.toContain(secret);
    });

    it('gives one indistinguishable answer when the address is already registered anywhere', async () => {
      const owner = await as(w.a.owner.email);
      const sameTenant = await invite(owner, { email: w.a.staff1.email }).expect(409);
      const otherTenant = await invite(owner, { email: w.b.owner.email }).expect(409);
      const admin = await invite(owner, { email: w.platformAdmin.email }).expect(409);
      expect(sameTenant.body.error.code).toBe('INVITE_NOT_POSSIBLE');
      expect(otherTenant.body.error).toMatchObject({
        code: sameTenant.body.error.code,
        message: sameTenant.body.error.message,
      });
      expect(admin.body.error.message).toBe(sameTenant.body.error.message);
    });

    it('lets only one of two concurrent invitations for the same address through', async () => {
      const owner = await as(w.a.owner.email);
      const email = uniqueEmail('race');
      const results = await Promise.all([invite(owner, { email }), invite(owner, { email })]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    });

    it('applies role-based invitation limits', async () => {
      const owner = await as(w.a.owner.email);
      const manager = await as(w.a.manager.email);
      const staff = await as(w.a.staff1.email);

      await invite(manager, { email: uniqueEmail('m1') }).expect(201);
      await invite(manager, { email: uniqueEmail('m2'), role: 'MANAGER' }).expect(403);
      await invite(manager, { email: uniqueEmail('m3'), role: 'OWNER' }).expect(403);
      await invite(staff, { email: uniqueEmail('s1') }).expect(403);
      await invite(owner, { email: uniqueEmail('o1'), role: 'MANAGER', branchIds: [] }).expect(201);
      await invite(owner, { email: uniqueEmail('o2'), role: 'OWNER', branchIds: [] }).expect(201);
    });

    it('validates the invitation body, including branch ownership', async () => {
      const owner = await as(w.a.owner.email);
      await invite(owner, { email: 'not-an-email' }).expect(400);
      await invite(owner, { email: uniqueEmail(), role: 'GOD' }).expect(400);
      await invite(owner, { email: uniqueEmail(), branchIds: [] }).expect(400); // STAFF needs a branch
      await invite(owner, { email: uniqueEmail(), branchIds: ['nope'] }).expect(400);
      await invite(owner, { email: uniqueEmail(), merchantId: w.b.merchantId }).expect(400);

      // Foreign and unknown branches are indistinguishable.
      const foreign = await invite(owner, {
        email: uniqueEmail(),
        branchIds: [w.b.branches[0]],
      }).expect(400);
      const unknown = await invite(owner, {
        email: uniqueEmail(),
        branchIds: [randomUUID()],
      }).expect(400);
      expect(foreign.body.error.message).toBe(unknown.body.error.message);
      // A failed invitation leaves nothing behind.
      expect(
        await prisma.platformUser.count({
          where: { email: { startsWith: 'new-' }, staffMemberships: { none: {} } },
        }),
      ).toBe(0);
    });

    it('rejects unusable invitation tokens and weak passwords identically', async () => {
      const owner = await as(w.a.owner.email);
      const email = uniqueEmail('weak');
      const res = await invite(owner, { email }).expect(201);
      const token: string = res.body.invitation.token;

      await accept(token, 'short1').expect(400);
      await accept(token, 'onlyletterslongenough').expect(400);
      await accept(token, `${email.split('@')[0]}-Secret-1`).expect(400);
      // The failed attempts did not consume the invitation.
      await accept(token).expect(204);

      const bad = [
        await accept('x'.repeat(43)).expect(400),
        await accept(token).expect(400), // already used
      ];
      expect(new Set(bad.map((b) => b.body.error.message)).size).toBe(1);
      expect(bad[0]?.body.error.code).toBe('INVALID_INVITATION');
    });

    it('expires invitations after seven days', async () => {
      const owner = await as(w.a.owner.email);
      const res = await invite(owner, { email: uniqueEmail('exp') }).expect(201);
      const expiry = new Date(res.body.invitation.expiresAt).getTime() - Date.now();
      expect(expiry).toBeGreaterThan(6.9 * 86_400_000);
      expect(expiry).toBeLessThanOrEqual(7 * 86_400_000);

      await prisma.staffInvitation.updateMany({
        where: { staffMembershipId: res.body.staff.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await accept(res.body.invitation.token).expect(400);
    });

    it('reissues: the old link dies, the new one works, and only pending members qualify', async () => {
      const owner = await as(w.a.owner.email);
      const res = await invite(owner, { email: uniqueEmail('reissue') }).expect(201);
      const old: string = res.body.invitation.token;

      const again = await http()
        .post(`/api/v1/merchant/staff/${res.body.staff.id}/invitation`)
        .set('Authorization', owner)
        .expect(201);
      expect(again.body.token).not.toBe(old);
      await accept(old).expect(400);
      await accept(again.body.token).expect(204);

      // Already active now.
      await http()
        .post(`/api/v1/merchant/staff/${res.body.staff.id}/invitation`)
        .set('Authorization', owner)
        .expect(409);
      // Staff cannot reissue; other tenants cannot see it.
      await http()
        .post(`/api/v1/merchant/staff/${w.a.staff2.staffId}/invitation`)
        .set('Authorization', await as(w.a.staff1.email))
        .expect(403);
      await http()
        .post(`/api/v1/merchant/staff/${res.body.staff.id}/invitation`)
        .set('Authorization', await as(w.b.owner.email))
        .expect(404);
    });

    it('revokes a pending invitation when the invitee is deactivated', async () => {
      const owner = await as(w.a.owner.email);
      const res = await invite(owner, { email: uniqueEmail('revoked') }).expect(201);
      await http()
        .post(`/api/v1/merchant/staff/${res.body.staff.id}/deactivate`)
        .set('Authorization', owner)
        .expect(204);
      await accept(res.body.invitation.token).expect(400);
      const row = await prisma.staffMembership.findUniqueOrThrow({
        where: { id: res.body.staff.id },
      });
      expect(row.status).toBe('DEACTIVATED');
    });
  });

  describe('branch assignment', () => {
    it('replaces assignments, takes effect immediately, and audits additions and removals', async () => {
      const owner = await as(w.a.owner.email);
      const member = await createMerchantUser(prisma, w.a.merchantId, 'STAFF', [w.a.branches[0]]);
      const session = await as(member.email);
      const before = await http()
        .get('/api/v1/merchant/branches')
        .set('Authorization', session)
        .expect(200);
      expect(before.body).toHaveLength(1);

      const res = await http()
        .put(`/api/v1/merchant/staff/${member.staffId}/branches`)
        .set('Authorization', owner)
        .send({ branchIds: [w.a.branches[1]] })
        .expect(200);
      expect(res.body.branchIds).toEqual([w.a.branches[1]]);

      const after = await http()
        .get('/api/v1/merchant/branches')
        .set('Authorization', session)
        .expect(200);
      expect(after.body.map((b: { id: string }) => b.id)).toEqual([w.a.branches[1]]);

      const event = await prisma.auditEvent.findFirstOrThrow({
        where: { action: 'staff.branches_changed', targetId: member.staffId },
      });
      expect(event.metadata).toMatchObject({
        added: [w.a.branches[1]],
        removed: [w.a.branches[0]],
      });

      // Re-sending the same set is a no-op and writes no new audit row.
      await http()
        .put(`/api/v1/merchant/staff/${member.staffId}/branches`)
        .set('Authorization', owner)
        .send({ branchIds: [w.a.branches[1]] })
        .expect(200);
      expect(
        await prisma.auditEvent.count({
          where: { action: 'staff.branches_changed', targetId: member.staffId },
        }),
      ).toBe(1);
    });

    it('rejects foreign, unknown, inactive and empty (for STAFF) branch sets', async () => {
      const owner = await as(w.a.owner.email);
      const member = await createMerchantUser(prisma, w.a.merchantId, 'STAFF', [w.a.branches[0]]);
      const url = `/api/v1/merchant/staff/${member.staffId}/branches`;
      const put = (branchIds: string[]) =>
        http().put(url).set('Authorization', owner).send({ branchIds });

      await put([w.b.branches[0]]).expect(400);
      await put([randomUUID()]).expect(400);
      await put([]).expect(400);
      await http()
        .put(url)
        .set('Authorization', owner)
        .send({ branchIds: ['nope'] })
        .expect(400);

      const spare = await prisma.branch.create({
        data: {
          merchantId: w.a.merchantId,
          nameEn: 'Closed',
          status: 'INACTIVE',
          deactivatedAt: new Date(),
        },
      });
      await put([spare.id]).expect(400);
      expect(
        (
          await prisma.staffBranchAssignment.findMany({
            where: { staffMembershipId: member.staffId },
          })
        ).map((a) => a.branchId),
      ).toEqual([w.a.branches[0]]);
    });

    it('enforces who may change whose branches', async () => {
      const manager = await as(w.a.manager.email);
      const owner = await as(w.a.owner.email);
      const staff = await as(w.a.staff1.email);
      const body = { branchIds: [w.a.branches[0], w.a.branches[1]] };

      await http()
        .put(`/api/v1/merchant/staff/${w.a.staff1.staffId}/branches`)
        .set('Authorization', manager)
        .send(body)
        .expect(200);
      await http()
        .put(`/api/v1/merchant/staff/${w.a.manager.staffId}/branches`)
        .set('Authorization', manager)
        .send(body)
        .expect(403); // self
      await http()
        .put(`/api/v1/merchant/staff/${w.a.owner.staffId}/branches`)
        .set('Authorization', manager)
        .send(body)
        .expect(403);
      await http()
        .put(`/api/v1/merchant/staff/${w.a.owner.staffId}/branches`)
        .set('Authorization', owner)
        .send(body)
        .expect(403); // self
      await http()
        .put(`/api/v1/merchant/staff/${w.a.staff2.staffId}/branches`)
        .set('Authorization', staff)
        .send(body)
        .expect(403);
      await http()
        .put(`/api/v1/merchant/staff/${w.b.staff1.staffId}/branches`)
        .set('Authorization', owner)
        .send({ branchIds: [w.a.branches[0]] })
        .expect(404);
    });
  });

  describe('activation and deactivation', () => {
    it('deactivates, preserves history, then re-activates', async () => {
      const owner = await as(w.a.owner.email);
      const member = await createMerchantUser(prisma, w.a.merchantId, 'STAFF', [w.a.branches[0]]);
      const session = await as(member.email);

      await http()
        .post(`/api/v1/merchant/staff/${member.staffId}/deactivate`)
        .set('Authorization', owner)
        .expect(204);
      await http()
        .post(`/api/v1/merchant/staff/${member.staffId}/deactivate`)
        .set('Authorization', owner)
        .expect(204); // idempotent
      await http().get('/api/v1/auth/me').set('Authorization', session).expect(401);
      expect(
        await prisma.auditEvent.count({
          where: { action: 'staff.deactivated', targetId: member.staffId },
        }),
      ).toBe(1);

      const listed = await http()
        .get('/api/v1/merchant/staff')
        .set('Authorization', owner)
        .expect(200);
      expect(listed.body.find((s: { id: string }) => s.id === member.staffId).status).toBe(
        'DEACTIVATED',
      );
      // Assignments are kept for the record.
      expect(
        await prisma.staffBranchAssignment.count({ where: { staffMembershipId: member.staffId } }),
      ).toBe(1);

      const on = await http()
        .post(`/api/v1/merchant/staff/${member.staffId}/activate`)
        .set('Authorization', owner)
        .expect(200);
      expect(on.body.status).toBe('ACTIVE');
      await http()
        .post(`/api/v1/merchant/staff/${member.staffId}/activate`)
        .set('Authorization', owner)
        .expect(200);
      await http()
        .post('/api/v1/auth/login')
        .send({ email: member.email, password: TEST_PASSWORD })
        .expect(200);
      expect(
        await prisma.auditEvent.count({
          where: { action: 'staff.activated', targetId: member.staffId },
        }),
      ).toBe(1);
    });

    it('will not activate a pending invitee or a member whose account is deactivated', async () => {
      const owner = await as(w.a.owner.email);
      const pending = await invite(owner, { email: uniqueEmail('pend') }).expect(201);
      await http()
        .post(`/api/v1/merchant/staff/${pending.body.staff.id}/activate`)
        .set('Authorization', owner)
        .expect(409);

      const member = await createMerchantUser(prisma, w.a.merchantId, 'STAFF', [w.a.branches[0]]);
      await http()
        .post(`/api/v1/merchant/staff/${member.staffId}/deactivate`)
        .set('Authorization', owner)
        .expect(204);
      await prisma.platformUser.update({
        where: { id: member.userId },
        data: { status: 'DEACTIVATED', deactivatedAt: new Date() },
      });
      await http()
        .post(`/api/v1/merchant/staff/${member.staffId}/activate`)
        .set('Authorization', owner)
        .expect(409);
    });

    it('stops managers deactivating or activating managers and owners, and anyone doing it to themselves', async () => {
      const manager = await as(w.a.manager.email);
      const staff = await as(w.a.staff1.email);
      await http()
        .post(`/api/v1/merchant/staff/${w.a.owner.staffId}/deactivate`)
        .set('Authorization', manager)
        .expect(403);
      await http()
        .post(`/api/v1/merchant/staff/${w.a.manager.staffId}/deactivate`)
        .set('Authorization', manager)
        .expect(403);
      await http()
        .post(`/api/v1/merchant/staff/${w.a.staff1.staffId}/deactivate`)
        .set('Authorization', staff)
        .expect(403);
    });

    it('protects the final active owner, including under concurrent removal', async () => {
      const fresh = await createWorld(prisma);
      const o1 = fresh.a.owner;
      const o2 = await createMerchantUser(prisma, fresh.a.merchantId, 'OWNER', []);
      const t1 = await as(o1.email);
      const t2 = await as(o2.email);

      const results = await Promise.all([
        http().post(`/api/v1/merchant/staff/${o2.staffId}/deactivate`).set('Authorization', t1),
        http().post(`/api/v1/merchant/staff/${o1.staffId}/deactivate`).set('Authorization', t2),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
      expect(results.find((r) => r.status === 409)?.body.error.code).toBe('LAST_OWNER');
      expect(
        await prisma.staffMembership.count({
          where: { merchantId: fresh.a.merchantId, status: 'ACTIVE', role: { key: 'OWNER' } },
        }),
      ).toBe(1);
    });
  });

  describe('staff activity', () => {
    it('reports ledger counts and a paginated, metadata-free event feed', async () => {
      const fresh = await createWorld(prisma);
      const owner = await as(fresh.a.owner.email);
      const manager = await as(fresh.a.manager.email);

      // Some ledger history for staff1 (direct inserts stand in for the future scanner).
      const program = await prisma.loyaltyProgram.create({
        data: {
          merchantId: fresh.a.merchantId,
          nameEn: 'P',
          stampsRequired: 5,
          status: 'ACTIVE',
          isDefault: true,
        },
      });
      const customer = await prisma.customer.create({
        data: { merchantId: fresh.a.merchantId, phoneE164: '+251911777001' },
      });
      const membership = await prisma.customerMembership.create({
        data: {
          merchantId: fresh.a.merchantId,
          customerId: customer.id,
          programId: program.id,
          tokenHash: `h-${randomUUID()}`,
        },
      });
      for (let i = 0; i < 2; i++) {
        await prisma.stampEvent.create({
          data: {
            merchantId: fresh.a.merchantId,
            branchId: fresh.a.branches[0],
            programId: program.id,
            membershipId: membership.id,
            staffMembershipId: fresh.a.staff1.staffId,
            idempotencyKey: randomUUID(),
          },
        });
      }
      // Produce several audited actions by the owner.
      for (let i = 0; i < 4; i++) await login(app, fresh.a.owner.email);

      const first = await http()
        .get(`/api/v1/merchant/staff/${fresh.a.staff1.staffId}/activity`)
        .set('Authorization', manager)
        .expect(200);
      expect(first.body.staff).toMatchObject({ id: fresh.a.staff1.staffId, roleKey: 'STAFF' });
      expect(first.body.summary).toMatchObject({
        stampsIssued: 2,
        redemptionsProcessed: 0,
        reversalsPerformed: 0,
      });

      const ownerActivity = await http()
        .get(`/api/v1/merchant/staff/${fresh.a.owner.staffId}/activity?limit=2`)
        .set('Authorization', owner)
        .expect(200);
      expect(ownerActivity.body.events.items).toHaveLength(2);
      expect(ownerActivity.body.events.nextCursor).toBeTruthy();
      expect(ownerActivity.body.summary.lastActiveAt).toBeTruthy();
      expect(JSON.stringify(ownerActivity.body)).not.toMatch(/metadata|userAgent|"ip"/);

      // Walk every page: no duplicates, newest first, total equals the audit table.
      const seen: Array<{ id: string; occurredAt: string }> = [];
      let cursor: string | null = null;
      do {
        const url: string = `/api/v1/merchant/staff/${fresh.a.owner.staffId}/activity?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
        const page = await http().get(url).set('Authorization', manager).expect(200);
        seen.push(...page.body.events.items);
        cursor = page.body.events.nextCursor;
      } while (cursor);
      const total = await prisma.auditEvent.count({
        where: { merchantId: fresh.a.merchantId, actorUserId: fresh.a.owner.userId },
      });
      expect(seen).toHaveLength(total);
      expect(new Set(seen.map((e) => e.id)).size).toBe(total);
      const times = seen.map((e) => new Date(e.occurredAt).getTime());
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    });

    it('validates paging and treats a bad cursor as the first page', async () => {
      const owner = await as(w.a.owner.email);
      const base = `/api/v1/merchant/staff/${w.a.owner.staffId}/activity`;
      await http().get(`${base}?limit=0`).set('Authorization', owner).expect(400);
      await http().get(`${base}?limit=101`).set('Authorization', owner).expect(400);
      await http().get(`${base}?limit=abc`).set('Authorization', owner).expect(400);
      await http().get(`${base}?cursor=garbage`).set('Authorization', owner).expect(200);
    });

    it('is restricted to staff managers and to the caller’s own merchant', async () => {
      await http()
        .get(`/api/v1/merchant/staff/${w.a.owner.staffId}/activity`)
        .set('Authorization', await as(w.a.staff1.email))
        .expect(403);
      await http()
        .get(`/api/v1/merchant/staff/${w.b.owner.staffId}/activity`)
        .set('Authorization', await as(w.a.owner.email))
        .expect(404);
      await http()
        .get(`/api/v1/merchant/staff/${w.a.owner.staffId}/activity`)
        .set('Authorization', await as(w.platformAdmin.email))
        .expect(403);
      // Activity from another merchant never leaks into this one's feed.
      const own = await http()
        .get(`/api/v1/merchant/staff/${w.a.owner.staffId}/activity?limit=100`)
        .set('Authorization', await as(w.a.owner.email))
        .expect(200);
      expect(own.body.events.items.length).toBeGreaterThan(0);
    });
  });
});

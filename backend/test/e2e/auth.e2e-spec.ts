import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from '../support/create-test-app';
import {
  TEST_PASSWORD,
  World,
  bearer,
  createMerchantUser,
  createWorld,
  login,
} from '../support/auth-fixture';

describe('Authentication, authorization and tenant isolation (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let world: World;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    prisma = new PrismaClient();
    world = await createWorld(prisma);
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('unauthenticated access', () => {
    const routes: Array<['get' | 'post' | 'patch', string]> = [
      ['get', '/api/v1/auth/me'],
      ['post', '/api/v1/auth/logout-all'],
      ['get', '/api/v1/merchant/branches'],
      ['get', '/api/v1/merchant/staff'],
      ['get', '/api/v1/platform/merchants'],
      ['patch', '/api/v1/merchant/staff/00000000-0000-4000-8000-000000000000/role'],
      ['post', '/api/v1/platform/users/00000000-0000-4000-8000-000000000000/deactivate'],
    ];

    it.each(routes)('rejects %s %s without a token', async (method, path) => {
      const res = await http()[method](path);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects malformed, forged, wrong-algorithm and expired tokens', async () => {
      const jwt = app.get(JwtService);
      const s = await login(app, world.a.owner.email);
      const claims = { sub: world.a.owner.userId, typ: 'merchant', use: 'access' };
      const bad = [
        'Bearer not-a-jwt',
        'Basic abc',
        `Bearer ${await jwt.signAsync(claims, { secret: 'x'.repeat(40), issuer: 'temelashcard' })}`,
        `Bearer ${await jwt.signAsync(claims, { secret: process.env.JWT_ACCESS_SECRET, issuer: 'attacker' })}`,
        `Bearer ${await jwt.signAsync(claims, { secret: process.env.JWT_ACCESS_SECRET, issuer: 'temelashcard', algorithm: 'HS512' })}`,
        `Bearer ${await jwt.signAsync(
          { ...claims, sid: world.a.owner.staffId, mid: world.a.merchantId, exp: 1 },
          { secret: process.env.JWT_ACCESS_SECRET, issuer: 'temelashcard', noTimestamp: true },
        )}`,
        // alg=none
        `Bearer ${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`,
        // a refresh token is not an access token
        `Bearer ${s.refreshToken}`,
      ];
      for (const header of bad) {
        await http().get('/api/v1/auth/me').set('Authorization', header).expect(401);
      }
    });

    it('rejects a correctly signed token whose merchant claim does not match the database', async () => {
      const jwt = app.get(JwtService);
      const forged = await jwt.signAsync(
        {
          sub: world.a.staff1.userId,
          typ: 'merchant',
          sid: world.a.staff1.staffId,
          mid: world.b.merchantId, // claims tenant B
          use: 'access',
        },
        { secret: process.env.JWT_ACCESS_SECRET, issuer: 'temelashcard', expiresIn: 60 },
      );
      await http()
        .get('/api/v1/merchant/branches')
        .set('Authorization', bearer(forged))
        .expect(401);
    });
  });

  describe('login', () => {
    it('returns tokens and the principal without leaking security fields', async () => {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({
          email: world.a.owner.email.toUpperCase(),
          password: TEST_PASSWORD,
          deviceLabel: 'jest',
        })
        .expect(200);
      expect(res.body).toMatchObject({
        tokenType: 'Bearer',
        user: { role: 'OWNER', merchantId: world.a.merchantId, accountType: 'MERCHANT_USER' },
      });
      expect(res.body.accessToken.split('.')).toHaveLength(3);
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(
        /passwordHash|password_hash|tokenHash|argon2|failedLogin|lockedUntil/,
      );
    });

    it('gives identical errors for unknown account, wrong password and deactivated account', async () => {
      const deactivated = await createDeactivatedUser();
      const attempts = [
        { email: 'nobody@t.test', password: TEST_PASSWORD },
        { email: world.a.owner.email, password: 'wrong-password' },
        { email: deactivated, password: TEST_PASSWORD },
      ];
      const bodies = [];
      for (const a of attempts) {
        const res = await http().post('/api/v1/auth/login').send(a).expect(401);
        bodies.push({ code: res.body.error.code, message: res.body.error.message });
      }
      expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
      expect(bodies[0]?.code).toBe('INVALID_CREDENTIALS');
    });

    it('validates the request body', async () => {
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email', password: 'x' })
        .expect(400);
      await http().post('/api/v1/auth/login').send({ email: 'a@b.test' }).expect(400);
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'a@b.test', password: 'x', admin: true })
        .expect(400);
    });

    it('locks an account temporarily after repeated failures, even for the right password', async () => {
      const email = await createFreshUser();
      for (let i = 0; i < 10; i++) {
        await http().post('/api/v1/auth/login').send({ email, password: 'wrong' }).expect(401);
      }
      await http().post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD }).expect(401);
      // Lock expiry restores access.
      await prisma.platformUser.update({
        where: { email },
        data: { lockedUntil: new Date(Date.now() - 1000) },
      });
      await http().post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD }).expect(200);
    });
  });

  describe('account deactivation', () => {
    it('blocks login, existing access tokens and refresh once an account is deactivated', async () => {
      const email = await createFreshUser();
      const session = await login(app, email);
      await http().get('/api/v1/auth/me').set('Authorization', bearer(session)).expect(200);

      await prisma.platformUser.update({
        where: { email },
        data: { status: 'DEACTIVATED', deactivatedAt: new Date() },
      });

      await http().post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD }).expect(401);
      await http().get('/api/v1/auth/me').set('Authorization', bearer(session)).expect(401);
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);
    });

    it('cuts off a staff member the moment their membership is deactivated', async () => {
      const session = await login(app, world.a.staff2.email);
      await http()
        .get('/api/v1/merchant/branches')
        .set('Authorization', bearer(session))
        .expect(200);

      const owner = await login(app, world.a.owner.email);
      await http()
        .post(`/api/v1/merchant/staff/${world.a.staff2.staffId}/deactivate`)
        .set('Authorization', bearer(owner))
        .expect(204);

      await http()
        .get('/api/v1/merchant/branches')
        .set('Authorization', bearer(session))
        .expect(401);
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);
      await http()
        .post('/api/v1/auth/login')
        .send({ email: world.a.staff2.email, password: TEST_PASSWORD })
        .expect(401);

      // History is preserved: the row still exists and is marked deactivated.
      const row = await prisma.staffMembership.findUniqueOrThrow({
        where: { id: world.a.staff2.staffId },
      });
      expect(row.status).toBe('DEACTIVATED');
      expect(row.deactivatedAt).not.toBeNull();
    });
  });

  describe('refresh tokens', () => {
    it('rotates on every use and returns a working new pair', async () => {
      const first = await login(app, world.a.manager.email);
      const res = await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200);
      expect(res.body.refreshToken).not.toBe(first.refreshToken);
      await http()
        .get('/api/v1/auth/me')
        .set('Authorization', bearer(res.body.accessToken))
        .expect(200);
    });

    it('rejects a revoked (already rotated) token and revokes the whole device session', async () => {
      const first = await login(app, world.a.manager.email);
      const second = await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200);

      // Reusing the old token is treated as theft...
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(401);
      // ...which also kills the legitimately rotated token.
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: second.body.refreshToken })
        .expect(401);

      const audit = await prisma.auditEvent.findFirst({
        where: { action: 'auth.refresh_reuse_detected', actorUserId: world.a.manager.userId },
      });
      expect(audit).not.toBeNull();
    });

    it('allows only one of two concurrent refreshes of the same token', async () => {
      const s = await login(app, world.a.manager.email);
      const results = await Promise.all([
        http().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken }),
        http().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    });

    it('rejects unknown, malformed and expired tokens', async () => {
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'a'.repeat(43) })
        .expect(401);
      await http().post('/api/v1/auth/refresh').send({ refreshToken: 'short' }).expect(400);
      const s = await login(app, world.a.manager.email);
      await prisma.refreshToken.updateMany({
        where: { userId: world.a.manager.userId, revokedAt: null },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await http().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401);
    });

    it('logs out one device without touching the others', async () => {
      const phone = await login(app, world.a.manager.email);
      const tablet = await login(app, world.a.manager.email);
      await http()
        .post('/api/v1/auth/logout')
        .send({ refreshToken: phone.refreshToken })
        .expect(204);
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: phone.refreshToken })
        .expect(401);
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: tablet.refreshToken })
        .expect(200);
    });

    it('logout is idempotent and reveals nothing about token validity', async () => {
      await http()
        .post('/api/v1/auth/logout')
        .send({ refreshToken: 'z'.repeat(43) })
        .expect(204);
    });

    it('logs out of all devices', async () => {
      const phone = await login(app, world.a.manager.email);
      const tablet = await login(app, world.a.manager.email);
      await http().post('/api/v1/auth/logout-all').set('Authorization', bearer(phone)).expect(204);
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: phone.refreshToken })
        .expect(401);
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: tablet.refreshToken })
        .expect(401);
    });

    it('stores only hashes of refresh tokens', async () => {
      const s = await login(app, world.a.manager.email);
      const rows = await prisma.refreshToken.findMany({
        where: { userId: world.a.manager.userId },
      });
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.tokenHash).not.toBe(s.refreshToken);
        expect(r.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      }
    });
  });

  describe('role-based permissions', () => {
    it('lets managers and owners, but not branch staff, view staff', async () => {
      const owner = await login(app, world.a.owner.email);
      const manager = await login(app, world.a.manager.email);
      const staff = await login(app, world.a.staff1.email);
      await http().get('/api/v1/merchant/staff').set('Authorization', bearer(owner)).expect(200);
      await http().get('/api/v1/merchant/staff').set('Authorization', bearer(manager)).expect(200);
      const res = await http()
        .get('/api/v1/merchant/staff')
        .set('Authorization', bearer(staff))
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('stops branch staff using manager operations', async () => {
      const staff = await login(app, world.a.staff1.email);
      const other = world.a.staff2.staffId;
      await http()
        .patch(`/api/v1/merchant/staff/${other}/role`)
        .set('Authorization', bearer(staff))
        .send({ role: 'MANAGER' })
        .expect(403);
      await http()
        .post(`/api/v1/merchant/staff/${other}/deactivate`)
        .set('Authorization', bearer(staff))
        .expect(403);
    });

    it('prevents self-promotion at every level', async () => {
      const staff = await login(app, world.a.staff1.email);
      const manager = await login(app, world.a.manager.email);
      const owner = await login(app, world.a.owner.email);
      await http()
        .patch(`/api/v1/merchant/staff/${world.a.staff1.staffId}/role`)
        .set('Authorization', bearer(staff))
        .send({ role: 'OWNER' })
        .expect(403);
      await http()
        .patch(`/api/v1/merchant/staff/${world.a.manager.staffId}/role`)
        .set('Authorization', bearer(manager))
        .send({ role: 'OWNER' })
        .expect(403);
      await http()
        .patch(`/api/v1/merchant/staff/${world.a.owner.staffId}/role`)
        .set('Authorization', bearer(owner))
        .send({ role: 'STAFF' })
        .expect(403);
    });

    it('stops managers promoting staff or touching owners and managers', async () => {
      const manager = await login(app, world.a.manager.email);
      await http()
        .patch(`/api/v1/merchant/staff/${world.a.staff1.staffId}/role`)
        .set('Authorization', bearer(manager))
        .send({ role: 'MANAGER' })
        .expect(403);
      await http()
        .post(`/api/v1/merchant/staff/${world.a.owner.staffId}/deactivate`)
        .set('Authorization', bearer(manager))
        .expect(403);
    });

    it('rejects unknown roles and client-supplied merchant ids', async () => {
      const owner = await login(app, world.a.owner.email);
      const url = `/api/v1/merchant/staff/${world.a.staff1.staffId}/role`;
      await http().patch(url).set('Authorization', bearer(owner)).send({ role: 'GOD' }).expect(400);
      await http()
        .patch(url)
        .set('Authorization', bearer(owner))
        .send({ role: 'STAFF', merchantId: world.b.merchantId })
        .expect(400);
    });
  });

  describe('branch scope', () => {
    it('shows branch staff only their assigned branches', async () => {
      const staff = await login(app, world.a.staff1.email);
      const list = await http()
        .get('/api/v1/merchant/branches')
        .set('Authorization', bearer(staff))
        .expect(200);
      expect(list.body.map((b: { id: string }) => b.id)).toEqual([world.a.branches[0]]);

      await http()
        .get(`/api/v1/merchant/branches/${world.a.branches[0]}`)
        .set('Authorization', bearer(staff))
        .expect(200);
      // Same merchant, but not assigned: indistinguishable from a missing branch.
      await http()
        .get(`/api/v1/merchant/branches/${world.a.branches[1]}`)
        .set('Authorization', bearer(staff))
        .expect(404);
    });

    it('shows owners and managers every branch of their merchant', async () => {
      const manager = await login(app, world.a.manager.email);
      const list = await http()
        .get('/api/v1/merchant/branches')
        .set('Authorization', bearer(manager))
        .expect(200);
      expect(list.body.map((b: { id: string }) => b.id).sort()).toEqual(
        [...world.a.branches].sort(),
      );
    });

    it('reports branch scope through /auth/me', async () => {
      const staff = await login(app, world.a.staff1.email);
      const me = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', bearer(staff))
        .expect(200);
      expect(me.body).toMatchObject({
        kind: 'merchant',
        role: 'STAFF',
        branchScope: [world.a.branches[0]],
      });
      expect(me.body.permissions).toContain('stamp:create');
      expect(me.body.permissions).not.toContain('staff:manage');
    });
  });

  describe('tenant isolation', () => {
    it("never returns another merchant's branches or staff", async () => {
      const ownerA = await login(app, world.a.owner.email);
      const branches = await http()
        .get('/api/v1/merchant/branches')
        .set('Authorization', bearer(ownerA))
        .expect(200);
      const ids = branches.body.map((b: { id: string }) => b.id);
      expect(ids.sort()).toEqual([...world.a.branches].sort());
      for (const b of world.b.branches) expect(ids).not.toContain(b);

      const staff = await http()
        .get('/api/v1/merchant/staff')
        .set('Authorization', bearer(ownerA))
        .expect(200);
      const staffIds = staff.body.map((s: { id: string }) => s.id);
      expect(staffIds).toContain(world.a.manager.staffId);
      expect(staffIds).not.toContain(world.b.manager.staffId);
      expect(JSON.stringify(staff.body)).not.toContain(world.b.owner.email);
    });

    it("answers 404 for another merchant's branch and staff, same as for a missing one", async () => {
      const ownerA = await login(app, world.a.owner.email);
      await http()
        .get(`/api/v1/merchant/branches/${world.b.branches[0]}`)
        .set('Authorization', bearer(ownerA))
        .expect(404);
      await http()
        .patch(`/api/v1/merchant/staff/${world.b.staff1.staffId}/role`)
        .set('Authorization', bearer(ownerA))
        .send({ role: 'MANAGER' })
        .expect(404);
      await http()
        .post(`/api/v1/merchant/staff/${world.b.staff1.staffId}/deactivate`)
        .set('Authorization', bearer(ownerA))
        .expect(404);

      const untouched = await prisma.staffMembership.findUniqueOrThrow({
        where: { id: world.b.staff1.staffId },
      });
      expect(untouched.status).toBe('ACTIVE');
    });

    it('ignores a merchant id supplied in the query string', async () => {
      const ownerA = await login(app, world.a.owner.email);
      const res = await http()
        .get(`/api/v1/merchant/branches?merchantId=${world.b.merchantId}`)
        .set('Authorization', bearer(ownerA))
        .expect(200);
      expect(res.body.map((b: { id: string }) => b.id).sort()).toEqual(
        [...world.a.branches].sort(),
      );
    });

    it('keeps the two owners fully independent', async () => {
      const ownerB = await login(app, world.b.owner.email);
      const res = await http()
        .get('/api/v1/merchant/branches')
        .set('Authorization', bearer(ownerB))
        .expect(200);
      expect(res.body.map((b: { id: string }) => b.id).sort()).toEqual(
        [...world.b.branches].sort(),
      );
    });
  });

  describe('platform administrators are explicitly separated', () => {
    it('lets a platform admin use platform routes only', async () => {
      const admin = await login(app, world.platformAdmin.email);
      const merchants = await http()
        .get('/api/v1/platform/merchants')
        .set('Authorization', bearer(admin))
        .expect(200);
      const ids = merchants.body.map((m: { id: string }) => m.id);
      expect(ids).toEqual(expect.arrayContaining([world.a.merchantId, world.b.merchantId]));

      const me = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', bearer(admin))
        .expect(200);
      expect(me.body).toMatchObject({ kind: 'platform', merchantId: null, branchScope: null });
    });

    it('gives a platform admin no implicit access to tenant data', async () => {
      const admin = await login(app, world.platformAdmin.email);
      for (const path of [
        '/api/v1/merchant/branches',
        '/api/v1/merchant/staff',
        `/api/v1/merchant/branches/${world.a.branches[0]}`,
      ]) {
        const res = await http().get(path).set('Authorization', bearer(admin)).expect(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
      await http()
        .patch(`/api/v1/merchant/staff/${world.a.staff1.staffId}/role`)
        .set('Authorization', bearer(admin))
        .send({ role: 'MANAGER' })
        .expect(403);
    });

    it('never lets a merchant owner call platform routes', async () => {
      const owner = await login(app, world.a.owner.email);
      await http()
        .get('/api/v1/platform/merchants')
        .set('Authorization', bearer(owner))
        .expect(403);
      await http()
        .post(`/api/v1/platform/users/${world.b.staff1.userId}/deactivate`)
        .set('Authorization', bearer(owner))
        .expect(403);
    });

    it('lets a platform admin deactivate an account, with revocation and audit', async () => {
      const email = await createFreshUser();
      const target = await prisma.platformUser.findUniqueOrThrow({ where: { email } });
      const session = await login(app, email);
      const admin = await login(app, world.platformAdmin.email);

      await http()
        .post(`/api/v1/platform/users/${target.id}/deactivate`)
        .set('Authorization', bearer(admin))
        .expect(204);
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);
      await http().post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD }).expect(401);

      const audit = await prisma.auditEvent.findFirst({
        where: {
          action: 'user.deactivated',
          targetId: target.id,
          actorUserId: world.platformAdmin.userId,
        },
      });
      expect(audit).not.toBeNull();
    });

    it('refuses to deactivate your own account and unknown users', async () => {
      const admin = await login(app, world.platformAdmin.email);
      await http()
        .post(`/api/v1/platform/users/${world.platformAdmin.userId}/deactivate`)
        .set('Authorization', bearer(admin))
        .expect(409);
      await http()
        .post('/api/v1/platform/users/00000000-0000-4000-8000-000000000000/deactivate')
        .set('Authorization', bearer(admin))
        .expect(404);
    });

    it('rejects a platform token whose account is not a platform admin', async () => {
      const jwt = app.get(JwtService);
      const forged = await jwt.signAsync(
        { sub: world.a.owner.userId, typ: 'platform', use: 'access' },
        { secret: process.env.JWT_ACCESS_SECRET, issuer: 'temelashcard', expiresIn: 60 },
      );
      await http()
        .get('/api/v1/platform/merchants')
        .set('Authorization', bearer(forged))
        .expect(401);
    });
  });

  describe('staff management rules and audit trail', () => {
    it('changes a role, takes effect immediately, and audits the change', async () => {
      const owner = await login(app, world.a.owner.email);
      const staff = await login(app, world.a.staff1.email);
      await http().get('/api/v1/merchant/staff').set('Authorization', bearer(staff)).expect(403);

      const res = await http()
        .patch(`/api/v1/merchant/staff/${world.a.staff1.staffId}/role`)
        .set('Authorization', bearer(owner))
        .send({ role: 'MANAGER' })
        .expect(200);
      expect(res.body.roleKey).toBe('MANAGER');

      // Same access token, new permissions.
      await http().get('/api/v1/merchant/staff').set('Authorization', bearer(staff)).expect(200);

      const audit = await prisma.auditEvent.findFirstOrThrow({
        where: { action: 'staff.role_changed', targetId: world.a.staff1.staffId },
      });
      expect(audit).toMatchObject({
        merchantId: world.a.merchantId,
        actorUserId: world.a.owner.userId,
        metadata: { from: 'STAFF', to: 'MANAGER' },
      });
      expect(audit.requestId).toBeTruthy();

      // Restore for later tests.
      await http()
        .patch(`/api/v1/merchant/staff/${world.a.staff1.staffId}/role`)
        .set('Authorization', bearer(owner))
        .send({ role: 'STAFF' })
        .expect(200);
    });

    it('never lets the last active owner be removed, even by concurrent requests', async () => {
      // Two owners demoting each other at the same instant: exactly one must be refused.
      const second = await addOwner(world.a.merchantId);
      const o1 = await login(app, world.a.owner.email);
      const o2 = await login(app, second.email);
      const results = await Promise.all([
        http()
          .patch(`/api/v1/merchant/staff/${second.staffId}/role`)
          .set('Authorization', bearer(o1))
          .send({ role: 'MANAGER' }),
        http()
          .patch(`/api/v1/merchant/staff/${world.a.owner.staffId}/role`)
          .set('Authorization', bearer(o2))
          .send({ role: 'MANAGER' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)?.body.error.code).toBe('LAST_OWNER');
      const owners = await prisma.staffMembership.count({
        where: { merchantId: world.a.merchantId, status: 'ACTIVE', role: { key: 'OWNER' } },
      });
      expect(owners).toBe(1);

      // Restore the original owner for later tests.
      const roleOwner = await prisma.role.findUniqueOrThrow({ where: { key: 'OWNER' } });
      await prisma.staffMembership.updateMany({
        where: { id: { in: [world.a.owner.staffId, second.staffId] } },
        data: { roleId: roleOwner.id },
      });
    });

    it('records login, failed login, logout, logout-all and deactivation without secrets', async () => {
      const email = await createFreshUser();
      await http().post('/api/v1/auth/login').send({ email, password: 'wrong-pw' }).expect(401);
      const s = await login(app, email);
      await http().post('/api/v1/auth/logout').send({ refreshToken: s.refreshToken }).expect(204);
      const s2 = await login(app, email);
      await http().post('/api/v1/auth/logout-all').set('Authorization', bearer(s2)).expect(204);

      const user = await prisma.platformUser.findUniqueOrThrow({ where: { email } });
      const events = await prisma.auditEvent.findMany({ where: { actorUserId: user.id } });
      const actions = events.map((e) => e.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'auth.login_failed',
          'auth.login',
          'auth.logout',
          'auth.logout_all',
        ]),
      );

      const dump = JSON.stringify(events);
      for (const secret of [
        TEST_PASSWORD,
        'wrong-pw',
        s.refreshToken,
        s2.refreshToken,
        s.accessToken,
        user.passwordHash,
      ]) {
        expect(dump).not.toContain(secret);
      }
      expect(dump).not.toContain(email); // attempted addresses are fingerprinted, not stored
    });

    it('records failed logins for unknown accounts without storing the address', async () => {
      const before = await prisma.auditEvent.count({ where: { action: 'auth.login_failed' } });
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'ghost-user@t.test', password: 'x' })
        .expect(401);
      expect(await prisma.auditEvent.count({ where: { action: 'auth.login_failed' } })).toBe(
        before + 1,
      );
      const latest = await prisma.auditEvent.findFirstOrThrow({
        where: { action: 'auth.login_failed', actorUserId: null },
        orderBy: { occurredAt: 'desc' },
      });
      expect(JSON.stringify(latest.metadata)).not.toContain('ghost-user');
    });

    it('shows login events to the right merchant only', async () => {
      const own = await prisma.auditEvent.count({
        where: {
          merchantId: world.a.merchantId,
          action: 'auth.login',
          actorUserId: world.a.owner.userId,
        },
      });
      const leaked = await prisma.auditEvent.count({
        where: { merchantId: world.b.merchantId, actorUserId: world.a.owner.userId },
      });
      expect(own).toBeGreaterThan(0);
      expect(leaked).toBe(0);
    });
  });

  describe('API documentation', () => {
    it('documents the authentication flows with bearer security', async () => {
      const res = await http().get('/api/docs-json').expect(200);
      const paths = Object.keys(res.body.paths);
      for (const p of [
        '/api/v1/auth/login',
        '/api/v1/auth/refresh',
        '/api/v1/auth/logout',
        '/api/v1/auth/logout-all',
        '/api/v1/auth/me',
        '/api/v1/platform/merchants',
      ]) {
        expect(paths).toContain(p);
      }
      expect(res.body.components.securitySchemes.bearer).toBeDefined();
      expect(res.body.paths['/api/v1/auth/login'].post.description).toMatch(/indistinguishable/);
      expect(res.body.paths['/api/v1/merchant/staff'].get.security).toEqual([{ bearer: [] }]);
    });
  });

  // ───────────── helpers ─────────────
  /** A fresh, otherwise unused branch-staff account in merchant A. */
  async function createFreshUser(): Promise<string> {
    return (await createMerchantUser(prisma, world.a.merchantId, 'STAFF', [])).email;
  }

  async function createDeactivatedUser(): Promise<string> {
    const email = await createFreshUser();
    await prisma.platformUser.update({
      where: { email },
      data: { status: 'DEACTIVATED', deactivatedAt: new Date() },
    });
    return email;
  }

  function addOwner(merchantId: string) {
    return createMerchantUser(prisma, merchantId, 'OWNER', []);
  }
});

import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { World, bearer, createWorld, login } from '../support/auth-fixture';
import { createTestApp } from '../support/create-test-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('Audit viewing (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let w: World;
  let T: { owner: string; manager: string; staff: string; otherOwner: string; admin: string };
  const http = () => request(app.getHttpServer());
  const get = (url: string, auth: string) => http().get(url).set('Authorization', auth);

  beforeAll(async () => {
    prisma = new PrismaClient();
    w = await createWorld(prisma);
    app = await createTestApp();
    const tok = async (email: string) => bearer(await login(app, email));
    T = {
      owner: await tok(w.a.owner.email),
      manager: await tok(w.a.manager.email),
      staff: await tok(w.a.staff1.email),
      otherOwner: await tok(w.b.owner.email),
      admin: await tok(w.platformAdmin.email),
    };
    const e = (
      merchantId: string,
      over: Omit<Prisma.AuditEventCreateManyInput, 'merchantId' | 'actorType'>,
    ): Prisma.AuditEventCreateManyInput => ({
      merchantId,
      actorType: 'USER' as const,
      metadata: {},
      ...over,
    });
    await prisma.auditEvent.createMany({
      data: [
        e(w.a.merchantId, {
          action: 'seed.alpha',
          actorUserId: w.a.owner.userId,
          branchId: w.a.branches[0],
          occurredAt: new Date('2026-01-15T12:00:00.000Z'),
          requestId: 'req-alpha',
          metadata: { ip: '203.0.113.9', userAgent: 'curl', plan: 'x' },
        }),
        e(w.a.merchantId, {
          action: 'seed.beta',
          actorUserId: w.a.manager.userId,
          branchId: w.a.branches[1],
          occurredAt: new Date('2026-01-20T12:00:00.000Z'),
        }),
        e(w.b.merchantId, {
          action: 'seed.alpha',
          actorUserId: w.b.owner.userId,
          occurredAt: new Date('2026-01-15T12:00:00.000Z'),
        }),
        { actorType: 'SYSTEM' as const, action: 'seed.platform', metadata: {} },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const list = async (auth: string, qs = ''): Promise<Json> =>
    (await get(`/api/v1/merchant/audit${qs}`, auth).expect(200)).body;
  const range = '?from=2026-01-01&to=2026-02-01';

  it('shows owners and managers their own history only, with the context recorded', async () => {
    const page = await list(T.owner, range);
    const actions = page.items.map((i: Json) => i.action);
    expect(actions).toEqual(['seed.beta', 'seed.alpha']);
    expect(page.items[1]).toMatchObject({
      actor: { type: 'USER', userId: w.a.owner.userId },
      branchId: w.a.branches[0],
      requestId: 'req-alpha',
    });
    expect((await list(T.manager, range)).items).toHaveLength(2);
    // Tenant B sees only its own event, and never tenant A's or the platform's.
    const other = await list(T.otherOwner, range);
    expect(other.items.map((i: Json) => i.action)).toEqual(['seed.alpha']);
    expect(other.items[0].actor.userId).toBe(w.b.owner.userId);
  });

  it('keeps network details for owners and hides them from managers', async () => {
    const owner = (await list(T.owner, `${range}&action=seed.alpha`)).items[0];
    const manager = (await list(T.manager, `${range}&action=seed.alpha`)).items[0];
    expect(owner.metadata).toMatchObject({ ip: '203.0.113.9', plan: 'x' });
    expect(manager.metadata).toEqual({ plan: 'x' });
  });

  it('filters by action, prefix, actor, branch and date (in the merchant time zone)', async () => {
    const ids = async (qs: string) =>
      (await list(T.owner, qs)).items.map((i: Json) => i.action).sort();
    expect(await ids(`${range}&action=seed.beta`)).toEqual(['seed.beta']);
    expect(await ids(`${range}&actionPrefix=seed.`)).toEqual(['seed.alpha', 'seed.beta']);
    expect(await ids(`${range}&actorUserId=${w.a.manager.userId}`)).toEqual(['seed.beta']);
    expect(await ids(`${range}&branchId=${w.a.branches[0]}`)).toEqual(['seed.alpha']);
    expect(await ids('?from=2026-01-15&to=2026-01-15')).toEqual(['seed.alpha']);
    expect(await ids('?from=2026-01-16&to=2026-01-19')).toEqual([]);
    // A filter cannot be used to reach another tenant's actor.
    expect(await ids(`${range}&actorUserId=${w.b.owner.userId}`)).toEqual([]);
  });

  it('paginates with a stable cursor', async () => {
    const first = await list(T.owner, `${range}&limit=1`);
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await list(
      T.owner,
      `${range}&limit=1&cursor=${encodeURIComponent(first.nextCursor)}`,
    );
    expect(second.items[0].action).toBe('seed.alpha');
    expect(second.nextCursor).toBeNull();
  });

  it('rejects bad filters and over-long ranges', async () => {
    await get('/api/v1/merchant/audit?from=not-a-date', T.owner).expect(400);
    await get('/api/v1/merchant/audit?actorUserId=nope', T.owner).expect(400);
    await get('/api/v1/merchant/audit?from=2024-01-01&to=2026-01-01', T.owner).expect(400);
    await get('/api/v1/merchant/audit?from=2026-02-01&to=2026-01-01', T.owner).expect(400);
  });

  it('is closed to staff and to anonymous callers', async () => {
    await get('/api/v1/merchant/audit', T.staff).expect(403);
    await http().get('/api/v1/merchant/audit').expect(401);
    await get('/api/v1/merchant/audit', T.admin).expect(403);
  });

  it('never stores secrets in the metadata of recorded events', async () => {
    await http()
      .post('/api/v1/auth/login')
      .send({ email: w.a.owner.email, password: 'wrong-password-123' })
      .expect(401);
    const rows = await prisma.auditEvent.findMany({ where: { merchantId: w.a.merchantId } });
    const text = JSON.stringify(rows.map((r) => r.metadata));
    expect(text).not.toMatch(/wrong-password|passwordHash|Bearer|refreshToken/i);
  });

  describe('platform audit', () => {
    const platform = (qs: string, auth = T.admin) => get(`/api/v1/platform/audit${qs}`, auth);

    it('needs the explicit permission and is closed to merchant users', async () => {
      await platform('', T.owner).expect(403);
      await platform('', T.manager).expect(403);
      await http().get('/api/v1/platform/audit').expect(401);
    });

    it('returns platform-level events without a merchant, and a merchant’s events when named', async () => {
      const general = (await platform('?from=2026-01-01&to=2026-02-01').expect(200)).body;
      expect(general.items.map((i: Json) => i.action)).not.toContain('seed.beta');
      const scoped = (
        await platform(`?merchantId=${w.a.merchantId}&from=2026-01-01&to=2026-02-01`).expect(200)
      ).body;
      expect(scoped.items.map((i: Json) => i.action).sort()).toEqual(['seed.alpha', 'seed.beta']);
    });

    it('records that a merchant’s history was opened, in that merchant’s own log', async () => {
      const access = (await list(T.owner, '?actionPrefix=audit.')).items.find(
        (i: Json) => i.action === 'audit.platform_accessed',
      );
      expect(access).toBeDefined();
      expect(access.actor.userId).toBe(w.platformAdmin.userId);
    });

    it('answers 404 for an unknown merchant', async () => {
      await platform('?merchantId=00000000-0000-4000-8000-000000000000').expect(404);
    });

    it('stops working the moment the permission is taken away', async () => {
      const role = await prisma.role.findUniqueOrThrow({ where: { key: 'PLATFORM_ADMIN' } });
      const perm = await prisma.permission.findUniqueOrThrow({
        where: { key: 'platform:audit:read' },
      });
      await prisma.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: perm.id },
      });
      try {
        await platform('').expect(403);
      } finally {
        await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
      }
      await platform('').expect(200);
    });
  });
});

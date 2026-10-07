import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { FraudJobs } from '../../src/modules/fraud';
import {
  World,
  bearer,
  createActiveProgram,
  createCard,
  createMerchantUser,
  createWorld,
  login,
} from '../support/auth-fixture';
import { createTestApp } from '../support/create-test-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('Fraud indicators (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let w: World;
  let programId: string;
  let T: { owner: string; manager: string; staff: string; otherOwner: string };
  const http = () => request(app.getHttpServer());
  const api = (path: string) => `/api/v1/merchant/fraud${path}`;
  const get = (path: string, auth: string) => http().get(api(path)).set('Authorization', auth);
  const put = (path: string, auth: string, body: object) =>
    http().put(api(path)).set('Authorization', auth).send(body);
  const post = (path: string, auth: string, body: object = {}) =>
    http().post(api(path)).set('Authorization', auth).send(body);
  const flags = async (qs = ''): Promise<Json[]> =>
    (await get(`/flags${qs}`, T.owner).expect(200)).body.items;

  /** Stamps dated seconds ago, so they fall in the current evaluation window. */
  async function stampsBy(staffMembershipId: string, count: number) {
    const card = await createCard(prisma, w.a.merchantId, programId);
    for (let i = 0; i < count; i++) {
      await prisma.stampEvent.create({
        data: {
          merchantId: w.a.merchantId,
          branchId: w.a.branches[0],
          programId,
          membershipId: card.membershipId,
          staffMembershipId,
          idempotencyKey: randomUUID(),
          occurredAt: new Date(Date.now() - 30_000 - i * 1000),
        },
      });
    }
    return card;
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    w = await createWorld(prisma);
    programId = (
      await createActiveProgram(prisma, w.a.merchantId, { stampsRequired: 50, cooldownMinutes: 0 })
    ).id;
    app = await createTestApp();
    const tok = async (email: string) => bearer(await login(app, email));
    T = {
      owner: await tok(w.a.owner.email),
      manager: await tok(w.a.manager.email),
      staff: await tok(w.a.staff1.email),
      otherOwner: await tok(w.b.owner.email),
    };
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('authorization', () => {
    it('lets owners and managers read, but only owners change anything', async () => {
      await get('/settings', T.owner).expect(200);
      await get('/settings', T.manager).expect(200);
      await get('/flags', T.manager).expect(200);
      await get('/indicators', T.manager).expect(200);
      await put('/settings', T.manager, { excessiveStampsPerStaff: { maxStamps: 5 } }).expect(403);
      await post('/evaluate', T.manager).expect(403);
      await post(`/flags/${randomUUID()}/review`, T.manager, { status: 'DISMISSED' }).expect(403);
    });

    it('is closed to staff and anonymous callers', async () => {
      await get('/settings', T.staff).expect(403);
      await get('/flags', T.staff).expect(403);
      await post('/evaluate', T.staff).expect(403);
      await http().get(api('/flags')).expect(401);
    });
  });

  describe('thresholds', () => {
    it('start with documented defaults', async () => {
      const s = (await get('/settings', T.owner).expect(200)).body;
      expect(s.excessiveStampsPerStaff).toMatchObject({ enabled: true, maxStamps: 40 });
      expect(s.repeatedScansPerMembership).toMatchObject({ maxAttempts: 6 });
    });

    it('can be changed by the owner, with only field names audited', async () => {
      const res = await put('/settings', T.owner, {
        excessiveStampsPerStaff: { windowMinutes: 10080, maxStamps: 3 },
      }).expect(200);
      expect(res.body.excessiveStampsPerStaff).toMatchObject({
        windowMinutes: 10080,
        maxStamps: 3,
      });
      expect(
        (await get('/settings', T.manager).expect(200)).body.excessiveStampsPerStaff.maxStamps,
      ).toBe(3);

      const audit = await prisma.auditEvent.findFirst({
        where: { merchantId: w.a.merchantId, action: 'fraud.thresholds_changed' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(audit?.metadata).toEqual({
        changedFields: expect.arrayContaining([
          'excessiveStampsPerStaff.maxStamps',
          'excessiveStampsPerStaff.windowMinutes',
        ]),
      });
    });

    it('reject values outside the allowed range', async () => {
      await put('/settings', T.owner, { excessiveStampsPerStaff: { maxStamps: 0 } }).expect(400);
      await put('/settings', T.owner, { highReversalRate: { maxRatio: 5 } }).expect(400);
      await put('/settings', T.owner, { excessiveStampsPerStaff: { maxStamps: 'many' } }).expect(
        400,
      );
    });

    it('are per merchant', async () => {
      const other = (
        await http().get(api('/settings')).set('Authorization', T.otherOwner).expect(200)
      ).body;
      expect(other.excessiveStampsPerStaff.maxStamps).toBe(40);
    });
  });

  describe('flags', () => {
    let staff: { userId: string; staffId: string };
    let flagId: string;

    it('are raised for a staff member over the limit, and only for that staff member', async () => {
      staff = await createMerchantUser(prisma, w.a.merchantId, 'STAFF', [w.a.branches[0]]);
      const quiet = await createMerchantUser(prisma, w.a.merchantId, 'STAFF', [w.a.branches[0]]);
      const card = await stampsBy(staff.staffId, 5);
      await stampsBy(quiet.staffId, 2);

      await post('/evaluate', T.owner).expect(200);
      const found = (await flags('?indicator=EXCESSIVE_STAMPS_BY_STAFF')).filter(
        (f) => f.subjectId === staff.staffId,
      );
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        indicator: 'EXCESSIVE_STAMPS_BY_STAFF',
        subjectType: 'STAFF',
        status: 'OPEN',
        threshold: 3,
        observed: expect.any(Number),
      });
      expect(found[0]!.observed).toBeGreaterThanOrEqual(5);
      expect((await flags()).some((f) => f.subjectId === quiet.staffId)).toBe(false);
      flagId = found[0]!.id;

      // Flagging never punishes: the staff account and the customer's card are untouched.
      expect(
        (await prisma.staffMembership.findUniqueOrThrow({ where: { id: staff.staffId } })).status,
      ).toBe('ACTIVE');
      expect(
        (await prisma.customerMembership.findUniqueOrThrow({ where: { id: card.membershipId } }))
          .status,
      ).toBe('ACTIVE');
    });

    it('are not duplicated when the same window is evaluated again', async () => {
      const before = (await flags('?indicator=EXCESSIVE_STAMPS_BY_STAFF')).length;
      await post('/evaluate', T.owner).expect(200);
      await post('/evaluate', T.owner).expect(200);
      expect((await flags('?indicator=EXCESSIVE_STAMPS_BY_STAFF')).length).toBe(before);
    });

    it('contain counts and ids, no personal data', async () => {
      const f = (await get(`/flags/${flagId}`, T.manager).expect(200)).body;
      expect(Object.keys(f.details)).toEqual(expect.arrayContaining(['stamps', 'windowMinutes']));
      expect(JSON.stringify(f.details)).not.toMatch(/\+251|phone|@/);
    });

    it('can be filtered by status and indicator', async () => {
      expect((await flags('?status=OPEN')).some((f) => f.id === flagId)).toBe(true);
      expect((await flags('?status=CONFIRMED')).some((f) => f.id === flagId)).toBe(false);
      expect((await flags('?indicator=EXCESSIVE_REDEMPTIONS')).some((f) => f.id === flagId)).toBe(
        false,
      );
      await get('/flags?status=BOGUS', T.owner).expect(400);
    });

    it('stay invisible to other merchants', async () => {
      const mine = (await http().get(api('/flags')).set('Authorization', T.otherOwner).expect(200))
        .body.items;
      expect(mine.some((f: Json) => f.id === flagId)).toBe(false);
      await http()
        .get(api(`/flags/${flagId}`))
        .set('Authorization', T.otherOwner)
        .expect(404);
      await http()
        .post(api(`/flags/${flagId}/review`))
        .set('Authorization', T.otherOwner)
        .send({ status: 'DISMISSED' })
        .expect(404);
    });

    it('are reviewed once by an owner, keeping the note out of the audit log', async () => {
      await post(`/flags/${flagId}/review`, T.owner, { status: 'MAYBE' }).expect(400);
      const res = await post(`/flags/${flagId}/review`, T.owner, {
        status: 'CONFIRMED',
        note: 'Checked with the branch manager',
      }).expect(200);
      expect(res.body).toMatchObject({
        status: 'CONFIRMED',
        reviewNote: 'Checked with the branch manager',
      });
      expect(res.body.reviewedAt).toEqual(expect.any(String));

      const again = await post(`/flags/${flagId}/review`, T.owner, { status: 'DISMISSED' }).expect(
        409,
      );
      expect(again.body.error?.code ?? again.body.code).toBe('ALREADY_REVIEWED');

      const audit = await prisma.auditEvent.findFirstOrThrow({
        where: { merchantId: w.a.merchantId, action: 'fraud.flag_reviewed', targetId: flagId },
      });
      expect(JSON.stringify(audit.metadata)).not.toContain('branch manager');
      expect(audit.metadata).toMatchObject({ status: 'CONFIRMED' });
      expect((await flags('?status=OPEN')).some((f) => f.id === flagId)).toBe(false);
    });

    it('follow the thresholds: a higher limit raises no new flag', async () => {
      await put('/settings', T.owner, { excessiveStampsPerStaff: { maxStamps: 1000 } }).expect(200);
      const other = await createMerchantUser(prisma, w.a.merchantId, 'STAFF', [w.a.branches[0]]);
      await stampsBy(other.staffId, 6);
      await post('/evaluate', T.owner).expect(200);
      expect((await flags()).some((f) => f.subjectId === other.staffId)).toBe(false);
      await put('/settings', T.owner, { excessiveStampsPerStaff: { maxStamps: 3 } }).expect(200);
      await post('/evaluate', T.owner).expect(200);
      expect((await flags()).some((f) => f.subjectId === other.staffId)).toBe(true);
    });

    it('can be switched off per indicator', async () => {
      await put('/settings', T.owner, { excessiveStampsPerStaff: { enabled: false } }).expect(200);
      const other = await createMerchantUser(prisma, w.a.merchantId, 'STAFF', [w.a.branches[0]]);
      await stampsBy(other.staffId, 6);
      await post('/evaluate', T.owner).expect(200);
      expect((await flags()).some((f) => f.subjectId === other.staffId)).toBe(false);
      await put('/settings', T.owner, { excessiveStampsPerStaff: { enabled: true } }).expect(200);
    });

    it('catch one card being scanned over and over', async () => {
      await put('/settings', T.owner, {
        repeatedScansPerMembership: { windowMinutes: 10080, maxAttempts: 4 },
      }).expect(200);
      const staffMember = await createMerchantUser(prisma, w.a.merchantId, 'STAFF', [
        w.a.branches[0],
      ]);
      const card = await stampsBy(staffMember.staffId, 6);
      await post('/evaluate', T.owner).expect(200);
      const found = await flags('?indicator=REPEATED_SCANS_FOR_MEMBERSHIP');
      expect(
        found.some((f) => f.subjectType === 'MEMBERSHIP' && f.subjectId === card.membershipId),
      ).toBe(true);
    });
  });

  describe('scheduled evaluation', () => {
    it('queues one job per merchant per interval', async () => {
      const jobs = app.get(FraudJobs);
      const now = new Date('2030-01-01T00:07:00.000Z');
      await jobs.enqueueAll(15, now);
      expect(await jobs.enqueueAll(15, now)).toBe(0);
      const queued = await prisma.outboxJob.findMany({
        where: { merchantId: w.a.merchantId, type: 'fraud.evaluate' },
      });
      expect(queued).toHaveLength(1);
      // A later interval queues a fresh job.
      expect(await jobs.enqueueAll(15, new Date(now.getTime() + 15 * 60_000))).toBeGreaterThan(0);
    }, 120_000);
  });
});

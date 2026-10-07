import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { PrivacyJobs, RetentionService } from '../../src/modules/privacy';
import {
  TestCard,
  World,
  bearer,
  createActiveProgram,
  createCard,
  createWorld,
  login,
  randomPhone,
  seedLedger,
} from '../support/auth-fixture';
import { createTestApp } from '../support/create-test-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('Privacy and membership lifecycle (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let w: World;
  let programId: string;
  let rewardDefinitionId: string;
  let T: { owner: string; manager: string; staff: string; otherOwner: string };
  const http = () => request(app.getHttpServer());
  const base = '/api/v1/merchant';
  const get = (path: string, auth: string) =>
    http().get(`${base}${path}`).set('Authorization', auth);
  const post = (path: string, auth: string, body: object = {}) =>
    http().post(`${base}${path}`).set('Authorization', auth).send(body);
  const put = (path: string, auth: string, body: object) =>
    http().put(`${base}${path}`).set('Authorization', auth).send(body);
  const card = (name = 'Abebe') => createCard(prisma, w.a.merchantId, programId, name);
  const scan = (c: TestCard, auth = T.manager) =>
    http()
      .post('/api/v1/scanner/stamps')
      .set('Authorization', auth)
      .set('Idempotency-Key', randomUUID())
      .send({ cardToken: c.token, branchId: w.a.branches[0] });
  const ledger = (c: TestCard, stamps: number, unlock: boolean) =>
    seedLedger(
      prisma,
      {
        merchantId: w.a.merchantId,
        branchId: w.a.branches[0],
        programId,
        membershipId: c.membershipId,
        staffMembershipId: w.a.staff1.staffId,
        rewardDefinitionId,
      },
      { stamps, unlocks: unlock ? [{ afterStamp: stamps, expiresInDays: null }] : [] },
    );
  const auditFor = (action: string, targetId: string) =>
    prisma.auditEvent.findMany({ where: { merchantId: w.a.merchantId, action, targetId } });

  beforeAll(async () => {
    prisma = new PrismaClient();
    w = await createWorld(prisma);
    programId = (
      await createActiveProgram(prisma, w.a.merchantId, { stampsRequired: 3, cooldownMinutes: 0 })
    ).id;
    rewardDefinitionId = (await prisma.rewardDefinition.findFirstOrThrow({ where: { programId } }))
      .id;
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
    it('limits every privacy operation to owners', async () => {
      const c = await card();
      const id = c.customerId;
      for (const auth of [T.manager, T.staff]) {
        await get(`/customers/${id}/data`, auth).expect(403);
        await get(`/customers/${id}/export`, auth).expect(403);
        await post(`/customers/${id}/anonymize`, auth, { reason: 'CUSTOMER_REQUEST' }).expect(403);
        await get('/privacy/retention', auth).expect(403);
        await put('/privacy/retention', auth, { inactiveCustomerMonths: 12 }).expect(403);
        await post('/privacy/retention/run', auth).expect(403);
      }
      await http().get(`${base}/customers/${id}/data`).expect(401);
      expect((await prisma.customer.findUniqueOrThrow({ where: { id } })).status).toBe('ACTIVE');
    });

    it('never reaches another merchant’s customer', async () => {
      const c = await card('Hana');
      await get(`/customers/${c.customerId}/data`, T.otherOwner).expect(404);
      await get(`/customers/${c.customerId}/export`, T.otherOwner).expect(404);
      await post(`/customers/${c.customerId}/anonymize`, T.otherOwner, {
        reason: 'CUSTOMER_REQUEST',
      }).expect(404);
      await post(`/memberships/${c.membershipId}/deactivate`, T.otherOwner).expect(404);
      const after = await prisma.customer.findUniqueOrThrow({ where: { id: c.customerId } });
      expect(after).toMatchObject({ status: 'ACTIVE', firstName: 'Hana' });
      expect(after.phoneE164).not.toBeNull();
    });
  });

  describe('viewing and exporting', () => {
    let c: TestCard;

    beforeAll(async () => {
      c = await card('Selam');
      await ledger(c, 2, false);
      await prisma.customerConsent.createMany({
        data: [
          {
            merchantId: w.a.merchantId,
            customerId: c.customerId,
            type: 'LOYALTY_TERMS',
            action: 'GRANTED',
            version: 'v1',
            source: 'JOIN_FORM',
          },
          {
            merchantId: w.a.merchantId,
            customerId: c.customerId,
            type: 'MARKETING',
            action: 'GRANTED',
            version: 'v1',
            source: 'JOIN_FORM',
            occurredAt: new Date(Date.now() - 1000),
          },
        ],
      });
    });

    it('shows the owner everything stored, and audits the access without the data', async () => {
      const res = await get(`/customers/${c.customerId}/data`, T.owner).expect(200);
      expect(res.body).toMatchObject({
        schemaVersion: 1,
        customer: { id: c.customerId, firstName: 'Selam', status: 'ACTIVE' },
        memberships: [{ id: c.membershipId, program: { nameEn: 'Test Card' } }],
      });
      expect(res.body.customer.phone).toMatch(/^\+251/);
      expect(res.body.memberships[0].stamps).toHaveLength(2);
      expect(res.body.memberships[0].walletPasses).toEqual([
        expect.objectContaining({ provider: 'WEB', status: 'ACTIVE' }),
      ]);
      expect(res.body.consents.map((x: Json) => x.type).sort()).toEqual([
        'LOYALTY_TERMS',
        'MARKETING',
      ]);

      const [event] = await auditFor('customer.data_viewed', c.customerId);
      expect(event).toBeDefined();
      expect(event?.actorUserId).toBe(w.a.owner.userId);
      expect(JSON.stringify(event?.metadata)).not.toMatch(/Selam|\+251/);
    });

    it('exports a downloadable JSON file with no staff identities or secrets', async () => {
      const res = await get(`/customers/${c.customerId}/export`, T.owner).expect(200);
      expect(res.headers['content-disposition']).toContain(`customer-${c.customerId}.json`);
      expect(res.headers['cache-control']).toBe('no-store');
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/staffMembershipId|tokenHash|barcode|passwordHash|idempotency/i);
      expect(text).not.toContain(w.a.staff1.staffId);
      expect(await auditFor('customer.data_exported', c.customerId)).toHaveLength(1);
    });

    it('rejects a malformed id and an unknown customer', async () => {
      await get('/customers/not-a-uuid/data', T.owner).expect(400);
      await get(`/customers/${randomUUID()}/data`, T.owner).expect(404);
    });

    it('records a withdrawn marketing consent and keeps the history', async () => {
      await post(`/customers/${c.customerId}/consents/marketing/withdraw`, T.manager).expect(200);
      const { body } = await get(`/customers/${c.customerId}/data`, T.owner).expect(200);
      const marketing = body.consents.filter((x: Json) => x.type === 'MARKETING');
      expect(marketing.map((x: Json) => x.action)).toEqual(['GRANTED', 'WITHDRAWN']);
      // Withdrawing marketing consent leaves the card and its history alone.
      expect(body.memberships[0].status).toBe('ACTIVE');
      expect(body.memberships[0].stamps).toHaveLength(2);
    });
  });

  describe('deactivating a loyalty membership', () => {
    it('stops stamping at once, keeps all history and can be undone', async () => {
      const c = await card('Dawit');
      await scan(c).expect(200);

      await post(`/memberships/${c.membershipId}/deactivate`, T.manager).expect(204);
      await post(`/memberships/${c.membershipId}/deactivate`, T.manager).expect(204); // idempotent
      const refused = await scan(c).expect(200);
      expect(refused.body.reason).toBe('MEMBERSHIP_INACTIVE');
      const row = await prisma.customerMembership.findUniqueOrThrow({
        where: { id: c.membershipId },
      });
      expect(row).toMatchObject({ status: 'INACTIVE' });
      expect(row.deactivatedAt).not.toBeNull();
      expect(await prisma.stampEvent.count({ where: { membershipId: c.membershipId } })).toBe(1);
      expect(await auditFor('membership.deactivated', c.membershipId)).toHaveLength(1);

      await post(`/memberships/${c.membershipId}/reactivate`, T.manager).expect(204);
      await scan(c).expect(200);
      expect(await prisma.stampEvent.count({ where: { membershipId: c.membershipId } })).toBe(2);
      expect(await auditFor('membership.reactivated', c.membershipId)).toHaveLength(1);
    });

    it('is not available to scanner staff', async () => {
      const c = await card();
      await post(`/memberships/${c.membershipId}/deactivate`, T.staff).expect(403);
      await post(`/memberships/${randomUUID()}/deactivate`, T.manager).expect(404);
    });
  });

  describe('anonymization', () => {
    it('refuses to forfeit an unclaimed reward unless the owner acknowledges it', async () => {
      const c = await card('Rahel');
      await ledger(c, 3, true);
      const res = await post(`/customers/${c.customerId}/anonymize`, T.owner, {
        reason: 'CUSTOMER_REQUEST',
      }).expect(409);
      expect(res.body.error?.code ?? res.body.code).toBe('REWARDS_OUTSTANDING');
      expect(
        (await prisma.customer.findUniqueOrThrow({ where: { id: c.customerId } })).status,
      ).toBe('ACTIVE');
    });

    it('removes personal data, closes the card and keeps the history', async () => {
      const c = await card('Tigist');
      await ledger(c, 3, true);
      const phone = (await prisma.customer.findUniqueOrThrow({ where: { id: c.customerId } }))
        .phoneE164!;
      const stampsBefore = await prisma.stampEvent.count({
        where: { membershipId: c.membershipId },
      });
      const oldHash = (
        await prisma.customerMembership.findUniqueOrThrow({ where: { id: c.membershipId } })
      ).tokenHash;

      const res = await post(`/customers/${c.customerId}/anonymize`, T.owner, {
        reason: 'CUSTOMER_REQUEST',
        acknowledgeOutstandingRewards: true,
      }).expect(200);
      expect(res.body).toEqual({
        customerId: c.customerId,
        anonymized: true,
        membershipsClosed: 1,
      });

      const customer = await prisma.customer.findUniqueOrThrow({ where: { id: c.customerId } });
      expect(customer).toMatchObject({ firstName: null, phoneE164: null, status: 'ANONYMIZED' });
      expect(customer.anonymizedAt).not.toBeNull();
      const membership = await prisma.customerMembership.findUniqueOrThrow({
        where: { id: c.membershipId },
      });
      expect(membership.status).toBe('INACTIVE');
      expect(membership.tokenHash).not.toBe(oldHash);
      const passes = await prisma.walletPass.findMany({ where: { membershipId: c.membershipId } });
      expect(passes.every((p) => p.status === 'INVALIDATED')).toBe(true);

      // History survives, and the old card no longer works.
      expect(await prisma.stampEvent.count({ where: { membershipId: c.membershipId } })).toBe(
        stampsBefore,
      );
      expect(await prisma.rewardUnlock.count({ where: { membershipId: c.membershipId } })).toBe(1);
      const refused = await scan(c).expect(200);
      expect(refused.body.stamp).toBeUndefined();
      expect(await prisma.stampEvent.count({ where: { membershipId: c.membershipId } })).toBe(
        stampsBefore,
      );

      // The audit record names no one and holds no personal data.
      const [event] = await auditFor('customer.anonymized', c.customerId);
      expect(event?.actorUserId).toBe(w.a.owner.userId);
      expect(event?.metadata).toMatchObject({
        reason: 'CUSTOMER_REQUEST',
        memberships: 1,
        forfeitedRewards: 1,
      });
      expect(JSON.stringify(event)).not.toMatch(new RegExp(`Tigist|${phone.slice(1)}`));

      // The export of an anonymized customer holds nothing personal either.
      const exported = (await get(`/customers/${c.customerId}/export`, T.owner).expect(200)).body;
      expect(exported.customer).toMatchObject({
        firstName: null,
        phone: null,
        status: 'ANONYMIZED',
      });

      // The phone number is free again, and the anonymized customer cannot be revived.
      await prisma.customer.create({
        data: { merchantId: w.a.merchantId, phoneE164: phone, firstName: 'New' },
      });
      await post(`/memberships/${c.membershipId}/reactivate`, T.owner).expect(409);
    });

    it('is harmless to repeat', async () => {
      const c = await card();
      const body = { reason: 'LEGAL_OBLIGATION' };
      await post(`/customers/${c.customerId}/anonymize`, T.owner, body).expect(200);
      const again = await post(`/customers/${c.customerId}/anonymize`, T.owner, body).expect(200);
      expect(again.body).toMatchObject({ anonymized: false, membershipsClosed: 0 });
      expect(await auditFor('customer.anonymized', c.customerId)).toHaveLength(1);
    });

    it('drops cached scanner answers about the customer', async () => {
      const c = await card('Meron');
      await prisma.idempotencyRecord.create({
        data: {
          merchantId: w.a.merchantId,
          staffMembershipId: w.a.manager.staffId,
          operation: 'stamp.create',
          key: randomUUID(),
          membershipId: c.membershipId,
          requestHash: 'x',
          responseStatus: 200,
          responseBody: { customer: { firstName: 'Meron' } },
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      await post(`/customers/${c.customerId}/anonymize`, T.owner, { reason: 'OTHER' }).expect(200);
      expect(
        await prisma.idempotencyRecord.count({ where: { membershipId: c.membershipId } }),
      ).toBe(0);
    });

    it('validates the request body', async () => {
      const c = await card();
      await post(`/customers/${c.customerId}/anonymize`, T.owner, {}).expect(400);
      await post(`/customers/${c.customerId}/anonymize`, T.owner, {
        reason: 'because I said so',
      }).expect(400);
    });
  });

  describe('retention', () => {
    const yearsAgo = (n: number) => new Date(Date.now() - n * 365 * 86_400_000);

    async function oldCustomer(opts: { reward?: boolean; recentStamp?: boolean }) {
      const customer = await prisma.customer.create({
        data: {
          merchantId: w.a.merchantId,
          phoneE164: `+251${randomPhone().slice(1)}`,
          firstName: 'Old',
          createdAt: yearsAgo(3),
        },
      });
      const membership = await prisma.customerMembership.create({
        data: {
          merchantId: w.a.merchantId,
          customerId: customer.id,
          programId,
          tokenHash: `h-${randomUUID()}`,
        },
      });
      const stamp = await prisma.stampEvent.create({
        data: {
          merchantId: w.a.merchantId,
          branchId: w.a.branches[0],
          programId,
          membershipId: membership.id,
          staffMembershipId: w.a.staff1.staffId,
          idempotencyKey: randomUUID(),
          occurredAt: opts.recentStamp ? new Date() : yearsAgo(2),
        },
      });
      if (opts.reward) {
        await prisma.rewardUnlock.create({
          data: {
            merchantId: w.a.merchantId,
            programId,
            membershipId: membership.id,
            rewardDefinitionId,
            triggeringStampId: stamp.id,
            unlockedAt: yearsAgo(2),
          },
        });
      }
      return customer.id;
    }

    it('starts at 36 months and is changed by the owner only, with validation', async () => {
      expect((await get('/privacy/retention', T.owner).expect(200)).body).toEqual({
        inactiveCustomerMonths: 36,
      });
      expect(
        (await put('/privacy/retention', T.owner, { inactiveCustomerMonths: 12 }).expect(200)).body,
      ).toEqual({
        inactiveCustomerMonths: 12,
      });
      await put('/privacy/retention', T.owner, { inactiveCustomerMonths: 3 }).expect(422);
      await put('/privacy/retention', T.owner, { inactiveCustomerMonths: 121 }).expect(400);
      await put('/privacy/retention', T.owner, { inactiveCustomerMonths: 'soon' }).expect(400);
      expect(
        (await get('/privacy/retention', T.owner).expect(200)).body.inactiveCustomerMonths,
      ).toBe(12);
      const [event] = await prisma.auditEvent.findMany({
        where: { merchantId: w.a.merchantId, action: 'privacy.retention_updated' },
      });
      expect(event?.metadata).toEqual({ inactiveCustomerMonths: 12 });
      // Policies are per merchant.
      expect(
        (
          await http()
            .get(`${base}/privacy/retention`)
            .set('Authorization', T.otherOwner)
            .expect(200)
        ).body,
      ).toEqual({
        inactiveCustomerMonths: 36,
      });
    });

    it('anonymizes only long-inactive customers who have no reward left to claim', async () => {
      await put('/privacy/retention', T.owner, { inactiveCustomerMonths: 12 }).expect(200);
      const inactive = await oldCustomer({});
      const holdsReward = await oldCustomer({ reward: true });
      const active = await oldCustomer({ recentStamp: true });

      const res = await post('/privacy/retention/run', T.owner).expect(200);
      expect(res.body.anonymized).toBeGreaterThanOrEqual(1);

      const status = async (id: string) =>
        (await prisma.customer.findUniqueOrThrow({ where: { id } })).status;
      expect(await status(inactive)).toBe('ANONYMIZED');
      expect(await status(holdsReward)).toBe('ACTIVE');
      expect(await status(active)).toBe('ACTIVE');
      const [event] = await auditFor('customer.anonymized', inactive);
      expect(event?.metadata).toMatchObject({ reason: 'RETENTION_POLICY' });
      expect(event?.actorUserId).toBe(w.a.owner.userId);
    });

    it('does nothing when switched off', async () => {
      await put('/privacy/retention', T.owner, { inactiveCustomerMonths: 0 }).expect(200);
      const id = await oldCustomer({});
      expect((await post('/privacy/retention/run', T.owner).expect(200)).body).toEqual({
        anonymized: 0,
        more: false,
      });
      expect((await prisma.customer.findUniqueOrThrow({ where: { id } })).status).toBe('ACTIVE');
    });

    it('never touches another merchant’s customers', async () => {
      await put('/privacy/retention', T.owner, { inactiveCustomerMonths: 6 }).expect(200);
      const otherProgram = await createActiveProgram(prisma, w.b.merchantId);
      const other = await prisma.customer.create({
        data: {
          merchantId: w.b.merchantId,
          phoneE164: `+251${randomPhone().slice(1)}`,
          createdAt: yearsAgo(5),
        },
      });
      await prisma.customerMembership.create({
        data: {
          merchantId: w.b.merchantId,
          customerId: other.id,
          programId: otherProgram.id,
          tokenHash: `h-${randomUUID()}`,
        },
      });
      await post('/privacy/retention/run', T.owner).expect(200);
      expect((await prisma.customer.findUniqueOrThrow({ where: { id: other.id } })).status).toBe(
        'ACTIVE',
      );
    });

    it('is also run by the background job, once per interval, along with the clean-up', async () => {
      const jobs = app.get(PrivacyJobs);
      const now = new Date('2031-03-01T05:00:00.000Z');
      await jobs.enqueueAll(24, now);
      expect(await jobs.enqueueAll(24, now)).toBe(0);
      const queued = await prisma.outboxJob.findMany({
        where: { merchantId: w.a.merchantId, type: 'privacy.retention' },
      });
      expect(queued).toHaveLength(1);
      expect(
        await prisma.outboxJob.count({ where: { type: 'maintenance.cleanup' } }),
      ).toBeGreaterThanOrEqual(1);
    }, 120_000);

    it('clean-up removes only old finished jobs (dead and recent ones stay)', async () => {
      const old = new Date(Date.now() - 90 * 86_400_000);
      const done = await prisma.outboxJob.create({
        data: {
          type: 'test.done',
          aggregateType: 't',
          aggregateId: 'a',
          status: 'COMPLETED',
          completedAt: old,
        },
      });
      const dead = await prisma.outboxJob.create({
        data: { type: 'test.dead', aggregateType: 't', aggregateId: 'b', status: 'DEAD' },
      });
      const fresh = await prisma.outboxJob.create({
        data: {
          type: 'test.fresh',
          aggregateType: 't',
          aggregateId: 'c',
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });
      await app.get(RetentionService).cleanup();
      expect(await prisma.outboxJob.findUnique({ where: { id: done.id } })).toBeNull();
      expect(await prisma.outboxJob.findUnique({ where: { id: dead.id } })).not.toBeNull();
      expect(await prisma.outboxJob.findUnique({ where: { id: fresh.id } })).not.toBeNull();
    });
  });
});

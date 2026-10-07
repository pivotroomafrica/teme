import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { OutboxService } from '../../src/modules/jobs';
import { StampsRepository } from '../../src/modules/stamps';
import {
  TestCard,
  World,
  bearer,
  createActiveProgram,
  createCard,
  createWorld,
  login,
} from '../support/auth-fixture';
import { createTestApp } from '../support/create-test-app';

describe('Scanner and stamp engine (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let w: World;
  let program: { id: string };
  let tokens: { staff1: string; staff2: string; manager: string; owner: string; admin: string };
  const http = () => request(app.getHttpServer());

  const validate = (auth: string, body: object) =>
    http().post('/api/v1/scanner/validate').set('Authorization', auth).send(body);
  const stamp = (auth: string, body: object, key: string = randomUUID()) =>
    http()
      .post('/api/v1/scanner/stamps')
      .set('Authorization', auth)
      .set('Idempotency-Key', key)
      .send(body);
  const b1 = () => w.a.branches[0];

  /** Fresh card in tenant A's default program. */
  const card = (name?: string) => createCard(prisma, w.a.merchantId, program.id, name);
  const stampCount = (membershipId: string) => prisma.stampEvent.count({ where: { membershipId } });

  beforeAll(async () => {
    prisma = new PrismaClient();
    w = await createWorld(prisma);
    program = await createActiveProgram(prisma, w.a.merchantId, {
      stampsRequired: 3,
      cooldownMinutes: 0,
    });
    app = await createTestApp();
    tokens = {
      staff1: bearer(await login(app, w.a.staff1.email)),
      staff2: bearer(await login(app, w.a.staff2.email)),
      manager: bearer(await login(app, w.a.manager.email)),
      owner: bearer(await login(app, w.a.owner.email)),
      admin: bearer(await login(app, w.platformAdmin.email)),
    };
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('access', () => {
    it('rejects anonymous callers and platform administrators', async () => {
      const c = await card();
      await http().post('/api/v1/scanner/validate').send({ cardToken: c.token }).expect(401);
      await http()
        .post('/api/v1/scanner/stamps')
        .set('Idempotency-Key', randomUUID())
        .send({ cardToken: c.token })
        .expect(401);
      await validate(tokens.admin, { cardToken: c.token, branchId: b1() }).expect(403);
      await stamp(tokens.admin, { cardToken: c.token, branchId: b1() }).expect(403);
      expect(await stampCount(c.membershipId)).toBe(0);
    });

    it('requires an explicit branch for staff who work at several branches, but not for a single-branch member', async () => {
      const c = await card();
      const missing = await stamp(tokens.manager, { cardToken: c.token }).expect(400);
      expect(missing.body.error.code).toBe('VALIDATION_FAILED');
      await stamp(tokens.staff1, { cardToken: c.token }).expect(200); // staff1 has exactly one branch
      expect(await stampCount(c.membershipId)).toBe(1);
    });

    it('offers no way to set, edit or delete totals', async () => {
      const c = await card();
      for (const [method, path] of [
        ['post', '/api/v1/scanner/totals'],
        ['patch', `/api/v1/merchant/memberships/${c.membershipId}`],
        ['put', `/api/v1/merchant/memberships/${c.membershipId}/stamps`],
        ['delete', `/api/v1/scanner/stamps/${randomUUID()}`],
      ] as const) {
        const res = await http()
          [method](path)
          .set('Authorization', tokens.owner)
          .send({ stamps: 99 });
        expect(res.status).toBe(404);
      }
    });
  });

  describe('validation (no stamp added)', () => {
    it('reports eligibility and progress without writing anything', async () => {
      const c = await card('Hana');
      const auditBefore = await prisma.auditEvent.count({ where: { merchantId: w.a.merchantId } });
      const recordsBefore = await prisma.idempotencyRecord.count({
        where: { staffMembershipId: w.a.staff1.staffId },
      });

      const res = await validate(tokens.staff1, { cardToken: c.token }).expect(200);
      expect(res.body).toMatchObject({
        outcome: 'ELIGIBLE',
        reason: null,
        customer: { firstName: 'Hana' },
        progress: { current: 0, required: 3, remaining: 3, completedCards: 0, rewardsAvailable: 0 },
        wouldUnlockReward: false,
        replayed: false,
      });
      expect(res.body.message.en).toBeTruthy();
      expect(res.body.message.am).toBeTruthy();

      expect(await stampCount(c.membershipId)).toBe(0);
      expect(await prisma.auditEvent.count({ where: { merchantId: w.a.merchantId } })).toBe(
        auditBefore,
      );
      expect(
        await prisma.idempotencyRecord.count({ where: { staffMembershipId: w.a.staff1.staffId } }),
      ).toBe(recordsBefore);
    });

    it('warns when the next stamp completes a card', async () => {
      const c = await card();
      await stamp(tokens.staff1, { cardToken: c.token }).expect(200);
      await stamp(tokens.staff1, { cardToken: c.token }).expect(200);
      const res = await validate(tokens.staff1, { cardToken: c.token }).expect(200);
      expect(res.body.progress).toMatchObject({ current: 2, remaining: 1 });
      expect(res.body.wouldUnlockReward).toBe(true);
    });

    it('does not need an idempotency key and can be repeated freely', async () => {
      const c = await card();
      for (let i = 0; i < 3; i++) await validate(tokens.staff1, { cardToken: c.token }).expect(200);
    });
  });

  describe('stamping', () => {
    it('adds exactly one stamp and records who, where, when and on what device', async () => {
      const c = await card('Abebe');
      const res = await stamp(tokens.staff1, {
        cardToken: c.token,
        branchId: b1(),
        device: { platform: 'android', appVersion: '1.4.2', deviceId: 'install-7f3a' },
      }).expect(200);

      expect(res.body).toMatchObject({
        outcome: 'STAMPED',
        reason: null,
        customer: { firstName: 'Abebe' },
        progress: { current: 1, required: 3, remaining: 2, completedCards: 0 },
        reward: { unlocked: false },
        replayed: false,
      });
      expect(res.body.stamp.id).toMatch(/^[0-9a-f-]{36}$/);

      const rows = await prisma.stampEvent.findMany({ where: { membershipId: c.membershipId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        merchantId: w.a.merchantId,
        branchId: b1(),
        programId: program.id,
        staffMembershipId: w.a.staff1.staffId,
        deviceMetadata: { platform: 'android', appVersion: '1.4.2', deviceId: 'install-7f3a' },
      });
      expect(Math.abs(Date.now() - (rows[0]?.occurredAt.getTime() ?? 0))).toBeLessThan(30_000);
    });

    it('queues a wallet update in the same transaction and flags passes stale', async () => {
      const c = await card();
      const before = await prisma.walletPass.findFirstOrThrow({
        where: { membershipId: c.membershipId },
      });
      const res = await stamp(tokens.staff1, { cardToken: c.token }).expect(200);

      const jobs = await prisma.outboxJob.findMany({ where: { aggregateId: c.membershipId } });
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        type: 'wallet.pass_update',
        aggregateType: 'membership',
        merchantId: w.a.merchantId,
        status: 'PENDING',
        payload: { reason: 'stamp', stampId: res.body.stamp.id },
      });
      const after = await prisma.walletPass.findFirstOrThrow({
        where: { membershipId: c.membershipId },
      });
      expect(after.passVersion).toBe(before.passVersion + 1);
      expect(after.syncStatus).toBe('PENDING');
    });

    it('writes an audit event without the card token, phone number or any amount', async () => {
      const c = await card('Secret');
      const res = await stamp(tokens.staff1, { cardToken: c.token }).expect(200);
      const event = await prisma.auditEvent.findFirstOrThrow({
        where: { action: 'stamp.issued', targetId: res.body.stamp.id },
      });
      expect(event).toMatchObject({
        merchantId: w.a.merchantId,
        branchId: b1(),
        actorUserId: w.a.staff1.userId,
        targetType: 'stamp_event',
      });
      expect(event.requestId).toBeTruthy();
      const customer = await prisma.customer.findUniqueOrThrow({ where: { id: c.customerId } });
      const dump = JSON.stringify(event);
      for (const forbidden of [c.token, customer.phoneE164 ?? '', 'Secret', 'amount', 'price']) {
        expect(dump).not.toContain(forbidden);
      }
    });

    it('unlocks a reward when the threshold is reached and keeps cycling', async () => {
      const c = await card();
      const results = [];
      for (let i = 0; i < 7; i++)
        results.push((await stamp(tokens.staff1, { cardToken: c.token }).expect(200)).body);

      expect(results.map((r) => r.progress.current)).toEqual([1, 2, 0, 1, 2, 0, 1]);
      expect(results.map((r) => r.progress.completedCards)).toEqual([0, 0, 1, 1, 1, 2, 2]);
      expect(results.map((r) => r.reward.unlocked)).toEqual([
        false,
        false,
        true,
        false,
        false,
        true,
        false,
      ]);
      expect(results[2].message.en).toMatch(/Reward unlocked/);
      expect(results[2].reward).toMatchObject({ nameEn: 'Free item', nameAm: 'ነጻ እቃ' });
      expect(results[2].progress.rewardsAvailable).toBe(1);
      expect(results[5].progress.rewardsAvailable).toBe(2);

      const stampsInOrder = await prisma.stampEvent.findMany({
        where: { membershipId: c.membershipId },
        orderBy: { occurredAt: 'asc' },
      });
      const unlocks = await prisma.rewardUnlock.findMany({
        where: { membershipId: c.membershipId },
      });
      expect(unlocks).toHaveLength(2);
      expect(unlocks.map((u) => u.triggeringStampId).sort()).toEqual(
        [stampsInOrder[2]?.id, stampsInOrder[5]?.id].sort(),
      );
      expect(
        await prisma.auditEvent.count({
          where: {
            action: 'reward.unlocked',
            merchantId: w.a.merchantId,
            metadata: { path: ['membershipId'], equals: c.membershipId },
          },
        }),
      ).toBe(2);
      const jobs = await prisma.outboxJob.findMany({ where: { aggregateId: c.membershipId } });
      expect(jobs).toHaveLength(7);
      expect(
        jobs.filter((j) => (j.payload as { reason: string }).reason === 'reward_unlocked'),
      ).toHaveLength(2);
    });

    it('never creates a duplicate unlock under concurrent stamping', async () => {
      const c = await card();
      const results = await Promise.all(
        Array.from({ length: 9 }, () => stamp(tokens.staff1, { cardToken: c.token })),
      );
      expect(results.every((r) => r.status === 200)).toBe(true);
      const stamped = results.filter((r) => r.body.outcome === 'STAMPED');
      expect(stamped).toHaveLength(9); // program cooldown is 0
      expect(await stampCount(c.membershipId)).toBe(9);
      expect(await prisma.rewardUnlock.count({ where: { membershipId: c.membershipId } })).toBe(3);
      // Each response saw a distinct running total: the membership lock serialised them.
      const completed = stamped
        .map((r) => r.body.progress.completedCards * 3 + r.body.progress.current)
        .sort((x, y) => x - y);
      expect(completed).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });
  });

  describe('idempotency', () => {
    it('returns the original outcome for a repeated key and adds nothing', async () => {
      const c = await card();
      const key = randomUUID();
      const first = await stamp(tokens.staff1, { cardToken: c.token }, key).expect(200);
      const again = await stamp(tokens.staff1, { cardToken: c.token }, key).expect(200);

      expect(first.body.replayed).toBe(false);
      expect(again.body.replayed).toBe(true);
      expect(again.headers['idempotent-replay']).toBe('true');
      expect(first.headers['idempotent-replay']).toBeUndefined();
      expect({ ...again.body, replayed: false }).toEqual(first.body);
      expect(await stampCount(c.membershipId)).toBe(1);
      expect(await prisma.outboxJob.count({ where: { aggregateId: c.membershipId } })).toBe(1);
      expect(
        await prisma.auditEvent.count({
          where: { action: 'stamp.issued', targetId: first.body.stamp.id },
        }),
      ).toBe(1);
    });

    it('replays a rejection too, even after the reason has gone away', async () => {
      const c = await card();
      await prisma.customerMembership.update({
        where: { id: c.membershipId },
        data: { status: 'INACTIVE', deactivatedAt: new Date() },
      });
      const key = randomUUID();
      const first = await stamp(tokens.staff1, { cardToken: c.token }, key).expect(200);
      expect(first.body).toMatchObject({ outcome: 'REJECTED', reason: 'MEMBERSHIP_INACTIVE' });

      await prisma.customerMembership.update({
        where: { id: c.membershipId },
        data: { status: 'ACTIVE', deactivatedAt: null },
      });
      const again = await stamp(tokens.staff1, { cardToken: c.token }, key).expect(200);
      expect(again.body).toMatchObject({
        outcome: 'REJECTED',
        reason: 'MEMBERSHIP_INACTIVE',
        replayed: true,
      });
      expect(await stampCount(c.membershipId)).toBe(0);
      // A fresh key now works.
      await stamp(tokens.staff1, { cardToken: c.token }).expect(200);
    });

    it('converges many simultaneous retries of one key onto a single stamp', async () => {
      const c = await card();
      const key = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 10 }, () => stamp(tokens.staff1, { cardToken: c.token }, key)),
      );
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(results.filter((r) => !r.body.replayed)).toHaveLength(1);
      expect(new Set(results.map((r) => r.body.stamp.id)).size).toBe(1);
      expect(await stampCount(c.membershipId)).toBe(1);
      expect(await prisma.outboxJob.count({ where: { aggregateId: c.membershipId } })).toBe(1);
      expect(
        await prisma.idempotencyRecord.count({
          where: { staffMembershipId: w.a.staff1.staffId, key },
        }),
      ).toBe(1);
    });

    it('converges simultaneous retries of a rejected request too', async () => {
      const key = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => stamp(tokens.staff1, { cardToken: 'x'.repeat(43) }, key)),
      );
      expect(results.every((r) => r.status === 200 && r.body.reason === 'INVALID_TOKEN')).toBe(
        true,
      );
      expect(results.filter((r) => !r.body.replayed)).toHaveLength(1);
      expect(
        await prisma.idempotencyRecord.count({
          where: { staffMembershipId: w.a.staff1.staffId, key },
        }),
      ).toBe(1);
    });

    it('rejects reusing a key for a different card or branch', async () => {
      const [c1, c2] = [await card(), await card()];
      const key = randomUUID();
      await stamp(tokens.manager, { cardToken: c1.token, branchId: b1() }, key).expect(200);
      const other = await stamp(
        tokens.manager,
        { cardToken: c2.token, branchId: b1() },
        key,
      ).expect(422);
      expect(other.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      await stamp(tokens.manager, { cardToken: c1.token, branchId: w.a.branches[1] }, key).expect(
        422,
      );
      expect(await stampCount(c2.membershipId)).toBe(0);
    });

    it('scopes keys to the staff member', async () => {
      const c = await card();
      const key = randomUUID();
      const a = await stamp(tokens.manager, { cardToken: c.token, branchId: b1() }, key).expect(
        200,
      );
      const b = await stamp(tokens.owner, { cardToken: c.token, branchId: b1() }, key).expect(200);
      expect(a.body.replayed).toBe(false);
      expect(b.body.replayed).toBe(false);
      expect(await stampCount(c.membershipId)).toBe(2);
    });

    it('requires a well-formed Idempotency-Key', async () => {
      const c = await card();
      const noKey = await http()
        .post('/api/v1/scanner/stamps')
        .set('Authorization', tokens.staff1)
        .send({ cardToken: c.token })
        .expect(400);
      expect(noKey.body.error.code).toBe('VALIDATION_FAILED');
      for (const key of ['short', 'has spaces in it', 'x'.repeat(129), 'bad;chars1234']) {
        await stamp(tokens.staff1, { cardToken: c.token }, key).expect(400);
      }
      expect(await stampCount(c.membershipId)).toBe(0);
    });

    it('stores the answer with an expiry for later cleanup', async () => {
      const c = await card();
      const key = randomUUID();
      await stamp(tokens.staff1, { cardToken: c.token }, key).expect(200);
      const rec = await prisma.idempotencyRecord.findFirstOrThrow({
        where: { staffMembershipId: w.a.staff1.staffId, key },
      });
      expect(rec).toMatchObject({
        merchantId: w.a.merchantId,
        operation: 'stamp.confirm',
        responseStatus: 200,
      });
      expect(rec.requestHash).toMatch(/^[0-9a-f]{64}$/);
      expect(rec.expiresAt.getTime() - Date.now()).toBeGreaterThan(40 * 3_600_000);
      expect(JSON.stringify(rec)).not.toContain(c.token);
    });
  });

  describe('rejections', () => {
    const expectRejected = (
      body: Record<string, unknown> & { message: { en: string; am: string } },
      reason: string,
    ) => {
      expect(body).toMatchObject({ outcome: 'REJECTED', reason });
      expect(body.message.en).toBeTruthy();
      expect(body.message.am).toBeTruthy();
      expect(body.stamp).toBeUndefined();
      const text = JSON.stringify(body);
      expect(text).not.toMatch(/prisma|sql|tokenHash|token_hash|merchantId|stack|constraint/i);
    };

    it('refuses unknown and malformed cards identically', async () => {
      const random = await stamp(tokens.staff1, { cardToken: 'A'.repeat(43) }).expect(200);
      const malformed = await stamp(tokens.staff1, { cardToken: 'z'.repeat(25) }).expect(200);
      const phone = await stamp(tokens.staff1, { cardToken: '+251911234567+251911234567' }).expect(
        200,
      );
      for (const r of [random, malformed, phone]) expectRejected(r.body, 'INVALID_TOKEN');
      expect(malformed.body.message).toEqual(random.body.message);
      await validate(tokens.staff1, { cardToken: 'A'.repeat(43) })
        .expect(200)
        .then((r) => expectRejected(r.body, 'INVALID_TOKEN'));
    });

    it("treats another merchant's card as simply invalid and leaves it untouched", async () => {
      const programB = await createActiveProgram(prisma, w.b.merchantId);
      const cardB = await createCard(prisma, w.b.merchantId, programB.id);
      const foreign = await stamp(tokens.staff1, { cardToken: cardB.token }).expect(200);
      const unknown = await stamp(tokens.staff1, { cardToken: 'B'.repeat(43) }).expect(200);
      expectRejected(foreign.body, 'INVALID_TOKEN');
      expect(foreign.body).toEqual(unknown.body);
      expect(await stampCount(cardB.membershipId)).toBe(0);
      await validate(tokens.staff1, { cardToken: cardB.token })
        .expect(200)
        .then((r) => expectRejected(r.body, 'INVALID_TOKEN'));

      // ...and it works for its own merchant.
      const ownerB = bearer(await login(app, w.b.owner.email));
      await stamp(ownerB, { cardToken: cardB.token, branchId: w.b.branches[0] })
        .expect(200)
        .then((r) => expect(r.body.outcome).toBe('STAMPED'));
    });

    it('refuses inactive memberships and inactive programs', async () => {
      const inactive = await card();
      await prisma.customerMembership.update({
        where: { id: inactive.membershipId },
        data: { status: 'INACTIVE', deactivatedAt: new Date() },
      });
      expectRejected(
        (await stamp(tokens.staff1, { cardToken: inactive.token }).expect(200)).body,
        'MEMBERSHIP_INACTIVE',
      );
      expectRejected(
        (await validate(tokens.staff1, { cardToken: inactive.token }).expect(200)).body,
        'MEMBERSHIP_INACTIVE',
      );

      for (const status of ['PAUSED', 'ARCHIVED', 'DRAFT'] as const) {
        const w2 = await createWorld(prisma);
        const p = await createActiveProgram(prisma, w2.a.merchantId);
        const c = await createCard(prisma, w2.a.merchantId, p.id);
        await prisma.loyaltyProgram.update({ where: { id: p.id }, data: { status } });
        const owner = bearer(await login(app, w2.a.owner.email));
        const body = { cardToken: c.token, branchId: w2.a.branches[0] };
        expectRejected((await stamp(owner, body).expect(200)).body, 'PROGRAM_INACTIVE');
        expectRejected((await validate(owner, body).expect(200)).body, 'PROGRAM_INACTIVE');
        expect(await stampCount(c.membershipId)).toBe(0);
      }
    });

    it('refuses branches the staff member may not operate at, without saying why', async () => {
      const c = await card();
      const closed = await prisma.branch.create({
        data: {
          merchantId: w.a.merchantId,
          nameEn: 'Closed',
          status: 'INACTIVE',
          deactivatedAt: new Date(),
        },
      });
      const cases = [
        { who: tokens.staff2, branchId: b1() }, // assigned elsewhere
        { who: tokens.staff1, branchId: w.b.branches[0] }, // another tenant's branch
        { who: tokens.staff1, branchId: randomUUID() }, // does not exist
        { who: tokens.owner, branchId: closed.id }, // inactive branch
        { who: tokens.owner, branchId: w.b.branches[1] },
      ];
      const bodies = [];
      for (const { who, branchId } of cases) {
        const res = await stamp(who, { cardToken: c.token, branchId }).expect(200);
        expectRejected(res.body, 'BRANCH_NOT_PERMITTED');
        bodies.push(res.body);
        expectRejected(
          (await validate(who, { cardToken: c.token, branchId }).expect(200)).body,
          'BRANCH_NOT_PERMITTED',
        );
      }
      expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
      expect(await stampCount(c.membershipId)).toBe(0);

      // A foreign branch id is never written into this tenant's audit trail.
      const audits = await prisma.auditEvent.findMany({
        where: { merchantId: w.a.merchantId, action: 'scan.rejected' },
      });
      expect(audits.some((a) => a.branchId === w.b.branches[0])).toBe(false);
    });

    it('stops a deactivated staff member immediately', async () => {
      const m = await prisma.role.findUniqueOrThrow({ where: { key: 'STAFF' } });
      void m;
      const w2 = await createWorld(prisma);
      const p = await createActiveProgram(prisma, w2.a.merchantId);
      const c = await createCard(prisma, w2.a.merchantId, p.id);
      const staff = bearer(await login(app, w2.a.staff1.email));
      await stamp(staff, { cardToken: c.token }).expect(200);
      await prisma.staffMembership.update({
        where: { id: w2.a.staff1.staffId },
        data: { status: 'DEACTIVATED', deactivatedAt: new Date() },
      });
      await stamp(staff, { cardToken: c.token }).expect(401);
      await validate(staff, { cardToken: c.token }).expect(401);
      expect(await stampCount(c.membershipId)).toBe(1);
    });

    it('records each rejected confirmation in the audit trail but not rejected validations', async () => {
      const c = await card();
      await prisma.customerMembership.update({
        where: { id: c.membershipId },
        data: { status: 'INACTIVE', deactivatedAt: new Date() },
      });
      const before = await prisma.auditEvent.count({
        where: { action: 'scan.rejected', merchantId: w.a.merchantId },
      });
      await validate(tokens.staff1, { cardToken: c.token }).expect(200);
      await stamp(tokens.staff1, { cardToken: c.token }).expect(200);
      const events = await prisma.auditEvent.findMany({
        where: { action: 'scan.rejected', targetId: c.membershipId },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ actorUserId: w.a.staff1.userId, branchId: b1() });
      expect(events[0]?.metadata).toMatchObject({ reason: 'MEMBERSHIP_INACTIVE' });
      expect(
        await prisma.auditEvent.count({
          where: { action: 'scan.rejected', merchantId: w.a.merchantId },
        }),
      ).toBe(before + 1);
      expect(JSON.stringify(events)).not.toContain(c.token);
    });
  });

  describe('cooldown', () => {
    let w2: World;
    let slow: { id: string };
    let owner: string;
    beforeAll(async () => {
      w2 = await createWorld(prisma);
      slow = await createActiveProgram(prisma, w2.a.merchantId, {
        stampsRequired: 5,
        cooldownMinutes: 60,
      });
      owner = bearer(await login(app, w2.a.owner.email));
    });
    const slowCard = () => createCard(prisma, w2.a.merchantId, slow.id, 'Slow');
    const scan = (c: TestCard, key?: string) =>
      stamp(owner, { cardToken: c.token, branchId: w2.a.branches[0] }, key);

    it('blocks a second stamp inside the cooldown and says how long to wait', async () => {
      const c = await slowCard();
      await scan(c)
        .expect(200)
        .then((r) => expect(r.body.outcome).toBe('STAMPED'));
      const second = await scan(c).expect(200);
      expect(second.body).toMatchObject({
        outcome: 'REJECTED',
        reason: 'COOLDOWN_ACTIVE',
        customer: { firstName: 'Slow' },
        progress: { current: 1, required: 5 },
      });
      expect(second.body.retryAfterSeconds).toBeGreaterThan(3590);
      expect(second.body.retryAfterSeconds).toBeLessThanOrEqual(3600);
      expect(await stampCount(c.membershipId)).toBe(1);
      expect(await prisma.outboxJob.count({ where: { aggregateId: c.membershipId } })).toBe(1);

      const v = await http()
        .post('/api/v1/scanner/validate')
        .set('Authorization', owner)
        .send({ cardToken: c.token, branchId: w2.a.branches[0] })
        .expect(200);
      expect(v.body).toMatchObject({ outcome: 'REJECTED', reason: 'COOLDOWN_ACTIVE' });
    });

    it('lets exactly one of many simultaneous scans through', async () => {
      const c = await slowCard();
      const results = await Promise.all(Array.from({ length: 8 }, () => scan(c)));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(results.filter((r) => r.body.outcome === 'STAMPED')).toHaveLength(1);
      expect(results.filter((r) => r.body.reason === 'COOLDOWN_ACTIVE')).toHaveLength(7);
      expect(await stampCount(c.membershipId)).toBe(1);
      expect(
        await prisma.auditEvent.count({
          where: { action: 'scan.rejected', targetId: c.membershipId },
        }),
      ).toBe(7);
    });

    it('allows the next stamp once the cooldown has elapsed, and not a second before', async () => {
      const staffId = w2.a.owner.staffId;
      const ledger = (c: TestCard, agoSeconds: number) =>
        prisma.stampEvent.create({
          data: {
            merchantId: w2.a.merchantId,
            branchId: w2.a.branches[0],
            programId: slow.id,
            membershipId: c.membershipId,
            staffMembershipId: staffId,
            idempotencyKey: randomUUID(),
            occurredAt: new Date(Date.now() - agoSeconds * 1000),
          },
        });

      const justInside = await slowCard();
      await ledger(justInside, 3600 - 5);
      const blocked = await scan(justInside).expect(200);
      expect(blocked.body.reason).toBe('COOLDOWN_ACTIVE');
      expect(blocked.body.retryAfterSeconds).toBeLessThanOrEqual(6);

      const elapsed = await slowCard();
      await ledger(elapsed, 3600 + 5);
      const ok = await scan(elapsed).expect(200);
      expect(ok.body).toMatchObject({ outcome: 'STAMPED', progress: { current: 2 } });
    });

    it('ignores reversed stamps when measuring the cooldown', async () => {
      const c = await slowCard();
      const recent = await prisma.stampEvent.create({
        data: {
          merchantId: w2.a.merchantId,
          branchId: w2.a.branches[0],
          programId: slow.id,
          membershipId: c.membershipId,
          staffMembershipId: w2.a.owner.staffId,
          idempotencyKey: randomUUID(),
          occurredAt: new Date(Date.now() - 60_000),
        },
      });
      await scan(c)
        .expect(200)
        .then((r) => expect(r.body.reason).toBe('COOLDOWN_ACTIVE'));

      await prisma.reversalEvent.create({
        data: {
          merchantId: w2.a.merchantId,
          membershipId: c.membershipId,
          targetType: 'STAMP',
          stampEventId: recent.id,
          reversedByStaffId: w2.a.owner.staffId,
          reason: 'Scanned the wrong card',
          idempotencyKey: randomUUID(),
        },
      });
      const res = await scan(c).expect(200);
      // The reversed visit neither blocks the scan nor counts toward progress.
      expect(res.body).toMatchObject({ outcome: 'STAMPED', progress: { current: 1 } });
    });
  });

  describe('atomicity and safe errors', () => {
    it('rolls everything back and exposes nothing when the database write fails', async () => {
      const c = await card();
      const repo = app.get(StampsRepository);
      const spy = jest
        .spyOn(repo, 'createStamp')
        .mockRejectedValueOnce(
          new Error(
            'connection to server at "10.0.0.5", port 5432 failed: password authentication',
          ),
        );
      const key = randomUUID();
      const failed = await stamp(tokens.staff1, { cardToken: c.token }, key).expect(500);
      expect(failed.body.error.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(failed.body)).not.toMatch(/10\.0\.0\.5|password|5432|connection/);
      spy.mockRestore();

      expect(await stampCount(c.membershipId)).toBe(0);
      expect(await prisma.outboxJob.count({ where: { aggregateId: c.membershipId } })).toBe(0);
      expect(await prisma.idempotencyRecord.count({ where: { key } })).toBe(0);
      expect(
        await prisma.auditEvent.count({
          where: {
            action: 'stamp.issued',
            metadata: { path: ['membershipId'], equals: c.membershipId },
          },
        }),
      ).toBe(0);

      // The same key is still usable: the client may simply retry.
      const retry = await stamp(tokens.staff1, { cardToken: c.token }, key).expect(200);
      expect(retry.body).toMatchObject({ outcome: 'STAMPED', replayed: false });
      expect(await stampCount(c.membershipId)).toBe(1);
    });

    it('never keeps a stamp whose wallet update could not be queued', async () => {
      const c = await card();
      const outbox = app.get(OutboxService);
      const spy = jest
        .spyOn(outbox, 'enqueue')
        .mockRejectedValueOnce(new Error('outbox unavailable'));
      await stamp(tokens.staff1, { cardToken: c.token }).expect(500);
      spy.mockRestore();
      expect(await stampCount(c.membershipId)).toBe(0);
      expect(await prisma.rewardUnlock.count({ where: { membershipId: c.membershipId } })).toBe(0);
    });

    it('validates the request body strictly', async () => {
      const c = await card();
      const post = (body: object) => stamp(tokens.staff1, body);
      await post({}).expect(400);
      await post({ cardToken: 'short' }).expect(400);
      await post({ cardToken: c.token, branchId: 'not-a-uuid' }).expect(400);
      await post({ cardToken: c.token, device: { platform: 'symbian' } }).expect(400);
      await post({ cardToken: c.token, device: { deviceId: 'has spaces' } }).expect(400);
      await post({ cardToken: c.token, device: { imei: '123456789012345' } }).expect(400);
      await post({ cardToken: c.token, amount: 500 }).expect(400);
      await post({ cardToken: c.token, price: 5, currency: 'ETB' }).expect(400);
      await post({ cardToken: c.token, customerPhone: '+251911234567' }).expect(400);
      await post({ cardToken: c.token, merchantId: w.b.merchantId }).expect(400);
      await post({ cardToken: c.token, stamps: 5 }).expect(400);
      expect(await stampCount(c.membershipId)).toBe(0);
    });
  });

  describe('documentation', () => {
    it('documents the scanner endpoints and the Idempotency-Key header', async () => {
      const res = await http().get('/api/docs-json').expect(200);
      expect(Object.keys(res.body.paths)).toEqual(
        expect.arrayContaining(['/api/v1/scanner/validate', '/api/v1/scanner/stamps']),
      );
      const params = res.body.paths['/api/v1/scanner/stamps'].post.parameters;
      expect(
        params.some(
          (p: { name: string; required: boolean }) => p.name === 'Idempotency-Key' && p.required,
        ),
      ).toBe(true);
    });
  });
});

import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { canReverseStamp } from '../../src/modules/rewards';
import {
  TestCard,
  World,
  bearer,
  createActiveProgram,
  createCard,
  createWorld,
  login,
  seedLedger,
} from '../support/auth-fixture';
import { createTestApp } from '../support/create-test-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('Rewards, redemption and reversals (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let w: World;
  let program: { id: string };
  let rewardDefinitionId: string;
  let T: {
    staff1: string;
    staff2: string;
    manager: string;
    owner: string;
    admin: string;
    otherOwner: string;
  };
  const http = () => request(app.getHttpServer());
  const b1 = () => w.a.branches[0];

  const card = (name?: string) => createCard(prisma, w.a.merchantId, program.id, name);
  const stampOnce = (c: TestCard, auth = T.manager) =>
    http()
      .post('/api/v1/scanner/stamps')
      .set('Authorization', auth)
      .set('Idempotency-Key', randomUUID())
      .send({ cardToken: c.token, branchId: b1() });
  const give = async (c: TestCard, n: number) => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) ids.push((await stampOnce(c).expect(200)).body.stamp.id);
    return ids;
  };
  const lookup = (auth: string, body: object) =>
    http().post('/api/v1/scanner/rewards/lookup').set('Authorization', auth).send(body);
  const redeem = (auth: string, body: object, key: string = randomUUID()) =>
    http()
      .post('/api/v1/scanner/redemptions')
      .set('Authorization', auth)
      .set('Idempotency-Key', key)
      .send(body);
  const reverseStamp = (
    auth: string,
    id: string,
    body: object = { reason: 'Scanned by mistake' },
    key: string = randomUUID(),
  ) =>
    http()
      .post(`/api/v1/merchant/stamps/${id}/reverse`)
      .set('Authorization', auth)
      .set('Idempotency-Key', key)
      .send(body);
  const reverseRedemption = (
    auth: string,
    id: string,
    body: object = { reason: 'Customer returned the item' },
    key: string = randomUUID(),
  ) =>
    http()
      .post(`/api/v1/merchant/redemptions/${id}/reverse`)
      .set('Authorization', auth)
      .set('Idempotency-Key', key)
      .send(body);
  const rewardsView = async (c: TestCard, auth = T.owner): Promise<Json> =>
    (
      await http()
        .get(`/api/v1/merchant/memberships/${c.membershipId}/rewards`)
        .set('Authorization', auth)
        .expect(200)
    ).body;
  const states = async (c: TestCard) => (await rewardsView(c)).rewards.map((r: Json) => r.state);
  const body = (c: TestCard, extra: object = {}) => ({
    cardToken: c.token,
    branchId: b1(),
    ...extra,
  });

  beforeAll(async () => {
    prisma = new PrismaClient();
    w = await createWorld(prisma);
    program = await createActiveProgram(prisma, w.a.merchantId, {
      stampsRequired: 3,
      cooldownMinutes: 0,
    });
    rewardDefinitionId = (
      await prisma.rewardDefinition.findFirstOrThrow({ where: { programId: program.id } })
    ).id;
    app = await createTestApp();
    const tok = async (email: string) => bearer(await login(app, email));
    T = {
      staff1: await tok(w.a.staff1.email),
      staff2: await tok(w.a.staff2.email),
      manager: await tok(w.a.manager.email),
      owner: await tok(w.a.owner.email),
      admin: await tok(w.platformAdmin.email),
      otherOwner: await tok(w.b.owner.email),
    };
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('redeeming', () => {
    it('lists redeemable rewards without redeeming anything', async () => {
      const c = await card('Hana');
      await give(c, 3);
      const before = await prisma.redemptionEvent.count({
        where: { membershipId: c.membershipId },
      });
      const res = await lookup(T.staff1, { cardToken: c.token }).expect(200);
      expect(res.body).toMatchObject({
        outcome: 'AVAILABLE',
        reason: null,
        customer: { firstName: 'Hana' },
        progress: { current: 0, completedCards: 1, rewardsAvailable: 1 },
      });
      expect(res.body.rewards).toHaveLength(1);
      expect(res.body.rewards[0]).toMatchObject({ nameEn: 'Free item', nameAm: 'ነጻ እቃ' });
      expect(await prisma.redemptionEvent.count({ where: { membershipId: c.membershipId } })).toBe(
        before,
      );
    });

    it('redeems one reward and records who, where and when, then refuses a second redemption', async () => {
      const c = await card();
      await give(c, 3);
      const res = await redeem(T.staff1, {
        cardToken: c.token,
        device: { platform: 'ios', appVersion: '2.0.1' },
      }).expect(200);
      expect(res.body).toMatchObject({
        outcome: 'REDEEMED',
        reason: null,
        reward: { nameEn: 'Free item' },
        progress: { current: 0, completedCards: 1, rewardsAvailable: 0 },
        replayed: false,
      });

      const rows = await prisma.redemptionEvent.findMany({
        where: { membershipId: c.membershipId },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: res.body.redemption.id,
        merchantId: w.a.merchantId,
        branchId: b1(),
        staffMembershipId: w.a.staff1.staffId,
        attemptNumber: 1,
        deviceMetadata: { platform: 'ios', appVersion: '2.0.1' },
      });

      const second = await redeem(T.staff1, { cardToken: c.token }).expect(200);
      expect(second.body).toMatchObject({ outcome: 'REJECTED', reason: 'NO_REWARD_AVAILABLE' });
      expect(second.body.message.am).toBeTruthy();
      expect((await lookup(T.staff1, { cardToken: c.token }).expect(200)).body.reason).toBe(
        'NO_REWARD_AVAILABLE',
      );
      expect(await prisma.redemptionEvent.count({ where: { membershipId: c.membershipId } })).toBe(
        1,
      );
    });

    it('queues a wallet update and an audit event without personal data', async () => {
      const c = await card('Private');
      await give(c, 3);
      const res = await redeem(T.staff1, { cardToken: c.token }).expect(200);
      const jobs = await prisma.outboxJob.findMany({
        where: { aggregateId: c.membershipId },
        orderBy: { createdAt: 'asc' },
      });
      expect(jobs.map((j) => (j.payload as Json).reason)).toEqual([
        'stamp',
        'stamp',
        'reward_unlocked',
        'reward_redeemed',
      ]);
      const pass = await prisma.walletPass.findFirstOrThrow({
        where: { membershipId: c.membershipId },
      });
      expect(pass.syncStatus).toBe('PENDING');

      const event = await prisma.auditEvent.findFirstOrThrow({
        where: { action: 'reward.redeemed', targetId: res.body.redemption.id },
      });
      expect(event).toMatchObject({
        merchantId: w.a.merchantId,
        branchId: b1(),
        actorUserId: w.a.staff1.userId,
      });
      const customer = await prisma.customer.findUniqueOrThrow({ where: { id: c.customerId } });
      const dump = JSON.stringify(event);
      for (const forbidden of [c.token, customer.phoneE164 ?? '', 'Private'])
        expect(dump).not.toContain(forbidden);
    });

    it('replays a repeated key without redeeming twice, and rejects key reuse for another request', async () => {
      const c = await card();
      await give(c, 6);
      const key = randomUUID();
      const first = await redeem(T.staff1, { cardToken: c.token }, key).expect(200);
      const again = await redeem(T.staff1, { cardToken: c.token }, key).expect(200);
      expect(again.body).toMatchObject({ replayed: true, redemption: first.body.redemption });
      expect(again.headers['idempotent-replay']).toBe('true');
      expect(await prisma.redemptionEvent.count({ where: { membershipId: c.membershipId } })).toBe(
        1,
      );
      expect(
        await prisma.outboxJob.count({
          where: {
            aggregateId: c.membershipId,
            type: 'wallet.pass_update',
            payload: { path: ['reason'], equals: 'reward_redeemed' },
          },
        }),
      ).toBe(1);

      const other = await card();
      await redeem(T.staff1, { cardToken: other.token }, key).expect(422);
      const noKey = await http()
        .post('/api/v1/scanner/redemptions')
        .set('Authorization', T.staff1)
        .send({ cardToken: c.token })
        .expect(400);
      expect(noKey.body.error.code).toBe('VALIDATION_FAILED');
      await redeem(T.staff1, { cardToken: c.token }, 'short').expect(400);
    });

    it('never lets two devices redeem the same reward concurrently', async () => {
      const c = await card();
      await give(c, 3);
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => redeem(i % 2 ? T.staff1 : T.manager, body(c))),
      );
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(results.filter((r) => r.body.outcome === 'REDEEMED')).toHaveLength(1);
      expect(results.filter((r) => r.body.reason === 'NO_REWARD_AVAILABLE')).toHaveLength(7);
      expect(await prisma.redemptionEvent.count({ where: { membershipId: c.membershipId } })).toBe(
        1,
      );
    });

    it('lets exactly as many concurrent redemptions through as there are rewards', async () => {
      const c = await card();
      await give(c, 6); // two rewards
      const results = await Promise.all(
        Array.from({ length: 6 }, () => redeem(T.manager, body(c))),
      );
      expect(results.filter((r) => r.body.outcome === 'REDEEMED')).toHaveLength(2);
      const rows = await prisma.redemptionEvent.findMany({
        where: { membershipId: c.membershipId },
      });
      expect(new Set(rows.map((r) => r.rewardUnlockId)).size).toBe(2);
    });

    it('converges simultaneous retries of one key onto one redemption', async () => {
      const c = await card();
      await give(c, 3);
      const key = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 8 }, () => redeem(T.staff1, { cardToken: c.token }, key)),
      );
      expect(results.every((r) => r.status === 200 && r.body.outcome === 'REDEEMED')).toBe(true);
      expect(results.filter((r) => !r.body.replayed)).toHaveLength(1);
      expect(await prisma.redemptionEvent.count({ where: { membershipId: c.membershipId } })).toBe(
        1,
      );
    });

    it('redeems a specific reward when asked and refuses unknown or foreign unlock ids', async () => {
      const c = await card();
      await give(c, 6);
      const view = await rewardsView(c);
      const [first, second] = view.rewards as [Json, Json];
      const res = await redeem(T.manager, body(c, { rewardUnlockId: second.id })).expect(200);
      expect(res.body.reward.unlockId).toBe(second.id);

      for (const rewardUnlockId of [second.id, randomUUID()]) {
        const bad = await redeem(T.manager, body(c, { rewardUnlockId })).expect(200);
        expect(bad.body).toMatchObject({ outcome: 'REJECTED', reason: 'REWARD_NOT_AVAILABLE' });
      }
      // Another card's unlock id is just "not available" too.
      const other = await card();
      await give(other, 3);
      const foreign = (await rewardsView(other)).rewards[0];
      expect(
        (await redeem(T.manager, body(c, { rewardUnlockId: foreign.id })).expect(200)).body.reason,
      ).toBe('REWARD_NOT_AVAILABLE');
      expect(
        await prisma.redemptionEvent.count({ where: { membershipId: other.membershipId } }),
      ).toBe(0);
      expect(
        (await redeem(T.manager, body(c, { rewardUnlockId: first.id })).expect(200)).body.outcome,
      ).toBe('REDEEMED');
    });

    it('prefers the reward that expires soonest and ignores expired ones', async () => {
      const c = await card();
      await seedLedger(
        prisma,
        {
          merchantId: w.a.merchantId,
          branchId: b1(),
          programId: program.id,
          membershipId: c.membershipId,
          staffMembershipId: w.a.manager.staffId,
          rewardDefinitionId,
        },
        {
          stamps: 9,
          unlocks: [
            { afterStamp: 3, expiresInDays: -1 },
            { afterStamp: 6, expiresInDays: 30 },
            { afterStamp: 9, expiresInDays: 2 },
          ],
        },
      );
      expect(await states(c)).toEqual(['EXPIRED', 'AVAILABLE', 'AVAILABLE']);
      const view = await rewardsView(c);
      const soonest = view.rewards[2];
      const lookupRes = await lookup(T.manager, body(c)).expect(200);
      expect(lookupRes.body.rewards.map((r: Json) => r.unlockId)).toEqual([
        soonest.id,
        view.rewards[1].id,
      ]);
      expect((await redeem(T.manager, body(c)).expect(200)).body.reward.unlockId).toBe(soonest.id);
      expect((await redeem(T.manager, body(c)).expect(200)).body.reward.unlockId).toBe(
        view.rewards[1].id,
      );
      expect((await redeem(T.manager, body(c)).expect(200)).body.reason).toBe(
        'NO_REWARD_AVAILABLE',
      );
      expect(await states(c)).toEqual(['EXPIRED', 'REDEEMED', 'REDEEMED']);
      // An expired reward cannot be targeted explicitly either.
      const expiredId = view.rewards[0].id;
      expect(
        (await redeem(T.manager, body(c, { rewardUnlockId: expiredId })).expect(200)).body.reason,
      ).toBe('REWARD_NOT_AVAILABLE');
    });

    it('honours earned rewards while the program is paused or archived, but not while the membership is inactive', async () => {
      const w2 = await createWorld(prisma);
      const p = await createActiveProgram(prisma, w2.a.merchantId, { stampsRequired: 2 });
      const owner = bearer(await login(app, w2.a.owner.email));
      const b = w2.a.branches[0];
      const mk = async () => {
        const c = await createCard(prisma, w2.a.merchantId, p.id);
        for (let i = 0; i < 2; i++) {
          await http()
            .post('/api/v1/scanner/stamps')
            .set('Authorization', owner)
            .set('Idempotency-Key', randomUUID())
            .send({ cardToken: c.token, branchId: b })
            .expect(200);
        }
        return c;
      };
      const paused = await mk();
      const archived = await mk();
      const inactive = await mk();
      await prisma.loyaltyProgram.update({ where: { id: p.id }, data: { status: 'PAUSED' } });
      expect(
        (await redeem(owner, { cardToken: paused.token, branchId: b }).expect(200)).body.outcome,
      ).toBe('REDEEMED');
      // Stamping is refused while paused...
      const stamp = await http()
        .post('/api/v1/scanner/stamps')
        .set('Authorization', owner)
        .set('Idempotency-Key', randomUUID())
        .send({ cardToken: archived.token, branchId: b })
        .expect(200);
      expect(stamp.body.reason).toBe('PROGRAM_INACTIVE');
      // ...but archived programs still pay out what was earned.
      await prisma.loyaltyProgram.update({
        where: { id: p.id },
        data: { status: 'ARCHIVED', isDefault: false },
      });
      expect(
        (await redeem(owner, { cardToken: archived.token, branchId: b }).expect(200)).body.outcome,
      ).toBe('REDEEMED');
      await prisma.customerMembership.update({
        where: { id: inactive.membershipId },
        data: { status: 'INACTIVE', deactivatedAt: new Date() },
      });
      expect(
        (await redeem(owner, { cardToken: inactive.token, branchId: b }).expect(200)).body.reason,
      ).toBe('MEMBERSHIP_INACTIVE');
    });
  });

  describe('who may redeem', () => {
    it('allows only staff who can operate at the branch, and gives nothing away otherwise', async () => {
      const c = await card();
      await give(c, 3);
      const closed = await prisma.branch.create({
        data: {
          merchantId: w.a.merchantId,
          nameEn: 'Closed',
          status: 'INACTIVE',
          deactivatedAt: new Date(),
        },
      });
      const refusals = [
        await redeem(T.staff2, body(c)).expect(200), // assigned to another branch
        await redeem(T.staff1, body(c, { branchId: w.b.branches[0] })).expect(200), // another tenant's branch
        await redeem(T.staff1, body(c, { branchId: randomUUID() })).expect(200),
        await redeem(T.owner, body(c, { branchId: closed.id })).expect(200), // inactive branch
      ];
      for (const r of refusals)
        expect(r.body).toMatchObject({ outcome: 'REJECTED', reason: 'BRANCH_NOT_PERMITTED' });
      expect(new Set(refusals.map((r) => JSON.stringify(r.body))).size).toBe(1);
      expect(await prisma.redemptionEvent.count({ where: { membershipId: c.membershipId } })).toBe(
        0,
      );
      expect((await lookup(T.staff2, body(c)).expect(200)).body.reason).toBe(
        'BRANCH_NOT_PERMITTED',
      );
    });

    it('treats another merchant’s card as invalid and enforces authentication', async () => {
      const c = await card();
      await give(c, 3);
      const foreign = await redeem(T.otherOwner, {
        cardToken: c.token,
        branchId: w.b.branches[0],
      }).expect(200);
      expect(foreign.body).toMatchObject({ outcome: 'REJECTED', reason: 'INVALID_TOKEN' });
      expect(
        (await lookup(T.otherOwner, { cardToken: c.token, branchId: w.b.branches[0] }).expect(200))
          .body.reason,
      ).toBe('INVALID_TOKEN');

      await http()
        .post('/api/v1/scanner/redemptions')
        .set('Idempotency-Key', randomUUID())
        .send({ cardToken: c.token })
        .expect(401);
      await http().post('/api/v1/scanner/rewards/lookup').send({ cardToken: c.token }).expect(401);
      await redeem(T.admin, body(c)).expect(403);
      await lookup(T.admin, body(c)).expect(403);
      expect(await prisma.redemptionEvent.count({ where: { membershipId: c.membershipId } })).toBe(
        0,
      );
    });

    it('validates the body strictly and records rejected redemptions in the audit trail', async () => {
      const c = await card();
      await redeem(T.staff1, {}).expect(400);
      await redeem(T.staff1, { cardToken: c.token, rewardUnlockId: 'nope' }).expect(400);
      await redeem(T.staff1, { cardToken: c.token, amount: 5 }).expect(400);
      await redeem(T.staff1, { cardToken: c.token, device: { imei: '1' } }).expect(400);
      const before = await prisma.auditEvent.count({
        where: { action: 'redemption.rejected', merchantId: w.a.merchantId },
      });
      await redeem(T.staff1, { cardToken: c.token }).expect(200); // no reward yet
      expect(
        await prisma.auditEvent.count({
          where: { action: 'redemption.rejected', merchantId: w.a.merchantId },
        }),
      ).toBe(before + 1);
    });
  });

  describe('reversal permissions', () => {
    it('is limited to owners and authorised managers, in the caller’s merchant', async () => {
      const c = await card();
      const [s] = await give(c, 1);
      await reverseStamp(T.staff1, s!).expect(403);
      await reverseStamp(T.staff2, s!).expect(403);
      await reverseStamp(T.admin, s!).expect(403);
      await http()
        .post(`/api/v1/merchant/stamps/${s}/reverse`)
        .send({ reason: 'x y z' })
        .expect(401);
      await reverseStamp(T.otherOwner, s!).expect(404); // other tenant: indistinguishable from missing
      await reverseStamp(T.owner, randomUUID()).expect(404);
      await http()
        .get(`/api/v1/merchant/memberships/${c.membershipId}/ledger`)
        .set('Authorization', T.staff1)
        .expect(403);
      await http()
        .get(`/api/v1/merchant/memberships/${c.membershipId}/ledger`)
        .set('Authorization', T.otherOwner)
        .expect(404);
      expect(await prisma.reversalEvent.count({ where: { membershipId: c.membershipId } })).toBe(0);
      await reverseStamp(T.manager, s!).expect(200);
    });

    it('follows the permission catalogue: a manager without reversal:create is refused', async () => {
      const c = await card();
      const [s1, s2] = await give(c, 2);
      const perm = await prisma.permission.findUniqueOrThrow({ where: { key: 'reversal:create' } });
      const role = await prisma.role.findUniqueOrThrow({ where: { key: 'MANAGER' } });
      await prisma.rolePermission.delete({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
      });
      try {
        await reverseStamp(T.manager, s1!).expect(403);
        await reverseStamp(T.owner, s1!).expect(200); // owners are unaffected
      } finally {
        await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
      }
      await reverseStamp(T.manager, s2!).expect(200);
    });

    it('requires a reason and an idempotency key', async () => {
      const c = await card();
      const [s] = await give(c, 1);
      for (const payload of [
        {},
        { reason: '' },
        { reason: '  ' },
        { reason: 'ab' },
        { reason: 42 },
        { reason: 'x'.repeat(2001) },
        { reason: 'valid reason', extra: 1 },
      ]) {
        const res = await reverseStamp(T.manager, s!, payload).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
      await http()
        .post(`/api/v1/merchant/stamps/${s}/reverse`)
        .set('Authorization', T.manager)
        .send({ reason: 'No key sent' })
        .expect(400);
      await reverseStamp(T.manager, s!, { reason: 'ok reason' }, 'tiny').expect(400);
      expect(await prisma.reversalEvent.count({ where: { membershipId: c.membershipId } })).toBe(0);
    });
  });

  describe('reversing stamps', () => {
    it('appends a compensating event, leaves the original untouched, and recomputes progress', async () => {
      const c = await card();
      const [s1, s2] = await give(c, 2);
      const original = await prisma.stampEvent.findUniqueOrThrow({ where: { id: s2! } });

      const res = await reverseStamp(T.manager, s2!, {
        reason: '  Scanned the   wrong card ',
      }).expect(200);
      expect(res.body).toMatchObject({
        target: 'STAMP',
        targetId: s2,
        replayed: false,
        progress: { current: 1, required: 3 },
      });

      const reversal = await prisma.reversalEvent.findUniqueOrThrow({
        where: { id: res.body.reversalId },
      });
      expect(reversal).toMatchObject({
        merchantId: w.a.merchantId,
        membershipId: c.membershipId,
        targetType: 'STAMP',
        stampEventId: s2,
        redemptionEventId: null,
        reversedByStaffId: w.a.manager.staffId,
        reason: 'Scanned the wrong card',
      });
      expect(await prisma.stampEvent.findUniqueOrThrow({ where: { id: s2! } })).toEqual(original);
      expect(await prisma.stampEvent.count({ where: { membershipId: c.membershipId } })).toBe(2);

      const ledger = (
        await http()
          .get(`/api/v1/merchant/memberships/${c.membershipId}/ledger`)
          .set('Authorization', T.owner)
          .expect(200)
      ).body;
      expect(ledger.summary).toMatchObject({ effectiveStamps: 1, progress: { current: 1 } });
      const byId = new Map<string, Json>(ledger.entries.map((e: Json) => [e.id, e]));
      expect(byId.get(s2!)).toMatchObject({ type: 'STAMP', reversed: true });
      expect(byId.get(s1!)).toMatchObject({ type: 'STAMP', reversed: false });
      expect(byId.get(res.body.reversalId)).toMatchObject({
        type: 'REVERSAL',
        reversal: { targetType: 'STAMP', targetId: s2, reason: 'Scanned the wrong card' },
      });
    });

    it('audits the reversal, queues a wallet update, and keeps the reason text out of the audit log', async () => {
      const c = await card();
      const [s] = await give(c, 1);
      const res = await reverseStamp(T.owner, s!, { reason: 'Customer Almaz complained' }).expect(
        200,
      );
      const event = await prisma.auditEvent.findFirstOrThrow({
        where: { action: 'stamp.reversed', targetId: res.body.reversalId },
      });
      expect(event).toMatchObject({ merchantId: w.a.merchantId, actorUserId: w.a.owner.userId });
      expect(event.metadata).toMatchObject({ membershipId: c.membershipId, reversedEventId: s });
      expect(JSON.stringify(event)).not.toContain('Almaz');
      const job = await prisma.outboxJob.findFirstOrThrow({
        where: {
          aggregateId: c.membershipId,
          payload: { path: ['reason'], equals: 'stamp_reversed' },
        },
      });
      expect(job.merchantId).toBe(w.a.merchantId);
      expect(
        (await prisma.walletPass.findFirstOrThrow({ where: { membershipId: c.membershipId } }))
          .syncStatus,
      ).toBe('PENDING');
    });

    it('refuses a second reversal of the same stamp, including simultaneous attempts', async () => {
      const c = await card();
      const [s] = await give(c, 1);
      const results = await Promise.all(
        Array.from({ length: 6 }, () => reverseStamp(T.manager, s!)),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(
        results.filter((r) => r.status === 409 && r.body.error.code === 'ALREADY_REVERSED'),
      ).toHaveLength(5);
      expect(await prisma.reversalEvent.count({ where: { stampEventId: s } })).toBe(1);
      expect((await reverseStamp(T.owner, s!).expect(409)).body.error.code).toBe(
        'ALREADY_REVERSED',
      );
    });

    it('is idempotent per key and rejects a key reused for another stamp', async () => {
      const c = await card();
      const [s1, s2] = await give(c, 2);
      const key = randomUUID();
      const first = await reverseStamp(T.manager, s1!, { reason: 'first try' }, key).expect(200);
      const again = await reverseStamp(T.manager, s1!, { reason: 'first try' }, key).expect(200);
      expect(again.body).toMatchObject({ replayed: true, reversalId: first.body.reversalId });
      expect(again.headers['idempotent-replay']).toBe('true');
      await reverseStamp(T.manager, s2!, { reason: 'another' }, key).expect(422);
      expect(await prisma.reversalEvent.count({ where: { membershipId: c.membershipId } })).toBe(1);

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          reverseStamp(
            T.manager,
            s2!,
            { reason: 'concurrent' },
            'same-key-concurrent-' + c.membershipId.slice(0, 8),
          ),
        ),
      );
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(results.filter((r) => !r.body.replayed)).toHaveLength(1);
      expect(await prisma.reversalEvent.count({ where: { stampEventId: s2 } })).toBe(1);
    });

    it('voids the reward when its stamps are reversed, and does not duplicate it when the card is completed again', async () => {
      const c = await card();
      const ids = await give(c, 3);
      const view1 = await rewardsView(c);
      expect(view1.rewards.map((r: Json) => r.state)).toEqual(['AVAILABLE']);
      const unlockId = view1.rewards[0].id;

      const res = await reverseStamp(T.manager, ids[0]!).expect(200);
      expect(res.body.progress).toMatchObject({
        current: 2,
        completedCards: 0,
        rewardsAvailable: 0,
      });
      expect(await states(c)).toEqual(['REVERSED']);
      expect((await lookup(T.staff1, { cardToken: c.token }).expect(200)).body.reason).toBe(
        'NO_REWARD_AVAILABLE',
      );
      expect((await redeem(T.staff1, { cardToken: c.token }).expect(200)).body.reason).toBe(
        'NO_REWARD_AVAILABLE',
      );

      const again = await stampOnce(c).expect(200);
      expect(again.body.progress).toMatchObject({
        current: 0,
        completedCards: 1,
        rewardsAvailable: 1,
      });
      expect(again.body.reward.unlocked).toBe(true);
      // The same reward row is back in force: no second reward was created.
      expect(await prisma.rewardUnlock.count({ where: { membershipId: c.membershipId } })).toBe(1);
      const view2 = await rewardsView(c);
      expect(view2.rewards).toHaveLength(1);
      expect(view2.rewards[0]).toMatchObject({ id: unlockId, state: 'AVAILABLE' });
      expect((await redeem(T.staff1, { cardToken: c.token }).expect(200)).body.outcome).toBe(
        'REDEEMED',
      );
      expect((await redeem(T.staff1, { cardToken: c.token }).expect(200)).body.outcome).toBe(
        'REJECTED',
      );
    });

    it('refuses to reverse a stamp that backs a redeemed reward until the redemption is reversed', async () => {
      const c = await card();
      const ids = await give(c, 3);
      const red = await redeem(T.staff1, { cardToken: c.token }).expect(200);

      const blocked = await reverseStamp(T.manager, ids[2]!).expect(409);
      expect(blocked.body.error.code).toBe('REWARD_ALREADY_REDEEMED');
      expect(await prisma.reversalEvent.count({ where: { membershipId: c.membershipId } })).toBe(0);
      expect(await states(c)).toEqual(['REDEEMED']);

      await reverseRedemption(T.manager, red.body.redemption.id).expect(200);
      expect(await states(c)).toEqual(['AVAILABLE']);
      await reverseStamp(T.manager, ids[2]!).expect(200);
      expect(await states(c)).toEqual(['REVERSED']);
    });

    it('allows reversing surplus stamps while a redeemed reward stays backed', async () => {
      const c = await card();
      const ids = await give(c, 4);
      await redeem(T.staff1, { cardToken: c.token }).expect(200);
      const res = await reverseStamp(T.manager, ids[3]!).expect(200);
      expect(res.body.progress).toMatchObject({
        current: 0,
        completedCards: 1,
        rewardsAvailable: 0,
      });
      await reverseStamp(T.manager, ids[2]!).expect(409);
      expect(await states(c)).toEqual(['REDEEMED']);
    });

    it('lets a reversal of the card-completing stamp be followed by a fresh scan despite the cooldown history', async () => {
      const w2 = await createWorld(prisma);
      const slow = await createActiveProgram(prisma, w2.a.merchantId, {
        stampsRequired: 3,
        cooldownMinutes: 60,
      });
      const owner = bearer(await login(app, w2.a.owner.email));
      const c = await createCard(prisma, w2.a.merchantId, slow.id);
      const scan = () =>
        http()
          .post('/api/v1/scanner/stamps')
          .set('Authorization', owner)
          .set('Idempotency-Key', randomUUID())
          .send({ cardToken: c.token, branchId: w2.a.branches[0] });
      const first = await scan().expect(200);
      expect((await scan().expect(200)).body.reason).toBe('COOLDOWN_ACTIVE');
      await http()
        .post(`/api/v1/merchant/stamps/${first.body.stamp.id}/reverse`)
        .set('Authorization', owner)
        .set('Idempotency-Key', randomUUID())
        .send({ reason: 'Wrong customer' })
        .expect(200);
      expect((await scan().expect(200)).body).toMatchObject({
        outcome: 'STAMPED',
        progress: { current: 1 },
      });
    });
  });

  describe('reversing redemptions', () => {
    it('appends a compensating event, makes the reward available again, and numbers the next attempt', async () => {
      const c = await card();
      await give(c, 3);
      const red = await redeem(T.staff1, { cardToken: c.token }).expect(200);
      const original = await prisma.redemptionEvent.findUniqueOrThrow({
        where: { id: red.body.redemption.id },
      });

      const res = await reverseRedemption(T.manager, red.body.redemption.id, {
        reason: 'Item was out of stock',
      }).expect(200);
      expect(res.body).toMatchObject({
        target: 'REDEMPTION',
        targetId: red.body.redemption.id,
        progress: { rewardsAvailable: 1 },
      });
      expect(
        await prisma.redemptionEvent.findUniqueOrThrow({ where: { id: original.id } }),
      ).toEqual(original);
      expect(
        await prisma.reversalEvent.findUniqueOrThrow({ where: { id: res.body.reversalId } }),
      ).toMatchObject({
        targetType: 'REDEMPTION',
        redemptionEventId: original.id,
        stampEventId: null,
        reason: 'Item was out of stock',
      });
      expect(await states(c)).toEqual(['AVAILABLE']);
      expect((await lookup(T.staff1, { cardToken: c.token }).expect(200)).body.outcome).toBe(
        'AVAILABLE',
      );

      const second = await redeem(T.staff1, { cardToken: c.token }).expect(200);
      expect(second.body.outcome).toBe('REDEEMED');
      const rows = await prisma.redemptionEvent.findMany({
        where: { rewardUnlockId: original.rewardUnlockId },
        orderBy: { attemptNumber: 'asc' },
      });
      expect(rows.map((r) => r.attemptNumber)).toEqual([1, 2]);

      await reverseRedemption(T.manager, red.body.redemption.id).expect(409);
      expect(
        await prisma.auditEvent.count({
          where: { action: 'redemption.reversed', targetId: res.body.reversalId },
        }),
      ).toBe(1);
      expect(
        await prisma.outboxJob.count({
          where: {
            aggregateId: c.membershipId,
            payload: { path: ['reason'], equals: 'redemption_reversed' },
          },
        }),
      ).toBe(1);
    });

    it('cannot be requested by staff, other merchants or without a reason', async () => {
      const c = await card();
      await give(c, 3);
      const red = await redeem(T.staff1, { cardToken: c.token }).expect(200);
      const id = red.body.redemption.id;
      await reverseRedemption(T.staff1, id).expect(403);
      await reverseRedemption(T.otherOwner, id).expect(404);
      await reverseRedemption(T.manager, id, { reason: '' }).expect(400);
      await reverseRedemption(T.manager, randomUUID()).expect(404);
      expect(await prisma.reversalEvent.count({ where: { membershipId: c.membershipId } })).toBe(0);
    });

    it('serialises a simultaneous redemption reversal and re-redemption without losing a reward', async () => {
      const c = await card();
      await give(c, 3);
      const red = await redeem(T.staff1, { cardToken: c.token }).expect(200);
      const results = await Promise.all([
        reverseRedemption(T.manager, red.body.redemption.id),
        redeem(T.staff1, { cardToken: c.token }),
        redeem(T.manager, body(c)),
      ]);
      // Whatever the interleaving, entitlement is never exceeded.
      const view = await rewardsView(c);
      const redeemed = view.rewards.filter((r: Json) => r.state === 'REDEEMED').length;
      const available = view.rewards.filter((r: Json) => r.state === 'AVAILABLE').length;
      expect(redeemed + available).toBe(1);
      expect(redeemed).toBeLessThanOrEqual(1);
      expect(results[0]!.status).toBe(200);
    });
  });

  describe('append-only guarantees', () => {
    it('offers no way to edit or delete events, and the database refuses it too', async () => {
      const c = await card();
      const [s] = await give(c, 1);
      await give(c, 3); // a surplus stamp keeps the redeemed reward backed after reversing the first
      const red = await redeem(T.staff1, { cardToken: c.token }).expect(200);
      for (const [method, path] of [
        ['delete', `/api/v1/merchant/stamps/${s}`],
        ['patch', `/api/v1/merchant/stamps/${s}`],
        ['put', `/api/v1/merchant/redemptions/${red.body.redemption.id}`],
        ['delete', `/api/v1/merchant/redemptions/${red.body.redemption.id}`],
        ['delete', `/api/v1/scanner/redemptions/${red.body.redemption.id}`],
      ] as const) {
        expect(
          (await http()[method](path).set('Authorization', T.owner).send({ reason: 'tamper' }))
            .status,
        ).toBe(404);
      }
      const rev = await reverseStamp(T.manager, s!).expect(200);
      await expect(
        prisma.reversalEvent.update({
          where: { id: rev.body.reversalId },
          data: { reason: 'edited' },
        }),
      ).rejects.toThrow(/append-only/);
      await expect(
        prisma.reversalEvent.delete({ where: { id: rev.body.reversalId } }),
      ).rejects.toThrow(/append-only/);
      await expect(
        prisma.redemptionEvent.update({
          where: { id: red.body.redemption.id },
          data: { attemptNumber: 9 },
        }),
      ).rejects.toThrow(/append-only/);
      await expect(
        prisma.redemptionEvent.delete({ where: { id: red.body.redemption.id } }),
      ).rejects.toThrow(/append-only/);
      await expect(prisma.stampEvent.delete({ where: { id: s! } })).rejects.toThrow(/append-only/);
    });
  });

  describe('ledger consistency', () => {
    it('stays deterministic and never exceeds entitlement over a long random sequence of operations', async () => {
      const c = await card('Random');
      let seed = 987654321;
      const rand = (n: number) => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed % n;
      };
      const snapshots = new Map<string, string>(); // originals must never change
      const stampsAll: string[] = [];
      const redemptionsAll: string[] = [];

      const verify = async () => {
        const stamps = await prisma.stampEvent.findMany({
          where: { membershipId: c.membershipId },
          include: { reversal: true },
        });
        const reds = await prisma.redemptionEvent.findMany({
          where: { membershipId: c.membershipId },
          include: { reversal: true },
        });
        const effective = stamps.filter((s) => !s.reversal).length;
        const activeReds = reds.filter((r) => !r.reversal).length;
        const earned = Math.floor(effective / 3);

        const view = await rewardsView(c);
        const count = (st: string) => view.rewards.filter((r: Json) => r.state === st).length;
        expect(view.effectiveStamps).toBe(effective);
        expect(view.progress).toMatchObject({ current: effective % 3, completedCards: earned });
        expect(count('REDEEMED')).toBe(activeReds);
        expect(count('REDEEMED')).toBeLessThanOrEqual(earned);
        expect(count('REDEEMED') + count('AVAILABLE') + count('EXPIRED')).toBe(earned);
        expect(view.rewards.length).toBeGreaterThanOrEqual(earned);

        // Every event reversed at most once; originals unchanged.
        expect(await prisma.reversalEvent.count({ where: { membershipId: c.membershipId } })).toBe(
          stamps.filter((s) => s.reversal).length + reds.filter((r) => r.reversal).length,
        );
        for (const s of stamps) {
          const { reversal: _r, ...row } = s;
          void _r;
          const json = JSON.stringify(row);
          expect(snapshots.get(s.id) ?? json).toBe(json);
          snapshots.set(s.id, json);
        }
        return { stamps, reds, effective, activeReds, view };
      };

      for (let step = 0; step < 45; step++) {
        const op = rand(10);
        const state = await verify();
        if (op < 5) {
          const res = await stampOnce(c).expect(200);
          expect(res.body.outcome).toBe('STAMPED');
          stampsAll.push(res.body.stamp.id);
        } else if (op < 7) {
          const available = state.view.rewards.filter((r: Json) => r.state === 'AVAILABLE').length;
          const res = await redeem(T.manager, body(c)).expect(200);
          if (available > 0) {
            expect(res.body.outcome).toBe('REDEEMED');
            redemptionsAll.push(res.body.redemption.id);
          } else {
            expect(res.body.reason).toBe('NO_REWARD_AVAILABLE');
          }
        } else if (op < 9) {
          const candidates = state.stamps.filter((s) => !s.reversal);
          if (candidates.length === 0) continue;
          const target = candidates[rand(candidates.length)]!;
          const allowed = canReverseStamp({
            effectiveStamps: state.effective,
            required: 3,
            activeRedemptions: state.activeReds,
          });
          const res = await reverseStamp(T.manager, target.id);
          if (allowed) expect(res.status).toBe(200);
          else {
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe('REWARD_ALREADY_REDEEMED');
          }
        } else {
          const candidates = state.reds.filter((r) => !r.reversal);
          if (candidates.length === 0) continue;
          await reverseRedemption(T.manager, candidates[rand(candidates.length)]!.id).expect(200);
        }
      }
      const final = await verify();
      expect(final.stamps.length).toBeGreaterThan(5);
      expect(stampsAll.length + redemptionsAll.length).toBeGreaterThan(5);
      // Replaying the whole history from the raw ledger gives the same totals the API reports.
      const ledger = (
        await http()
          .get(`/api/v1/merchant/memberships/${c.membershipId}/ledger`)
          .set('Authorization', T.owner)
          .expect(200)
      ).body;
      const stampEntries = ledger.entries.filter((e: Json) => e.type === 'STAMP');
      expect(stampEntries.filter((e: Json) => !e.reversed)).toHaveLength(final.effective);
    });
  });

  describe('documentation', () => {
    it('documents redemption, reversal and ledger endpoints', async () => {
      const res = await http().get('/api/docs-json').expect(200);
      expect(Object.keys(res.body.paths)).toEqual(
        expect.arrayContaining([
          '/api/v1/scanner/rewards/lookup',
          '/api/v1/scanner/redemptions',
          '/api/v1/merchant/stamps/{stampId}/reverse',
          '/api/v1/merchant/redemptions/{redemptionId}/reverse',
          '/api/v1/merchant/memberships/{membershipId}/rewards',
          '/api/v1/merchant/memberships/{membershipId}/ledger',
        ]),
      );
    });
  });
});

import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import {
  World,
  bearer,
  createActiveProgram,
  createWorld,
  login,
  randomPhone,
} from '../support/auth-fixture';
import { createTestApp } from '../support/create-test-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Merchant A runs in Africa/Addis_Ababa (UTC+3, no daylight saving). Every ledger row is placed exactly on a
 * boundary so that a UTC-based or inclusive/exclusive mistake changes a number.
 *
 *   local March 2026  = 2026-02-28T21:00:00.000Z (inclusive) .. 2026-03-31T21:00:00.000Z (exclusive)
 */
describe('Analytics (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let w: World;
  let programId: string;
  let rewardDefinitionId: string;
  let T: { owner: string; manager: string; staff: string; otherOwner: string };
  let ids: Record<string, string>; // customer label -> membership id
  let customers: Record<string, string>; // customer label -> customer id
  const http = () => request(app.getHttpServer());
  const get = (path: string, auth: string) =>
    http().get(`/api/v1/merchant/analytics${path}`).set('Authorization', auth);
  const ok = async (path: string, auth = T.owner): Promise<Json> =>
    (await get(path, auth).expect(200)).body;
  const MARCH = 'from=2026-03-01&to=2026-03-31';
  const at = (iso: string) => new Date(iso);

  async function member(label: string, joinedAt: string) {
    const customer = await prisma.customer.create({
      data: {
        merchantId: w.a.merchantId,
        phoneE164: `+251${randomPhone().slice(1)}`,
        firstName: label,
      },
    });
    const membership = await prisma.customerMembership.create({
      data: {
        merchantId: w.a.merchantId,
        customerId: customer.id,
        programId,
        tokenHash: `h-${randomUUID()}`,
        joinedAt: at(joinedAt),
      },
    });
    ids[label] = membership.id;
    customers[label] = customer.id;
  }

  async function stamp(
    label: string,
    iso: string,
    opts: { staff?: 1 | 2; reversed?: boolean } = {},
  ) {
    const staff = opts.staff === 2 ? w.a.staff2 : w.a.staff1;
    const branchId = opts.staff === 2 ? w.a.branches[1] : w.a.branches[0];
    const s = await prisma.stampEvent.create({
      data: {
        merchantId: w.a.merchantId,
        branchId,
        programId,
        membershipId: ids[label]!,
        staffMembershipId: staff.staffId,
        idempotencyKey: randomUUID(),
        occurredAt: at(iso),
      },
    });
    if (opts.reversed) {
      await prisma.reversalEvent.create({
        data: {
          merchantId: w.a.merchantId,
          membershipId: ids[label]!,
          targetType: 'STAMP',
          stampEventId: s.id,
          reversedByStaffId: w.a.manager.staffId,
          reason: 'Scanned by mistake',
          idempotencyKey: randomUUID(),
        },
      });
    }
    return s;
  }

  async function unlock(label: string, stampId: string, iso: string) {
    return prisma.rewardUnlock.create({
      data: {
        merchantId: w.a.merchantId,
        programId,
        membershipId: ids[label]!,
        rewardDefinitionId,
        triggeringStampId: stampId,
        unlockedAt: at(iso),
      },
    });
  }

  async function redeem(label: string, unlockId: string, iso: string, reversed = false) {
    const r = await prisma.redemptionEvent.create({
      data: {
        merchantId: w.a.merchantId,
        branchId: w.a.branches[0],
        membershipId: ids[label]!,
        rewardUnlockId: unlockId,
        staffMembershipId: w.a.staff1.staffId,
        idempotencyKey: randomUUID(),
        occurredAt: at(iso),
      },
    });
    if (reversed) {
      await prisma.reversalEvent.create({
        data: {
          merchantId: w.a.merchantId,
          membershipId: ids[label]!,
          targetType: 'REDEMPTION',
          redemptionEventId: r.id,
          reversedByStaffId: w.a.manager.staffId,
          reason: 'Customer returned the item',
          idempotencyKey: randomUUID(),
        },
      });
    }
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    w = await createWorld(prisma);
    ids = {};
    customers = {};
    programId = (await createActiveProgram(prisma, w.a.merchantId)).id;
    rewardDefinitionId = (await prisma.rewardDefinition.findFirstOrThrow({ where: { programId } }))
      .id;

    await member('C1', '2026-01-01T09:00:00.000Z');
    await member('C2', '2026-03-04T09:00:00.000Z');
    await member('C3', '2026-02-01T09:00:00.000Z');
    await member('C4', '2026-02-28T21:00:00.000Z'); // first instant of local March
    await member('C5', '2026-03-31T21:00:00.000Z'); // first instant of local April
    await member('C6', '2026-02-01T09:00:00.000Z');

    await stamp('C1', '2026-01-05T09:00:00.000Z');
    await stamp('C1', '2026-02-15T12:00:00.000Z');
    const c1March = await stamp('C1', '2026-03-10T12:00:00.000Z');
    const c2March = await stamp('C2', '2026-03-05T09:00:00.000Z');
    await stamp('C3', '2026-02-28T20:59:59.999Z', { staff: 2 }); // last ms of local February
    await stamp('C3', '2026-03-31T20:59:59.999Z', { staff: 2 }); // last ms of local March
    const c4March = await stamp('C4', '2026-02-28T21:00:00.000Z'); // first ms of local March
    await stamp('C5', '2026-03-31T21:00:00.000Z'); // first ms of local April
    await stamp('C6', '2026-02-10T09:00:00.000Z');
    const c6Reversed = await stamp('C6', '2026-03-12T09:00:00.000Z', { reversed: true });

    const u1 = await unlock('C1', c1March.id, '2026-03-10T12:00:00.000Z');
    await unlock('C2', c2March.id, '2026-03-05T09:00:00.000Z');
    const u4 = await unlock('C4', c4March.id, '2026-03-01T06:00:00.000Z');
    await unlock('C6', c6Reversed.id, '2026-03-12T09:00:00.000Z'); // trigger reversed: not counted
    await redeem('C1', u1.id, '2026-03-12T10:00:00.000Z');
    await redeem('C4', u4.id, '2026-03-02T10:00:00.000Z', true); // reversed: not counted

    for (const [label, provider] of [
      ['C1', 'WEB'],
      ['C2', 'WEB'],
      ['C1', 'GOOGLE'],
    ] as const) {
      await prisma.walletPass.create({
        data: {
          merchantId: w.a.merchantId,
          membershipId: ids[label]!,
          provider,
          status: 'ACTIVE',
          syncStatus: 'SYNCED',
        },
      });
    }
    const job = (status: 'COMPLETED' | 'DEAD' | 'PENDING', attempts = 1) =>
      prisma.outboxJob.create({
        data: {
          merchantId: w.a.merchantId,
          type: 'wallet.pass_update',
          aggregateType: 'membership',
          aggregateId: ids.C1!,
          status,
          attempts,
        },
      });
    await job('COMPLETED');
    await job('COMPLETED');
    await job('COMPLETED', 3);
    await job('DEAD', 8);
    await job('PENDING', 0);

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

  describe('access', () => {
    it('is open to owners and managers, closed to scanner staff and anonymous callers', async () => {
      await get('/overview', T.owner).expect(200);
      await get('/overview', T.manager).expect(200);
      await get('/overview', T.staff).expect(403);
      await get('/definitions', T.staff).expect(403);
      await http().get('/api/v1/merchant/analytics/overview').expect(401);
    });

    it('publishes the definition of every metric and carries no financial fields', async () => {
      const defs = await ok('/definitions');
      expect(defs.map((d: Json) => d.key)).toEqual(
        expect.arrayContaining([
          'monthlyReturningLoyaltyCustomers',
          'qualifyingVisit',
          'redemptionRate',
        ]),
      );
      const all = JSON.stringify([
        defs,
        await ok(`/overview?${MARCH}`),
        await ok('/wallet'),
        await ok('/cohorts'),
      ]);
      expect(all).not.toMatch(/revenue|amount|price|payment|order|billing|currency|spend/i);
    });
  });

  describe('overview for local March 2026', () => {
    it('counts members, visits, rewards and ratios exactly', async () => {
      const o = await ok(`/overview?${MARCH}`);
      expect(o.range).toMatchObject({
        from: '2026-02-28T21:00:00.000Z',
        to: '2026-03-31T21:00:00.000Z',
        timeZone: 'Africa/Addis_Ababa',
      });
      // New in March: C2 and C4 (C4 joined at the first instant of March). C5 joined at the first instant of April.
      expect(o.newMembers).toBe(2);
      // Qualifying visits: C1, C2, C3 (last ms), C4 (first ms). C5 is April, C6's visit was reversed.
      expect(o.stampsIssued).toEqual({ count: 4, reversed: 1 });
      expect(o.activeMembers).toBe(4);
      expect(o.returningCustomers).toBe(2); // C1 and C3 visited earlier; C2 and C4 are first-timers
      expect(o.rewardsUnlocked).toBe(3); // C6's reward came from a reversed stamp
      expect(o.rewardsRedeemed).toBe(1); // C4's redemption was reversed
      expect(o.redemptionRate).toBe(0.3333);
      expect(o.averageVisitsPerActiveMember).toBe(1);
    });

    it('measures time between visits, ignoring reversed visits', async () => {
      const g = (await ok(`/overview?${MARCH}`)).timeBetweenVisits;
      // C1: Feb 15 12:00Z -> Mar 10 12:00Z = 552 h. C3: 31 days = 744 h.
      expect(g).toEqual({ intervals: 2, averageHours: 648, medianHours: 648, p90Hours: 724.8 });
    });

    it('treats a timestamp range as inclusive at the start and exclusive at the end', async () => {
      const exact = await ok('/overview?from=2026-02-28T21:00:00.000Z&to=2026-03-31T21:00:00.000Z');
      expect(exact.stampsIssued.count).toBe(4); // includes C4 at "from", excludes C5 at "to"
      const oneMsEarlier = await ok(
        '/overview?from=2026-02-28T21:00:00.000Z&to=2026-03-31T20:59:59.999Z',
      );
      expect(oneMsEarlier.stampsIssued.count).toBe(3); // C3's stamp sits exactly on the exclusive end
    });

    it('returns nulls instead of dividing by zero for an empty period', async () => {
      const o = await ok('/overview?from=2025-01-01&to=2025-01-31');
      expect(o).toMatchObject({
        newMembers: 0,
        activeMembers: 0,
        stampsIssued: { count: 0, reversed: 0 },
        redemptionRate: null,
        averageVisitsPerActiveMember: null,
        timeBetweenVisits: { intervals: 0, averageHours: null, medianHours: null, p90Hours: null },
      });
    });

    it('can be limited to one program, and a program of another merchant matches nothing', async () => {
      expect((await ok(`/overview?${MARCH}&programId=${programId}`)).activeMembers).toBe(4);
      const foreign =
        (await prisma.loyaltyProgram.findFirst({ where: { merchantId: w.b.merchantId } })) ??
        (await createActiveProgram(prisma, w.b.merchantId));
      expect((await ok(`/overview?${MARCH}&programId=${foreign.id}`)).activeMembers).toBe(0);
    });
  });

  describe('north-star: Monthly Returning Loyalty Customers', () => {
    it('counts customers with a visit in the month and one before it', async () => {
      const r = await ok('/monthly-returning-customers?month=2026-03&months=3');
      expect(r).toMatchObject({
        metric: 'monthlyReturningLoyaltyCustomers',
        month: '2026-03',
        value: 2,
      });
      expect(r.series.map((s: Json) => s.month)).toEqual(['2026-01', '2026-02', '2026-03']);
      expect(r.series[2]).toMatchObject({
        returningCustomers: 2,
        activeMembers: 4,
        returningShare: 0.5,
        partial: false,
      });
      // February: C1, C3, C6 visited (C4's first instant is March). Only C1 had visited before February.
      expect(r.series[1]).toMatchObject({ returningCustomers: 1, activeMembers: 3 });
      // January: only C1's first visit, so nobody is returning.
      expect(r.series[0]).toMatchObject({ returningCustomers: 0, activeMembers: 1 });
    });

    it('starts April at local midnight: a visit at 21:00Z on March 31 belongs to April', async () => {
      const r = await ok('/monthly-returning-customers?month=2026-04&months=1');
      expect(r.series[0]).toMatchObject({
        month: '2026-04',
        activeMembers: 1,
        returningCustomers: 0,
      });
    });

    it('defaults to the current (partial) month', async () => {
      const r = await ok('/monthly-returning-customers');
      expect(r.series).toHaveLength(6);
      expect(r.series[5].partial).toBe(true);
    });

    it('follows the merchant’s configured time zone', async () => {
      await prisma.merchant.update({ where: { id: w.a.merchantId }, data: { timezone: 'UTC' } });
      try {
        const r = await ok('/monthly-returning-customers?month=2026-03&months=2');
        expect(r.timeZone).toBe('UTC');
        // In UTC, C4's first-instant visit is still February, and C5's is already March.
        expect(r.series[0]).toMatchObject({
          month: '2026-02',
          activeMembers: 4,
          returningCustomers: 1,
        });
        expect(r.series[1]).toMatchObject({
          month: '2026-03',
          activeMembers: 4,
          returningCustomers: 2,
        });
        const o = await ok('/overview?from=2026-03-01&to=2026-03-31');
        expect(o.range).toMatchObject({
          from: '2026-03-01T00:00:00.000Z',
          to: '2026-04-01T00:00:00.000Z',
        });
      } finally {
        await prisma.merchant.update({
          where: { id: w.a.merchantId },
          data: { timezone: 'Africa/Addis_Ababa' },
        });
      }
    });

    it('is isolated per merchant', async () => {
      const r = await ok('/monthly-returning-customers?month=2026-03&months=1', T.otherOwner);
      expect(r.value).toBe(0);
      expect(r.series[0]).toMatchObject({ activeMembers: 0, returningShare: null });
    });
  });

  describe('detail views', () => {
    it('lists branch activity, busiest first, with a stable cursor', async () => {
      const first = await ok(`/branches?${MARCH}&limit=1`);
      expect(first.items).toEqual([
        expect.objectContaining({
          branchId: w.a.branches[0],
          stamps: 3,
          uniqueCustomers: 3,
          redemptions: 1,
        }),
      ]);
      expect(first.nextCursor).toEqual(expect.any(String));
      const second = await ok(
        `/branches?${MARCH}&limit=1&cursor=${encodeURIComponent(first.nextCursor)}`,
      );
      expect(second.items).toEqual([
        expect.objectContaining({
          branchId: w.a.branches[1],
          stamps: 1,
          uniqueCustomers: 1,
          redemptions: 0,
        }),
      ]);
      expect(second.nextCursor).toBeNull();
    });

    it('lists staff stamping activity with reversal rates', async () => {
      const page = await ok(`/staff?${MARCH}&limit=100`);
      const byId = (id: string) => page.items.find((i: Json) => i.staffId === id);
      expect(byId(w.a.staff1.staffId)).toMatchObject({
        stamps: 3,
        stampsReversed: 1,
        reversalRate: 0.25,
        uniqueCustomers: 3,
        redemptions: 1,
      });
      expect(byId(w.a.staff2.staffId)).toMatchObject({
        stamps: 1,
        stampsReversed: 0,
        reversalRate: 0,
      });
      expect(byId(w.a.owner.staffId)).toMatchObject({ stamps: 0, reversalRate: null });
      // Every staff member of THIS merchant and nobody else.
      expect(page.items).toHaveLength(4);
      expect(page.items[0].staffId).toBe(w.a.staff1.staffId);
    });

    it('pages through staff without repeating anyone', async () => {
      const seen: string[] = [];
      let cursor = '';
      for (let i = 0; i < 6; i++) {
        const p = await ok(`/staff?${MARCH}&limit=1${cursor}`);
        seen.push(...p.items.map((x: Json) => x.staffId));
        if (!p.nextCursor) break;
        cursor = `&cursor=${encodeURIComponent(p.nextCursor)}`;
      }
      expect(seen).toHaveLength(4);
      expect(new Set(seen).size).toBe(4);
    });

    it('lists the returning customers behind the number, with first names only', async () => {
      const first = await ok(`/returning-customers?${MARCH}&limit=1`);
      expect(first.items[0]).toMatchObject({
        customerId: customers.C3,
        firstName: 'C3',
        visitsInRange: 1,
        lastVisitAt: '2026-03-31T20:59:59.999Z',
        previousVisitAt: '2026-02-28T20:59:59.999Z',
      });
      const second = await ok(
        `/returning-customers?${MARCH}&limit=1&cursor=${encodeURIComponent(first.nextCursor)}`,
      );
      expect(second.items[0]).toMatchObject({
        customerId: customers.C1,
        previousVisitAt: '2026-02-15T12:00:00.000Z',
      });
      expect(second.nextCursor).toBeNull();
      expect(JSON.stringify(first)).not.toMatch(/\+251|phone/i);
    });

    it('never shows another merchant’s branches, staff or customers', async () => {
      const branches = await ok(`/branches?${MARCH}&limit=100`, T.otherOwner);
      expect(branches.items.map((b: Json) => b.branchId).sort()).toEqual([...w.b.branches].sort());
      expect(branches.items.every((b: Json) => b.stamps === 0)).toBe(true);
      const staff = await ok(`/staff?${MARCH}&limit=100`, T.otherOwner);
      expect(staff.items.map((s: Json) => s.staffId)).not.toContain(w.a.staff1.staffId);
      expect((await ok(`/returning-customers?${MARCH}`, T.otherOwner)).items).toEqual([]);
    });
  });

  describe('retention cohorts', () => {
    it('shows the share of each join month that came back in later months', async () => {
      // Current month is later than 2026-10 minus 8 only if the test runs soon after the data; use enough cohorts.
      const now = new Date();
      const monthsSinceFeb = (now.getUTCFullYear() - 2026) * 12 + now.getUTCMonth() - 1;
      const res = await ok(`/cohorts?cohorts=${Math.min(24, monthsSinceFeb + 1)}`);
      const c = (m: string) => res.cohorts.find((x: Json) => x.cohortMonth === m);
      // February cohort: C3 and C6 (C1 joined in January). Both visited in February; only C3 in March.
      expect(c('2026-02').size).toBe(2);
      expect(c('2026-02').retention[0]).toEqual({ monthOffset: 0, retained: 2, rate: 1 });
      expect(c('2026-02').retention[1]).toEqual({ monthOffset: 1, retained: 1, rate: 0.5 });
      // March cohort: C2 and C4 both visited in March, nobody in April.
      expect(c('2026-03').size).toBe(2);
      expect(c('2026-03').retention[0]).toMatchObject({ retained: 2, rate: 1 });
      expect(c('2026-03').retention[1]).toMatchObject({ retained: 0, rate: 0 });
      // April cohort: C5 joined and visited at the first instant of local April.
      expect(c('2026-04').size).toBe(1);
      expect(c('2026-04').retention[0]).toMatchObject({ retained: 1, rate: 1 });
    });

    it('gives empty months a null rate and never reports future months', async () => {
      const res = await ok('/cohorts?cohorts=3');
      for (const cohort of res.cohorts) {
        expect(cohort.size).toBe(0);
        expect(cohort.retention.every((r: Json) => r.rate === null && r.retained === 0)).toBe(true);
      }
      // The newest cohort only has its own month so far.
      expect(res.cohorts[2].retention).toHaveLength(1);
    });
  });

  describe('wallet', () => {
    it('reports adoption per provider and the update success rate', async () => {
      const wal = await ok('/wallet');
      expect(wal.activeMemberships).toBe(6);
      const p = (name: string) => wal.providers.find((x: Json) => x.provider === name);
      expect(p('WEB')).toEqual({ provider: 'WEB', memberships: 2, adoptionRate: 0.3333 });
      expect(p('GOOGLE')).toEqual({ provider: 'GOOGLE', memberships: 1, adoptionRate: 0.1667 });
      expect(p('APPLE')).toEqual({ provider: 'APPLE', memberships: 0, adoptionRate: 0 });
      expect(wal.updates).toEqual({
        succeeded: 3,
        failed: 1,
        stillQueued: 1,
        succeededAfterRetry: 1,
        successRate: 0.75,
      });
    });

    it('has no success rate before any update finished', async () => {
      const wal = await ok('/wallet', T.otherOwner);
      expect(wal.updates).toMatchObject({ succeeded: 0, failed: 0, successRate: null });
      expect(wal.activeMemberships).toBe(0);
    });
  });

  describe('validation', () => {
    it.each([
      '/overview?from=nonsense',
      '/overview?from=2026-04-01&to=2026-03-01',
      '/overview?from=2024-01-01&to=2026-01-01',
      '/overview?programId=not-a-uuid',
      '/monthly-returning-customers?month=2026-13',
      '/monthly-returning-customers?month=2999-01',
      '/monthly-returning-customers?months=0',
      '/monthly-returning-customers?months=25',
      '/cohorts?cohorts=0',
      '/cohorts?cohorts=25',
      '/branches?limit=0',
      '/branches?limit=101',
      '/branches?cursor=garbage',
      '/staff?cursor=garbage',
      '/returning-customers?cursor=garbage',
    ])('rejects %s', async (path) => {
      await get(path, T.owner).expect(400);
    });
  });
});

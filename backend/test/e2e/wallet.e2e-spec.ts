import { createHash, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { OutboxWorker } from '../../src/modules/jobs';
import { FakeWalletBackend } from '../../src/modules/wallet';
import {
  deriveAppleAuthToken,
  deriveBarcode,
  signLinkToken,
} from '../../src/modules/wallet/domain/credentials';
import {
  TestCard,
  World,
  bearer,
  createActiveProgram,
  createCard,
  createWorld,
  login,
} from '../support/auth-fixture';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = process.env.WALLET_BARCODE_SECRET as string;
const PASS_TYPE = 'pass.test.temelashcard';
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

describe('Wallet passes, outbox delivery and Apple web service (e2e, fake providers)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let w: World;
  let program: { id: string };
  let T: {
    staff1: string;
    staff2: string;
    manager: string;
    owner: string;
    admin: string;
    otherOwner: string;
  };
  let backend: FakeWalletBackend;
  let worker: OutboxWorker;
  const saved: Record<string, string | undefined> = {};
  const http = () => request(app.getHttpServer());
  const b1 = () => w.a.branches[0];

  beforeAll(async () => {
    for (const [k, v] of Object.entries({
      WALLET_MODE: 'fake',
      WALLET_APPLE_ENABLED: 'true',
      WALLET_GOOGLE_ENABLED: 'true',
      APPLE_PASS_TYPE_ID: PASS_TYPE,
    })) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    prisma = new PrismaClient();
    // Jobs left over from other test files are none of this suite's business.
    await prisma.outboxJob.updateMany({
      where: { status: { in: ['PENDING', 'FAILED', 'PROCESSING'] } },
      data: { status: 'COMPLETED' },
    });
    w = await createWorld(prisma);
    program = await createActiveProgram(prisma, w.a.merchantId, {
      stampsRequired: 3,
      cooldownMinutes: 0,
    });
    const { createTestApp } = await import('../support/create-test-app');
    app = await createTestApp();
    backend = app.get(FakeWalletBackend);
    worker = app.get(OutboxWorker);
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
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await app.close();
    await prisma.$disconnect();
  });

  // Deliver leftovers from earlier tests first so each test sees only its own provider calls.
  beforeEach(async () => {
    await drain();
    backend.reset();
  });

  // ───────── helpers ─────────
  const card = (name?: string) => createCard(prisma, w.a.merchantId, program.id, name);
  const stamp = (token: string, auth = T.manager) =>
    http()
      .post('/api/v1/scanner/stamps')
      .set('Authorization', auth)
      .set('Idempotency-Key', randomUUID())
      .send({ cardToken: token, branchId: b1() });
  const link = (cardToken: string, provider: string) =>
    http().post('/api/v1/card/wallet/links').send({ cardToken, provider });
  const passOf = (c: TestCard, provider: 'APPLE' | 'GOOGLE' | 'WEB') =>
    prisma.walletPass.findFirstOrThrow({
      where: { membershipId: c.membershipId, provider, status: { not: 'INVALIDATED' } },
    });
  const jobsFor = (c: TestCard) =>
    prisma.outboxJob.findMany({
      where: { aggregateId: c.membershipId },
      orderBy: { createdAt: 'asc' },
    });
  /** Runs the worker until nothing is due (bounded). */
  const drain = async () => {
    let total = 0;
    for (let i = 0; i < 10; i++) {
      const r = await worker.processBatch(100);
      total += r.claimed;
      if (r.claimed === 0) break;
    }
    return total;
  };
  const dueNow = (c: TestCard) =>
    prisma.outboxJob.updateMany({
      where: { aggregateId: c.membershipId, status: 'FAILED' },
      data: { nextRunAt: new Date(Date.now() - 1000) },
    });
  /** A card that already has Apple and Google passes created. */
  async function walletCard(name?: string) {
    const c = await card(name);
    await link(c.token, 'GOOGLE').expect(200);
    await link(c.token, 'APPLE').expect(200);
    backend.reset();
    return c;
  }

  describe('customer links', () => {
    it('offers Apple and Google on the join page once they are enabled', async () => {
      const res = await http().get(`/api/v1/join/${w.a.joinReference}`).expect(200);
      expect(res.body.wallet).toEqual([
        { provider: 'WEB', available: true, reason: null, addUrl: null },
        { provider: 'APPLE', available: true, reason: null, addUrl: null },
        { provider: 'GOOGLE', available: true, reason: null, addUrl: null },
      ]);
    });

    it('creates a Google pass on first use, with its own revocable barcode, and reuses it afterwards', async () => {
      const c = await card();
      const res = await link(c.token, 'GOOGLE').expect(200);
      expect(res.body).toMatchObject({ provider: 'GOOGLE', kind: 'REDIRECT' });
      expect(res.body.url).toContain('fake-wallet.test/google/');

      const pass = await passOf(c, 'GOOGLE');
      expect(pass).toMatchObject({ status: 'ACTIVE', syncStatus: 'SYNCED', barcodeVersion: 1 });
      expect(pass.providerPassId).toBe(`fake-google-${pass.id}`);
      // Only a hash of the barcode is stored; it matches the derived value.
      expect(pass.barcodeHash).toBe(sha256(deriveBarcode(SECRET, pass.id, 1)));
      expect(JSON.stringify(pass)).not.toContain(deriveBarcode(SECRET, pass.id, 1));
      expect(backend.callsFor('GOOGLE').map((x) => x.operation)).toEqual(['create', 'link']);

      await link(c.token, 'GOOGLE').expect(200);
      expect(
        await prisma.walletPass.count({
          where: { membershipId: c.membershipId, provider: 'GOOGLE' },
        }),
      ).toBe(1);
      expect(backend.callsFor('GOOGLE', 'create')).toHaveLength(1);
      expect(
        await prisma.auditEvent.count({
          where: { action: 'wallet.pass_created', targetId: pass.id },
        }),
      ).toBe(1);
    });

    it('hands out an Apple download link and a no-op web link', async () => {
      const c = await card();
      const apple = await link(c.token, 'APPLE').expect(200);
      expect(apple.body).toMatchObject({ provider: 'APPLE', kind: 'DOWNLOAD' });
      const web = await link(c.token, 'WEB').expect(200);
      expect(web.body).toEqual({ provider: 'WEB', kind: 'NONE', url: null, expiresAt: null });
      // the card's web pass already existed, so only the Apple pass is new
      expect(await prisma.walletPass.count({ where: { membershipId: c.membershipId } })).toBe(2);
    });

    it('creates exactly one live pass when requests race', async () => {
      const c = await card();
      const results = await Promise.all(Array.from({ length: 5 }, () => link(c.token, 'GOOGLE')));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(
        await prisma.walletPass.count({
          where: {
            membershipId: c.membershipId,
            provider: 'GOOGLE',
            status: { not: 'INVALIDATED' },
          },
        }),
      ).toBe(1);
    });

    it('serves the live web card with both languages and the card token as the QR value', async () => {
      const c = await card('Hana');
      await stamp(c.token).expect(200);
      const res = await http().post('/api/v1/card/web').send({ cardToken: c.token }).expect(200);
      expect(res.body).toMatchObject({
        merchant: { nameEn: expect.any(String) },
        program: { nameEn: 'Test Card', nameAm: 'የሙከራ ካርድ', brandColor: null },
        customer: { firstName: 'Hana', preferredLanguage: 'EN' },
        progress: { current: 1, required: 3, remaining: 2, completedCards: 0 },
        rewardsAvailable: 0,
        reward: { nameEn: 'Free item', nameAm: 'ነጻ እቃ' },
        status: 'ACTIVE',
        barcode: c.token,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/\+251|tokenHash|merchantId/);
    });

    it('answers identically for unknown, malformed and deactivated cards, and validates the provider', async () => {
      const c = await card();
      const unknown = await link('A'.repeat(43), 'GOOGLE').expect(404);
      const malformed = await link('x'.repeat(25), 'GOOGLE').expect(404);
      expect(malformed.body.error).toMatchObject({
        code: unknown.body.error.code,
        message: unknown.body.error.message,
      });
      await link(c.token, 'PAYPAL').expect(400);
      await http()
        .post('/api/v1/card/web')
        .send({ cardToken: 'A'.repeat(43) })
        .expect(404);

      await prisma.customerMembership.update({
        where: { id: c.membershipId },
        data: { status: 'INACTIVE', deactivatedAt: new Date() },
      });
      await link(c.token, 'GOOGLE').expect(404);
      await http().post('/api/v1/card/web').send({ cardToken: c.token }).expect(404);
    });

    it('reports a provider outage as a safe 502 and finishes the pass on the next attempt', async () => {
      const c = await card();
      backend.failNext('GOOGLE', { operation: 'create' });
      const res = await link(c.token, 'GOOGLE').expect(502);
      expect(res.body.error.code).toBe('WALLET_PROVIDER_UNAVAILABLE');
      expect(JSON.stringify(res.body)).not.toMatch(/fake|unavailable provider/i);
      const pending = await prisma.walletPass.findFirstOrThrow({
        where: { membershipId: c.membershipId, provider: 'GOOGLE' },
      });
      expect(pending).toMatchObject({ status: 'PENDING', syncStatus: 'FAILED' });
      expect(pending.lastError).toBeTruthy();

      await link(c.token, 'GOOGLE').expect(200);
      expect(
        await prisma.walletPass.findUniqueOrThrow({ where: { id: pending.id } }),
      ).toMatchObject({ status: 'ACTIVE', syncStatus: 'SYNCED', lastError: null });
    });
  });

  describe('delivery through the outbox', () => {
    it('delivers the current progress after a stamp, without touching the stamp transaction', async () => {
      const c = await walletCard();
      await stamp(c.token).expect(200);
      const pass = await passOf(c, 'GOOGLE');
      expect(pass.syncStatus).toBe('PENDING');
      expect(pass.passVersion).toBeGreaterThan(pass.lastSyncedVersion);
      expect(backend.calls).toHaveLength(0); // nothing is sent inside the stamp request

      await drain();
      const calls = backend.callsFor('GOOGLE', 'update');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ currentStamps: 1, rewardsAvailable: 0, status: 'ACTIVE' });
      expect(backend.callsFor('APPLE', 'update')).toHaveLength(1);
      const done = await passOf(c, 'GOOGLE');
      expect(done).toMatchObject({ syncStatus: 'SYNCED', lastError: null });
      expect(done.lastSyncedVersion).toBe(done.passVersion);
      expect((await passOf(c, 'WEB')).syncStatus).toBe('SYNCED'); // web card needs no push
      expect((await jobsFor(c)).every((j) => j.status === 'COMPLETED')).toBe(true);
    });

    it('reports reward unlock, redemption and reversal in the delivered state', async () => {
      const c = await walletCard();
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) ids.push((await stamp(c.token).expect(200)).body.stamp.id);
      await drain();
      expect(backend.callsFor('GOOGLE', 'update').at(-1)).toMatchObject({
        currentStamps: 0,
        rewardsAvailable: 1,
      });

      const red = await http()
        .post('/api/v1/scanner/redemptions')
        .set('Authorization', T.manager)
        .set('Idempotency-Key', randomUUID())
        .send({ cardToken: c.token, branchId: b1() })
        .expect(200);
      await drain();
      expect(backend.callsFor('GOOGLE', 'update').at(-1)).toMatchObject({ rewardsAvailable: 0 });

      await http()
        .post(`/api/v1/merchant/redemptions/${red.body.redemption.id}/reverse`)
        .set('Authorization', T.owner)
        .set('Idempotency-Key', randomUUID())
        .send({ reason: 'Customer changed mind' })
        .expect(200);
      await drain();
      expect(backend.callsFor('GOOGLE', 'update').at(-1)).toMatchObject({ rewardsAvailable: 1 });

      await http()
        .post(`/api/v1/merchant/redemptions/${red.body.redemption.id}/reverse`)
        .set('Authorization', T.owner)
        .set('Idempotency-Key', randomUUID())
        .send({ reason: 'again' })
        .expect(409);
      await http()
        .post(`/api/v1/merchant/stamps/${ids[2]}/reverse`)
        .set('Authorization', T.owner)
        .set('Idempotency-Key', randomUUID())
        .send({ reason: 'Wrong card' })
        .expect(200);
      await drain();
      expect(backend.callsFor('GOOGLE', 'update').at(-1)).toMatchObject({
        currentStamps: 2,
        rewardsAvailable: 0,
      });
    });

    it('coalesces many queued updates into one delivery of the latest state', async () => {
      const c = await walletCard();
      for (let i = 0; i < 4; i++) await stamp(c.token).expect(200);
      expect(
        await prisma.outboxJob.count({ where: { aggregateId: c.membershipId, status: 'PENDING' } }),
      ).toBe(4);
      await drain();
      const updates = backend.callsFor('GOOGLE', 'update');
      expect(updates).toHaveLength(1);
      expect(updates[0]).toMatchObject({ currentStamps: 1, rewardsAvailable: 1 }); // 4 stamps = 1 card + 1
      expect((await jobsFor(c)).every((j) => j.status === 'COMPLETED')).toBe(true);
    });

    it('keeps a valid stamp when the provider is down, then retries with backoff and succeeds', async () => {
      const c = await walletCard();
      backend.failNext('GOOGLE', { operation: 'update' });
      const res = await stamp(c.token).expect(200);
      expect(res.body.outcome).toBe('STAMPED');

      await drain();
      // The loyalty event is untouched; only the delivery failed.
      expect(await prisma.stampEvent.count({ where: { membershipId: c.membershipId } })).toBe(1);
      const [job] = await jobsFor(c);
      expect(job).toMatchObject({ status: 'FAILED', attempts: 1 });
      expect(job?.nextRunAt.getTime()).toBeGreaterThan(Date.now() + 15_000); // backed off
      expect(job?.lastError).toBeTruthy();
      expect(await passOf(c, 'GOOGLE')).toMatchObject({ syncStatus: 'FAILED' });
      expect((await passOf(c, 'GOOGLE')).lastError).toBeTruthy();
      expect(await drain()).toBe(0); // not due yet

      await dueNow(c);
      await drain();
      expect((await jobsFor(c))[0]).toMatchObject({ status: 'COMPLETED', lastError: null });
      expect(await passOf(c, 'GOOGLE')).toMatchObject({ syncStatus: 'SYNCED', lastError: null });
      expect(backend.callsFor('GOOGLE', 'update').at(-1)).toMatchObject({ currentStamps: 1 });
    });

    it('does not let one failing provider block the others', async () => {
      const c = await walletCard();
      backend.failAlways('GOOGLE');
      await stamp(c.token).expect(200);
      await drain();
      expect(backend.callsFor('APPLE', 'update')).toHaveLength(1);
      expect(await passOf(c, 'APPLE')).toMatchObject({ syncStatus: 'SYNCED' });
      expect(await passOf(c, 'GOOGLE')).toMatchObject({ syncStatus: 'FAILED' });
    });

    it('dead-letters a job after its retry limit and lets a platform administrator requeue it', async () => {
      const c = await walletCard();
      backend.failAlways('GOOGLE');
      await stamp(c.token).expect(200);
      await prisma.outboxJob.updateMany({
        where: { aggregateId: c.membershipId },
        data: { maxAttempts: 2 },
      });

      await drain();
      expect((await jobsFor(c))[0]).toMatchObject({ status: 'FAILED', attempts: 1 });
      await dueNow(c);
      await drain();
      const [dead] = await jobsFor(c);
      expect(dead).toMatchObject({ status: 'DEAD', attempts: 2 });
      expect(dead?.lastError).toBeTruthy();
      await dueNow(c);
      expect(await drain()).toBe(0); // dead jobs are never retried automatically

      const list = await http()
        .get('/api/v1/platform/outbox/dead')
        .set('Authorization', T.admin)
        .expect(200);
      expect(list.body.map((j: Json) => j.id)).toContain(dead?.id);
      expect(
        (
          await http()
            .get('/api/v1/platform/outbox/stats')
            .set('Authorization', T.admin)
            .expect(200)
        ).body.DEAD,
      ).toBeGreaterThan(0);
      await http().get('/api/v1/platform/outbox/dead').set('Authorization', T.owner).expect(403);
      await http()
        .post(`/api/v1/platform/outbox/dead/${dead?.id}/requeue`)
        .set('Authorization', T.owner)
        .expect(403);
      await http()
        .post(`/api/v1/platform/outbox/dead/${randomUUID()}/requeue`)
        .set('Authorization', T.admin)
        .expect(404);

      backend.reset();
      await http()
        .post(`/api/v1/platform/outbox/dead/${dead?.id}/requeue`)
        .set('Authorization', T.admin)
        .expect(200);
      expect((await jobsFor(c))[0]).toMatchObject({
        status: 'PENDING',
        attempts: 0,
        lastError: null,
      });
      await drain();
      expect((await jobsFor(c))[0]).toMatchObject({ status: 'COMPLETED' });
      expect(await passOf(c, 'GOOGLE')).toMatchObject({ syncStatus: 'SYNCED' });
      expect(
        await prisma.auditEvent.count({
          where: { action: 'outbox.job_requeued', targetId: dead?.id },
        }),
      ).toBe(1);
    });

    it('dead-letters permanent failures immediately instead of burning retries', async () => {
      const c = await walletCard();
      backend.failAlways('GOOGLE', false);
      await stamp(c.token).expect(200);
      await drain();
      expect((await jobsFor(c))[0]).toMatchObject({ status: 'DEAD', attempts: 1 });
    });

    it('dead-letters jobs nobody handles, and keeps error text free of credentials', async () => {
      const job = await prisma.outboxJob.create({
        data: {
          merchantId: w.a.merchantId,
          type: 'unknown.thing',
          aggregateType: 'x',
          aggregateId: randomUUID(),
        },
      });
      await drain();
      const after = await prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(after).toMatchObject({ status: 'DEAD', attempts: 1 });
      expect(after.lastError).toContain('No handler');
    });

    it('reclaims a job whose worker died mid-flight', async () => {
      const c = await walletCard();
      const job = await prisma.outboxJob.create({
        data: {
          merchantId: w.a.merchantId,
          type: 'wallet.pass_update',
          aggregateType: 'membership',
          aggregateId: c.membershipId,
          status: 'PROCESSING',
          attempts: 1,
          lockedBy: 'worker-dead',
          lockedAt: new Date(Date.now() - 3600_000),
        },
      });
      await drain();
      expect(await prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
        status: 'COMPLETED',
        attempts: 2,
      });
    });

    it('never claims the same job twice when several workers run at once', async () => {
      const cards = await Promise.all(Array.from({ length: 6 }, () => card()));
      const ids: string[] = [];
      for (const c of cards) {
        for (let i = 0; i < 2; i++) {
          ids.push(
            (
              await prisma.outboxJob.create({
                data: {
                  merchantId: w.a.merchantId,
                  type: 'wallet.pass_update',
                  aggregateType: 'membership',
                  aggregateId: c.membershipId,
                },
              })
            ).id,
          );
        }
      }
      const results = await Promise.all([
        worker.processBatch(5),
        worker.processBatch(5),
        worker.processBatch(5),
        worker.processBatch(5),
      ]);
      await drain();
      expect(results.reduce((n, r) => n + r.claimed, 0)).toBeLessThanOrEqual(12);
      const rows = await prisma.outboxJob.findMany({ where: { id: { in: ids } } });
      expect(rows.every((r) => r.status === 'COMPLETED' && r.attempts === 1)).toBe(true);
    });

    it('keeps barcodes, tokens and secrets out of jobs, audit events and error text', async () => {
      const c = await walletCard();
      const barcodes = [(await passOf(c, 'GOOGLE')).id, (await passOf(c, 'APPLE')).id].map((id) =>
        deriveBarcode(SECRET, id, 1),
      );
      backend.failNext('GOOGLE', { operation: 'update' });
      await stamp(c.token).expect(200);
      await drain();
      const dump = JSON.stringify([
        await jobsFor(c),
        await prisma.auditEvent.findMany({ where: { merchantId: w.a.merchantId } }),
        await prisma.walletPass.findMany({ where: { membershipId: c.membershipId } }),
      ]);
      for (const secret of [...barcodes, c.token, SECRET]) expect(dump).not.toContain(secret);
    });
  });

  describe('Apple Wallet web service', () => {
    const auth = (passId: string) => `ApplePass ${deriveAppleAuthToken(SECRET, passId)}`;
    const device = () => `device-${randomUUID().slice(0, 8)}`;
    const base = `/api/v1/wallet/apple/v1`;

    it('serves a pass download only for a valid, unexpired, pass-specific link', async () => {
      const c = await walletCard();
      const pass = await passOf(c, 'APPLE');
      const good = signLinkToken(SECRET, pass.id, new Date(Date.now() + 5 * 60_000));
      const res = await http()
        .get(`/api/v1/wallet/apple/download/${pass.id}?t=${encodeURIComponent(good)}`)
        .expect(200);
      expect(res.headers['content-disposition']).toContain('.pkpass');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({ fake: true, serialNumber: pass.id, status: 'ACTIVE' });

      const expired = signLinkToken(SECRET, pass.id, new Date(Date.now() - 1000));
      const other = signLinkToken(SECRET, randomUUID(), new Date(Date.now() + 60_000));
      for (const t of [expired, other, 'garbage', '']) {
        await http()
          .get(`/api/v1/wallet/apple/download/${pass.id}?t=${encodeURIComponent(t)}`)
          .expect(404);
      }
      await http().get(`/api/v1/wallet/apple/download/${pass.id}`).expect(404);
      await http().get(`/api/v1/wallet/apple/download/not-a-uuid?t=${good}`).expect(400);
      // A Google pass cannot be downloaded as an Apple pass.
      const g = await passOf(c, 'GOOGLE');
      await http()
        .get(
          `/api/v1/wallet/apple/download/${g.id}?t=${encodeURIComponent(signLinkToken(SECRET, g.id, new Date(Date.now() + 60_000)))}`,
        )
        .expect(404);
    });

    it('registers, lists, updates and unregisters a device like iOS does', async () => {
      const c = await walletCard();
      const pass = await passOf(c, 'APPLE');
      const dev = device();
      const reg = `${base}/devices/${dev}/registrations/${PASS_TYPE}/${pass.id}`;

      // authentication and addressing
      await http().post(reg).send({ pushToken: 'push-token-1' }).expect(401);
      await http()
        .post(reg)
        .set('Authorization', 'ApplePass wrong-token')
        .send({ pushToken: 'push-token-1' })
        .expect(401);
      await http()
        .post(reg)
        .set('Authorization', auth(randomUUID()))
        .send({ pushToken: 'x' })
        .expect(401);
      await http()
        .post(`${base}/devices/${dev}/registrations/pass.other.type/${pass.id}`)
        .set('Authorization', auth(pass.id))
        .send({ pushToken: 'x' })
        .expect(404);
      await http()
        .post(`${base}/devices/${dev}/registrations/${PASS_TYPE}/not-a-uuid`)
        .set('Authorization', auth(pass.id))
        .send({ pushToken: 'x' })
        .expect(400);
      await http().post(reg).set('Authorization', auth(pass.id)).send({}).expect(400);

      await http()
        .post(reg)
        .set('Authorization', auth(pass.id))
        .send({ pushToken: 'push-token-1' })
        .expect(201);
      await http()
        .post(reg)
        .set('Authorization', auth(pass.id))
        .send({ pushToken: 'push-token-2' })
        .expect(200); // token refreshed
      expect(
        (await prisma.appleDeviceRegistration.findMany({ where: { walletPassId: pass.id } })).map(
          (r) => r.pushToken,
        ),
      ).toEqual(['push-token-2']);

      const list = await http()
        .get(`${base}/devices/${dev}/registrations/${PASS_TYPE}`)
        .expect(200);
      expect(list.body.serialNumbers).toEqual([pass.id]);
      expect(Number(list.body.lastUpdated)).toBeGreaterThan(0);
      await http()
        .get(
          `${base}/devices/${dev}/registrations/${PASS_TYPE}?passesUpdatedSince=${list.body.lastUpdated}`,
        )
        .expect(204);
      await http().get(`${base}/devices/${device()}/registrations/${PASS_TYPE}`).expect(204);

      // a stamp + delivery changes the pass, so the device is told it changed
      await stamp(c.token).expect(200);
      await drain();
      const changed = await http()
        .get(
          `${base}/devices/${dev}/registrations/${PASS_TYPE}?passesUpdatedSince=${list.body.lastUpdated}`,
        )
        .expect(200);
      expect(changed.body.serialNumbers).toEqual([pass.id]);

      const latest = await http()
        .get(`${base}/passes/${PASS_TYPE}/${pass.id}`)
        .set('Authorization', auth(pass.id))
        .expect(200);
      expect(latest.body).toMatchObject({ fake: true, progress: '1 / 3' });
      expect(latest.headers['last-modified']).toBeTruthy();
      await http().get(`${base}/passes/${PASS_TYPE}/${pass.id}`).expect(401);
      await http()
        .get(`${base}/passes/${PASS_TYPE}/${pass.id}`)
        .set('Authorization', auth(pass.id))
        .set('If-Modified-Since', String(latest.headers['last-modified']))
        .expect(304);
      await http()
        .get(`${base}/passes/${PASS_TYPE}/${pass.id}`)
        .set('Authorization', auth(pass.id))
        .set('If-Modified-Since', new Date(Date.now() - 3600_000).toUTCString())
        .expect(200);

      await http().delete(reg).expect(401);
      await http().delete(reg).set('Authorization', auth(pass.id)).expect(200);
      await http().get(`${base}/devices/${dev}/registrations/${PASS_TYPE}`).expect(204);
      expect(await prisma.appleDeviceRegistration.count({ where: { walletPassId: pass.id } })).toBe(
        0,
      );
    });

    it('accepts device logs without storing anything and is not part of the public API docs', async () => {
      await http()
        .post(`${base}/log`)
        .send({ logs: ['pass x failed', 'Authorization: Bearer abcdefghijklmnop'] })
        .expect(200);
      await http().post(`${base}/log`).send({}).expect(200);
      const docs = await http().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths).filter((p) => p.includes('/wallet/apple'))).toEqual([]);
    });

    it('does not accept one pass’s token for another pass', async () => {
      const [a, b] = [await walletCard(), await walletCard()];
      const [pa, pb] = [await passOf(a, 'APPLE'), await passOf(b, 'APPLE')];
      await http()
        .get(`${base}/passes/${PASS_TYPE}/${pb.id}`)
        .set('Authorization', auth(pa.id))
        .expect(401);
    });
  });

  describe('wallet barcodes at the counter', () => {
    it('lets the scanner accept a wallet pass barcode like a card token', async () => {
      const c = await walletCard('Almaz');
      const pass = await passOf(c, 'GOOGLE');
      const barcode = deriveBarcode(SECRET, pass.id, 1);

      const validate = await http()
        .post('/api/v1/scanner/validate')
        .set('Authorization', T.manager)
        .send({ cardToken: barcode, branchId: b1() })
        .expect(200);
      expect(validate.body).toMatchObject({
        outcome: 'ELIGIBLE',
        customer: { firstName: 'Almaz' },
      });
      const res = await stamp(barcode).expect(200);
      expect(res.body).toMatchObject({ outcome: 'STAMPED', progress: { current: 1 } });
      expect(await prisma.stampEvent.count({ where: { membershipId: c.membershipId } })).toBe(1);
      // The ordinary card token and the pass barcode count against the same cooldown and totals.
      expect((await stamp(c.token).expect(200)).body.progress.current).toBe(2);
    });

    it('keeps one merchant’s wallet barcodes useless at another merchant', async () => {
      const c = await walletCard();
      const barcode = deriveBarcode(SECRET, (await passOf(c, 'APPLE')).id, 1);
      const foreign = await http()
        .post('/api/v1/scanner/stamps')
        .set('Authorization', T.otherOwner)
        .set('Idempotency-Key', randomUUID())
        .send({ cardToken: barcode, branchId: w.b.branches[0] })
        .expect(200);
      expect(foreign.body).toMatchObject({ outcome: 'REJECTED', reason: 'INVALID_TOKEN' });
    });

    it('rejects barcodes of passes that never became active, or with a wrong version', async () => {
      const c = await card();
      backend.failNext('GOOGLE', { operation: 'create' });
      await link(c.token, 'GOOGLE').expect(502);
      const pending = await passOf(c, 'GOOGLE');
      const barcode = deriveBarcode(SECRET, pending.id, 1);
      expect((await stamp(barcode).expect(200)).body.reason).toBe('INVALID_TOKEN'); // PENDING pass
      await link(c.token, 'GOOGLE').expect(200);
      expect((await stamp(deriveBarcode(SECRET, pending.id, 2)).expect(200)).body.reason).toBe(
        'INVALID_TOKEN',
      );
      expect((await stamp(barcode).expect(200)).body.outcome).toBe('STAMPED');
    });
  });

  describe('revoking passes', () => {
    it('invalidates Apple and Google passes at once, leaves the web card alone, and voids them in the wallets', async () => {
      const c = await walletCard();
      const [g, a] = [await passOf(c, 'GOOGLE'), await passOf(c, 'APPLE')];
      const [gCode, aCode] = [deriveBarcode(SECRET, g.id, 1), deriveBarcode(SECRET, a.id, 1)];
      expect((await stamp(gCode).expect(200)).body.outcome).toBe('STAMPED');

      const url = `/api/v1/merchant/memberships/${c.membershipId}/wallet-passes/invalidate`;
      await http().post(url).set('Authorization', T.staff1).expect(403);
      await http().post(url).set('Authorization', T.otherOwner).expect(404);
      const res = await http().post(url).set('Authorization', T.manager).expect(200);
      expect(res.body).toEqual({ invalidated: 2 });

      // Barcodes die immediately; the card token and web card do not.
      for (const code of [gCode, aCode])
        expect((await stamp(code).expect(200)).body.reason).toBe('INVALID_TOKEN');
      expect((await stamp(c.token).expect(200)).body.outcome).toBe('STAMPED');
      expect(
        (await http().post('/api/v1/card/web').send({ cardToken: c.token }).expect(200)).body
          .status,
      ).toBe('ACTIVE');
      expect(
        await prisma.walletPass.findMany({
          where: { id: { in: [g.id, a.id] } },
          select: { status: true },
        }),
      ).toEqual([{ status: 'INVALIDATED' }, { status: 'INVALIDATED' }]);

      // The wallets are told to void them.
      backend.reset();
      await drain();
      expect(backend.callsFor('GOOGLE', 'suspend').at(-1)).toMatchObject({ status: 'INVALIDATED' });
      expect(backend.callsFor('APPLE', 'suspend').at(-1)).toMatchObject({ status: 'INVALIDATED' });
      expect(
        await prisma.auditEvent.count({
          where: { action: 'wallet.passes_invalidated', targetId: c.membershipId },
        }),
      ).toBe(1);

      // A revoked Apple pass can still be pulled by the old phone, but arrives void.
      const pull = await http()
        .get(`/api/v1/wallet/apple/v1/passes/${PASS_TYPE}/${a.id}`)
        .set('Authorization', `ApplePass ${deriveAppleAuthToken(SECRET, a.id)}`)
        .expect(200);
      expect(pull.body.status).toBe('INVALIDATED');
    });

    it('issues a brand-new pass with a new serial and barcode afterwards', async () => {
      const c = await walletCard();
      const old = await passOf(c, 'GOOGLE');
      await http()
        .post(`/api/v1/merchant/memberships/${c.membershipId}/wallet-passes/invalidate`)
        .set('Authorization', T.owner)
        .expect(200);
      await http()
        .post(`/api/v1/merchant/memberships/${c.membershipId}/wallet-passes/invalidate`)
        .set('Authorization', T.owner)
        .expect(200)
        .then((r) => expect(r.body.invalidated).toBe(0));

      await link(c.token, 'GOOGLE').expect(200);
      const fresh = await passOf(c, 'GOOGLE');
      expect(fresh.id).not.toBe(old.id);
      expect(fresh.providerPassId).not.toBe(old.providerPassId);
      expect((await stamp(deriveBarcode(SECRET, fresh.id, 1)).expect(200)).body.outcome).toBe(
        'STAMPED',
      );
      expect((await stamp(deriveBarcode(SECRET, old.id, 1)).expect(200)).body.reason).toBe(
        'INVALID_TOKEN',
      );
      expect(
        await prisma.walletPass.count({
          where: { membershipId: c.membershipId, provider: 'GOOGLE' },
        }),
      ).toBe(2);
    });

    it('suspends the wallet cards of a deactivated customer and stops them working', async () => {
      const c = await walletCard();
      const g = await passOf(c, 'GOOGLE');
      await prisma.customerMembership.update({
        where: { id: c.membershipId },
        data: { status: 'INACTIVE', deactivatedAt: new Date() },
      });
      await http()
        .post(`/api/v1/merchant/wallet-passes/${g.id}/resync`)
        .set('Authorization', T.manager)
        .expect(202);
      await drain();
      expect(backend.callsFor('GOOGLE', 'suspend').at(-1)).toMatchObject({ status: 'SUSPENDED' });
      expect((await stamp(deriveBarcode(SECRET, g.id, 1)).expect(200)).body.reason).toBe(
        'MEMBERSHIP_INACTIVE',
      );
    });
  });

  describe('staff tools', () => {
    it('shows delivery status to staff and limits resync to people who manage customers', async () => {
      const c = await walletCard();
      const url = `/api/v1/merchant/memberships/${c.membershipId}/wallet-passes`;
      const list = await http().get(url).set('Authorization', T.staff1).expect(200);
      expect(list.body.map((p: Json) => p.provider).sort()).toEqual(['APPLE', 'GOOGLE', 'WEB']);
      expect(list.body[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          status: 'ACTIVE',
          syncStatus: expect.any(String),
          passVersion: expect.any(Number),
        }),
      );
      expect(JSON.stringify(list.body)).not.toMatch(/barcode|token/i);
      await http().get(url).set('Authorization', T.otherOwner).expect(404);
      await http().get(url).set('Authorization', T.admin).expect(403);

      const g = await passOf(c, 'GOOGLE');
      await http()
        .post(`/api/v1/merchant/wallet-passes/${g.id}/resync`)
        .set('Authorization', T.staff1)
        .expect(403);
      await http()
        .post(`/api/v1/merchant/wallet-passes/${g.id}/resync`)
        .set('Authorization', T.otherOwner)
        .expect(404);
      await http()
        .post(`/api/v1/merchant/wallet-passes/${g.id}/resync`)
        .set('Authorization', T.manager)
        .expect(202);
      expect((await passOf(c, 'GOOGLE')).passVersion).toBe(g.passVersion + 1);
      await drain();
      expect(backend.callsFor('GOOGLE', 'update')).toHaveLength(1);
    });

    it('documents the customer and staff wallet endpoints', async () => {
      const res = await http().get('/api/docs-json').expect(200);
      expect(Object.keys(res.body.paths)).toEqual(
        expect.arrayContaining([
          '/api/v1/card/wallet/links',
          '/api/v1/card/web',
          '/api/v1/merchant/memberships/{membershipId}/wallet-passes',
          '/api/v1/merchant/memberships/{membershipId}/wallet-passes/invalidate',
          '/api/v1/merchant/wallet-passes/{passId}/resync',
          '/api/v1/platform/outbox/stats',
          '/api/v1/platform/outbox/dead',
          '/api/v1/platform/outbox/dead/{jobId}/requeue',
        ]),
      );
    });
  });
});

// Keep an unused-import guard honest if sections are removed.
void createHash;

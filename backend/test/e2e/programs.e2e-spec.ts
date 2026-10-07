import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { World, bearer, createWorld, login, randomPhone } from '../support/auth-fixture';
import { createTestApp } from '../support/create-test-app';

describe('Loyalty program configuration (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let w: World;
  const http = () => request(app.getHttpServer());
  const as = async (email: string) => bearer(await login(app, email));

  const draft = (over: Record<string, unknown> = {}) => ({
    nameEn: 'Coffee Stamp Card',
    nameAm: 'የቡና ስታምፕ ካርድ',
    termsEn: 'One stamp per visit.',
    termsAm: 'በአንድ ጉብኝት አንድ ስታምፕ።',
    brandColor: '#7a4b2a',
    cardDisplay: { title: 'Coffee card', stampIcon: 'coffee', showProgressText: true },
    reward: {
      nameEn: 'Free coffee',
      nameAm: 'ነጻ ቡና',
      descriptionEn: 'One free coffee of your choice.',
      descriptionAm: 'የሚፈልጉትን ቡና በነጻ ያግኙ።',
      validForDays: 90,
    },
    ...over,
  });
  const create = (token: string, over: Record<string, unknown> = {}) =>
    http().post('/api/v1/merchant/programs').set('Authorization', token).send(draft(over));
  const act = (token: string, id: string, action: 'activate' | 'pause' | 'archive') =>
    http().post(`/api/v1/merchant/programs/${id}/${action}`).set('Authorization', token);

  beforeAll(async () => {
    prisma = new PrismaClient();
    w = await createWorld(prisma);
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const audit = (merchantId: string, action: string) =>
    prisma.auditEvent.findMany({ where: { merchantId, action } });

  describe('creating', () => {
    it('creates a bilingual DRAFT with a reward, using merchant defaults for omitted numbers', async () => {
      const owner = await as(w.a.owner.email);
      await http()
        .patch('/api/v1/merchant/profile')
        .set('Authorization', owner)
        .send({ defaultStampsRequired: 6, defaultCooldownMinutes: 30 })
        .expect(200);

      const res = await create(owner).expect(201);
      expect(res.body).toMatchObject({
        status: 'DRAFT',
        isDefault: false,
        nameEn: 'Coffee Stamp Card',
        nameAm: 'የቡና ስታምፕ ካርድ',
        termsAm: 'በአንድ ጉብኝት አንድ ስታምፕ።',
        stampsRequired: 6,
        cooldownMinutes: 30,
        brandColor: '#7A4B2A',
        cardDisplay: { title: 'Coffee card', stampIcon: 'coffee', showProgressText: true },
        reward: { nameEn: 'Free coffee', nameAm: 'ነጻ ቡና', validForDays: 90 },
        memberCount: 0,
        stampsRequiredLocked: false,
      });

      const explicit = await create(owner, { stampsRequired: 12, cooldownMinutes: 0 }).expect(201);
      expect(explicit.body).toMatchObject({ stampsRequired: 12, cooldownMinutes: 0 });
      expect(await audit(w.a.merchantId, 'program.created')).toHaveLength(2);
    });

    it('lets managers create, and keeps branch staff and platform admins out', async () => {
      await create(await as(w.a.manager.email)).expect(201);
      await create(await as(w.a.staff1.email)).expect(403);
      await create(await as(w.platformAdmin.email)).expect(403);
      await http().post('/api/v1/merchant/programs').send(draft()).expect(401);
    });

    it('validates every field', async () => {
      const owner = await as(w.a.owner.email);
      for (const over of [
        { nameEn: '' },
        { nameEn: undefined },
        { stampsRequired: 0 },
        { stampsRequired: 1001 },
        { stampsRequired: 2.5 },
        { cooldownMinutes: -1 },
        { cooldownMinutes: 10081 },
        { brandColor: 'red' },
        { brandColor: '#12345' },
        { cardDisplay: { stampIcon: 'unicorn' } },
        { cardDisplay: { title: 'x'.repeat(41) } },
        { cardDisplay: { secret: 'x' } },
        { reward: undefined },
        { reward: { nameEn: '' } },
        { reward: { nameEn: 'x', validForDays: 0 } },
        { reward: { nameEn: 'x', price: 5 } },
        { merchantId: w.b.merchantId },
        { status: 'ACTIVE' },
        { isDefault: true },
      ]) {
        await create(owner, over).expect(400);
      }
    });

    it('stores no financial fields', async () => {
      const owner = await as(w.a.owner.email);
      await create(owner, { price: 10 }).expect(400);
      await create(owner, { reward: { nameEn: 'x', cashValue: 3 } }).expect(400);
    });
  });

  describe('visibility and tenant isolation', () => {
    it('lets branch staff read programs but never change them', async () => {
      const owner = await as(w.a.owner.email);
      const created = await create(owner).expect(201);
      const staff = await as(w.a.staff1.email);
      const list = await http()
        .get('/api/v1/merchant/programs')
        .set('Authorization', staff)
        .expect(200);
      expect(list.body.map((p: { id: string }) => p.id)).toContain(created.body.id);
      await http()
        .get(`/api/v1/merchant/programs/${created.body.id}`)
        .set('Authorization', staff)
        .expect(200);
      await http()
        .patch(`/api/v1/merchant/programs/${created.body.id}`)
        .set('Authorization', staff)
        .send({ nameEn: 'x' })
        .expect(403);
      await act(staff, created.body.id, 'activate').expect(403);
      await act(staff, created.body.id, 'archive').expect(403);
    });

    it("hides and protects another merchant's programs", async () => {
      const ownerA = await as(w.a.owner.email);
      const ownerB = await as(w.b.owner.email);
      const mine = await create(ownerB).expect(201);

      const list = await http()
        .get('/api/v1/merchant/programs')
        .set('Authorization', ownerA)
        .expect(200);
      expect(list.body.map((p: { id: string }) => p.id)).not.toContain(mine.body.id);
      const url = `/api/v1/merchant/programs/${mine.body.id}`;
      await http().get(url).set('Authorization', ownerA).expect(404);
      await http().patch(url).set('Authorization', ownerA).send({ nameEn: 'Hijacked' }).expect(404);
      await act(ownerA, mine.body.id, 'activate').expect(404);
      await act(ownerA, mine.body.id, 'archive').expect(404);
      const row = await prisma.loyaltyProgram.findUniqueOrThrow({ where: { id: mine.body.id } });
      expect(row).toMatchObject({ nameEn: 'Coffee Stamp Card', status: 'DRAFT' });
    });

    it('filters the list by status', async () => {
      const owner = await as(w.a.owner.email);
      const drafts = await http()
        .get('/api/v1/merchant/programs?status=DRAFT')
        .set('Authorization', owner)
        .expect(200);
      expect(drafts.body.length).toBeGreaterThan(0);
      expect(drafts.body.every((p: { status: string }) => p.status === 'DRAFT')).toBe(true);
    });
  });

  describe('lifecycle', () => {
    it('activates a draft as the merchant default, audited, and idempotently', async () => {
      const fresh = await createWorld(prisma);
      const owner = await as(fresh.a.owner.email);
      const p = (await create(owner).expect(201)).body;

      const on = await act(owner, p.id, 'activate').expect(200);
      expect(on.body).toMatchObject({ status: 'ACTIVE', isDefault: true });
      await act(owner, p.id, 'activate').expect(200);
      expect(await audit(fresh.a.merchantId, 'program.activated')).toHaveLength(1);
      // Customers can now join.
      await http().get(`/api/v1/join/${fresh.a.joinReference}`).expect(200);
    });

    it('allows only one default ACTIVE program per merchant', async () => {
      const fresh = await createWorld(prisma);
      const owner = await as(fresh.a.owner.email);
      const first = (await create(owner).expect(201)).body;
      const second = (await create(owner, { nameEn: 'Second' }).expect(201)).body;

      await act(owner, first.id, 'activate').expect(200);
      const clash = await act(owner, second.id, 'activate').expect(409);
      expect(clash.body.error.code).toBe('DEFAULT_PROGRAM_EXISTS');

      await act(owner, first.id, 'pause').expect(200);
      await act(owner, second.id, 'activate').expect(200);
      // The paused program cannot silently take the slot back.
      const resume = await act(owner, first.id, 'activate').expect(409);
      expect(resume.body.error.code).toBe('DEFAULT_PROGRAM_EXISTS');

      await act(owner, second.id, 'archive').expect(200);
      await act(owner, first.id, 'activate').expect(200);
      expect(
        await prisma.loyaltyProgram.count({
          where: { merchantId: fresh.a.merchantId, status: 'ACTIVE', isDefault: true },
        }),
      ).toBe(1);
    });

    it('lets exactly one of two concurrent activations win', async () => {
      const fresh = await createWorld(prisma);
      const owner = await as(fresh.a.owner.email);
      const a = (await create(owner, { nameEn: 'A' }).expect(201)).body;
      const b = (await create(owner, { nameEn: 'B' }).expect(201)).body;
      const results = await Promise.all([
        act(owner, a.id, 'activate'),
        act(owner, b.id, 'activate'),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        await prisma.loyaltyProgram.count({
          where: { merchantId: fresh.a.merchantId, status: 'ACTIVE', isDefault: true },
        }),
      ).toBe(1);
    });

    it('rejects impossible transitions', async () => {
      const fresh = await createWorld(prisma);
      const owner = await as(fresh.a.owner.email);
      const p = (await create(owner).expect(201)).body;

      const pauseDraft = await act(owner, p.id, 'pause').expect(409);
      expect(pauseDraft.body.error.code).toBe('INVALID_TRANSITION');
      await act(owner, p.id, 'archive').expect(200);
      await act(owner, p.id, 'archive').expect(200); // idempotent
      await act(owner, p.id, 'activate').expect(409);
      await act(owner, p.id, 'pause').expect(409);
      const edit = await http()
        .patch(`/api/v1/merchant/programs/${p.id}`)
        .set('Authorization', owner)
        .send({ nameEn: 'x' })
        .expect(409);
      expect(edit.body.error.code).toBe('PROGRAM_ARCHIVED');
      expect(await audit(fresh.a.merchantId, 'program.archived')).toHaveLength(1);
    });

    it('stops accepting new members when paused, without touching existing ones', async () => {
      const fresh = await createWorld(prisma);
      const owner = await as(fresh.a.owner.email);
      const p = (await create(owner).expect(201)).body;
      await act(owner, p.id, 'activate').expect(200);
      const joined = await http()
        .post(`/api/v1/join/${fresh.a.joinReference}/enroll`)
        .send({
          phone: randomPhone(),
          firstName: 'Kaleb',
          preferredLanguage: 'EN',
          acceptTerms: true,
        })
        .expect(201);
      expect(joined.body.status).toBe('CREATED');

      await act(owner, p.id, 'pause').expect(200);
      await http().get(`/api/v1/join/${fresh.a.joinReference}`).expect(404);
      expect(
        await prisma.customerMembership.count({
          where: { merchantId: fresh.a.merchantId, status: 'ACTIVE' },
        }),
      ).toBe(1);

      await act(owner, p.id, 'activate').expect(200);
      await http().get(`/api/v1/join/${fresh.a.joinReference}`).expect(200);
    });

    it('archives without deleting anything and offers no delete operation', async () => {
      const fresh = await createWorld(prisma);
      const owner = await as(fresh.a.owner.email);
      const p = (await create(owner).expect(201)).body;
      await act(owner, p.id, 'activate').expect(200);
      await http()
        .post(`/api/v1/join/${fresh.a.joinReference}/enroll`)
        .send({
          phone: randomPhone(),
          firstName: 'Lemlem',
          preferredLanguage: 'AM',
          acceptTerms: true,
        })
        .expect(201);

      const archived = await act(owner, p.id, 'archive').expect(200);
      expect(archived.body).toMatchObject({ status: 'ARCHIVED', isDefault: false, memberCount: 1 });
      await http()
        .delete(`/api/v1/merchant/programs/${p.id}`)
        .set('Authorization', owner)
        .expect(404);
      expect(await prisma.loyaltyProgram.count({ where: { id: p.id } })).toBe(1);
      expect(
        await prisma.customerMembership.count({ where: { programId: p.id, status: 'ACTIVE' } }),
      ).toBe(1);
      expect(await prisma.rewardDefinition.count({ where: { programId: p.id } })).toBe(1);
    });
  });

  describe('safe editing', () => {
    it('edits content on a live program, including Amharic text, and audits field names only', async () => {
      const fresh = await createWorld(prisma);
      const owner = await as(fresh.a.owner.email);
      const p = (await create(owner).expect(201)).body;
      await act(owner, p.id, 'activate').expect(200);

      const res = await http()
        .patch(`/api/v1/merchant/programs/${p.id}`)
        .set('Authorization', owner)
        .send({
          nameEn: 'Loyalty Card',
          nameAm: 'የታማኝነት ካርድ',
          termsAm: null,
          brandColor: '#00aa55',
          cooldownMinutes: 45,
          cardDisplay: { title: 'New title', stampIcon: 'star' },
          reward: { nameAm: 'ነጻ ሻይ', descriptionEn: null, validForDays: 30 },
        })
        .expect(200);
      expect(res.body).toMatchObject({
        nameEn: 'Loyalty Card',
        nameAm: 'የታማኝነት ካርድ',
        termsAm: null,
        brandColor: '#00AA55',
        cooldownMinutes: 45,
        cardDisplay: { title: 'New title', stampIcon: 'star' },
        reward: { nameEn: 'Free coffee', nameAm: 'ነጻ ሻይ', descriptionEn: null, validForDays: 30 },
        status: 'ACTIVE',
      });
      expect(res.body.cardDisplay.showProgressText).toBeUndefined(); // card display is replaced as a whole

      const events = await audit(fresh.a.merchantId, 'program.updated');
      expect(events).toHaveLength(1);
      const fields = (events[0]?.metadata as { changedFields: string[] }).changedFields;
      expect(fields).toEqual(
        expect.arrayContaining([
          'nameEn',
          'nameAm',
          'brandColor',
          'cooldownMinutes',
          'reward.nameAm',
          'reward.validForDays',
        ]),
      );
      expect(JSON.stringify(events[0])).not.toContain('Loyalty Card');
    });

    it('treats an unchanged update as a no-op and rejects invalid edits', async () => {
      const fresh = await createWorld(prisma);
      const owner = await as(fresh.a.owner.email);
      const p = (await create(owner).expect(201)).body;
      const url = `/api/v1/merchant/programs/${p.id}`;
      await http()
        .patch(url)
        .set('Authorization', owner)
        .send({ nameEn: p.nameEn, cooldownMinutes: p.cooldownMinutes })
        .expect(200);
      expect(await audit(fresh.a.merchantId, 'program.updated')).toHaveLength(0);

      await http().patch(url).set('Authorization', owner).send({ nameEn: null }).expect(400);
      await http().patch(url).set('Authorization', owner).send({ brandColor: 'nope' }).expect(400);
      await http().patch(url).set('Authorization', owner).send({ stampsRequired: 0 }).expect(400);
      await http().patch(url).set('Authorization', owner).send({ status: 'ACTIVE' }).expect(400);
      await http().patch(url).set('Authorization', owner).send({ isDefault: true }).expect(400);
      await http()
        .patch(url)
        .set('Authorization', owner)
        .send({ reward: { nameEn: '' } })
        .expect(400);
    });

    it('allows changing the stamp requirement only while nobody has joined', async () => {
      const fresh = await createWorld(prisma);
      const owner = await as(fresh.a.owner.email);
      const p = (await create(owner, { stampsRequired: 8 }).expect(201)).body;
      const url = `/api/v1/merchant/programs/${p.id}`;

      const early = await http()
        .patch(url)
        .set('Authorization', owner)
        .send({ stampsRequired: 9 })
        .expect(200);
      expect(early.body.stampsRequired).toBe(9);

      await act(owner, p.id, 'activate').expect(200);
      await http()
        .post(`/api/v1/join/${fresh.a.joinReference}/enroll`)
        .send({
          phone: randomPhone(),
          firstName: 'Mimi',
          preferredLanguage: 'EN',
          acceptTerms: true,
        })
        .expect(201);

      const locked = await http()
        .patch(url)
        .set('Authorization', owner)
        .send({ stampsRequired: 5 })
        .expect(409);
      expect(locked.body.error.code).toBe('PROGRAM_LOCKED');
      const row = await prisma.loyaltyProgram.findUniqueOrThrow({ where: { id: p.id } });
      expect(row.stampsRequired).toBe(9);

      // Sending the same value is harmless; other edits still work.
      await http()
        .patch(url)
        .set('Authorization', owner)
        .send({ stampsRequired: 9, cooldownMinutes: 15 })
        .expect(200);
      const view = await http().get(url).set('Authorization', owner).expect(200);
      expect(view.body).toMatchObject({
        memberCount: 1,
        stampsRequiredLocked: true,
        cooldownMinutes: 15,
      });
    });

    it('never lets an enrollment slip in while the threshold is being changed', async () => {
      const fresh = await createWorld(prisma);
      const owner = await as(fresh.a.owner.email);
      const p = (await create(owner, { stampsRequired: 8 }).expect(201)).body;
      await act(owner, p.id, 'activate').expect(200);

      const [patch, join] = await Promise.all([
        http()
          .patch(`/api/v1/merchant/programs/${p.id}`)
          .set('Authorization', owner)
          .send({ stampsRequired: 3 }),
        http().post(`/api/v1/join/${fresh.a.joinReference}/enroll`).send({
          phone: randomPhone(),
          firstName: 'Race',
          preferredLanguage: 'EN',
          acceptTerms: true,
        }),
      ]);
      expect(join.status).toBe(201);
      const row = await prisma.loyaltyProgram.findUniqueOrThrow({ where: { id: p.id } });
      const members = await prisma.customerMembership.count({ where: { programId: p.id } });
      // Either the threshold changed first (no member yet when it did) or the member joined first (patch refused).
      if (patch.status === 200) expect(row.stampsRequired).toBe(3);
      else {
        expect(patch.status).toBe(409);
        expect(row.stampsRequired).toBe(8);
      }
      expect(members).toBe(1);
    });
  });

  describe('documentation', () => {
    it('documents the program endpoints', async () => {
      const res = await http().get('/api/docs-json').expect(200);
      const paths = Object.keys(res.body.paths);
      for (const p of [
        '/api/v1/merchant/programs',
        '/api/v1/merchant/programs/{programId}',
        '/api/v1/merchant/programs/{programId}/activate',
        '/api/v1/merchant/programs/{programId}/pause',
        '/api/v1/merchant/programs/{programId}/archive',
        '/api/v1/join/{joinReference}',
        '/api/v1/join/{joinReference}/enroll',
        '/api/v1/card/consent/marketing/withdraw',
        '/api/v1/merchant/customers',
        '/api/v1/merchant/customers/{customerId}',
        '/api/v1/merchant/memberships/{membershipId}/reissue-card',
      ]) {
        expect(paths).toContain(p);
      }
    });
  });
});

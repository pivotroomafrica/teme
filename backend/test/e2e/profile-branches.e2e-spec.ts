import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { World, bearer, createWorld, login } from '../support/auth-fixture';
import { createTestApp } from '../support/create-test-app';

describe('Merchant profile and branch management (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let w: World;
  const http = () => request(app.getHttpServer());

  const as = async (email: string) => bearer(await login(app, email));

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
    prisma.auditEvent.findMany({ where: { merchantId, action }, orderBy: { occurredAt: 'asc' } });

  describe('merchant profile', () => {
    it('returns defaults when no settings row exists yet, scoped to the caller', async () => {
      const res = await http()
        .get('/api/v1/merchant/profile')
        .set('Authorization', await as(w.a.owner.email))
        .expect(200);
      expect(res.body).toMatchObject({
        id: w.a.merchantId,
        timezone: 'Africa/Addis_Ababa',
        defaultLanguage: 'EN',
        logo: null,
        supportEmail: null,
        supportPhone: null,
        programDefaults: { stampsRequired: 10, cooldownMinutes: 0 },
      });
      expect(res.body.joinReference).toBeTruthy();
    });

    it('lets owners and managers view and update, but not branch staff', async () => {
      const staff = await as(w.a.staff1.email);
      await http().get('/api/v1/merchant/profile').set('Authorization', staff).expect(403);
      await http()
        .patch('/api/v1/merchant/profile')
        .set('Authorization', staff)
        .send({ nameEn: 'Hacked' })
        .expect(403);
      await http()
        .get('/api/v1/merchant/profile')
        .set('Authorization', await as(w.a.manager.email))
        .expect(200);
    });

    it('updates English/Amharic names, timezone, language, support contact and defaults', async () => {
      const owner = await as(w.a.owner.email);
      const res = await http()
        .patch('/api/v1/merchant/profile')
        .set('Authorization', owner)
        .send({
          nameEn: '  Blue Door Cafe ',
          nameAm: 'ሰማያዊ በር ቡና ቤት',
          timezone: 'UTC',
          defaultLanguage: 'AM',
          supportEmail: 'Help@Blue-Door.test',
          supportPhone: '0911 234 567',
          defaultStampsRequired: 8,
          defaultCooldownMinutes: 120,
        })
        .expect(200);
      expect(res.body).toMatchObject({
        nameEn: 'Blue Door Cafe',
        nameAm: 'ሰማያዊ በር ቡና ቤት',
        timezone: 'UTC',
        defaultLanguage: 'AM',
        supportEmail: 'help@blue-door.test',
        supportPhone: '+251911234567',
        programDefaults: { stampsRequired: 8, cooldownMinutes: 120 },
      });

      const again = await http()
        .get('/api/v1/merchant/profile')
        .set('Authorization', owner)
        .expect(200);
      expect(again.body.nameAm).toBe('ሰማያዊ በር ቡና ቤት');
    });

    it('audits only the names of changed fields, never the values', async () => {
      const events = await audit(w.a.merchantId, 'merchant.profile_updated');
      expect(events).toHaveLength(1);
      const meta = events[0]?.metadata as { changedFields: string[] };
      expect(meta.changedFields).toEqual(
        expect.arrayContaining(['nameEn', 'nameAm', 'timezone', 'supportEmail', 'supportPhone']),
      );
      const dump = JSON.stringify(events[0]);
      expect(dump).not.toContain('blue-door');
      expect(dump).not.toContain('251911234567');
      expect(events[0]?.actorUserId).toBe(w.a.owner.userId);
    });

    it('does not audit a no-op update, and can clear optional fields with null', async () => {
      const owner = await as(w.a.owner.email);
      await http()
        .patch('/api/v1/merchant/profile')
        .set('Authorization', owner)
        .send({ timezone: 'UTC' })
        .expect(200);
      expect(await audit(w.a.merchantId, 'merchant.profile_updated')).toHaveLength(1);

      const res = await http()
        .patch('/api/v1/merchant/profile')
        .set('Authorization', owner)
        .send({ nameAm: null, supportPhone: null })
        .expect(200);
      expect(res.body.nameAm).toBeNull();
      expect(res.body.supportPhone).toBeNull();
    });

    it('validates input', async () => {
      const owner = await as(w.a.owner.email);
      const patch = (body: object) =>
        http().patch('/api/v1/merchant/profile').set('Authorization', owner).send(body);
      await patch({}).expect(400);
      await patch({ timezone: 'Mars/Base' }).expect(400);
      await patch({ timezone: '+03:00' }).expect(400);
      await patch({ supportPhone: '12345' }).expect(400);
      await patch({ supportPhone: '+254711000000' }).expect(400);
      await patch({ supportEmail: 'nope' }).expect(400);
      await patch({ defaultLanguage: 'FR' }).expect(400);
      await patch({ defaultStampsRequired: 0 }).expect(400);
      await patch({ defaultStampsRequired: 1001 }).expect(400);
      await patch({ defaultCooldownMinutes: -1 }).expect(400);
      await patch({ nameEn: null }).expect(400);
      await patch({ nameEn: '' }).expect(400);
    });

    it('never lets a client choose the merchant or touch protected fields', async () => {
      const owner = await as(w.a.owner.email);
      for (const body of [
        { merchantId: w.b.merchantId, nameEn: 'X' },
        { id: w.b.merchantId, nameEn: 'X' },
        { status: 'DEACTIVATED' },
        { slug: 'taken' },
        { joinReference: 'mine' },
      ]) {
        await http()
          .patch('/api/v1/merchant/profile')
          .set('Authorization', owner)
          .send(body)
          .expect(400);
      }
      const b = await prisma.merchant.findUniqueOrThrow({ where: { id: w.b.merchantId } });
      expect(b.nameEn).not.toBe('X');
    });

    it("keeps one merchant's changes invisible to another", async () => {
      const res = await http()
        .get('/api/v1/merchant/profile')
        .set('Authorization', await as(w.b.owner.email))
        .expect(200);
      expect(res.body.id).toBe(w.b.merchantId);
      expect(res.body.nameEn).not.toContain('Blue Door');
      expect(res.body.timezone).toBe('Africa/Addis_Ababa');
    });

    it('records logo metadata under the merchant’s own storage prefix', async () => {
      const owner = await as(w.a.owner.email);
      const put = await http()
        .put('/api/v1/merchant/profile/logo')
        .set('Authorization', owner)
        .send({ contentType: 'image/png' })
        .expect(200);
      expect(put.body.storageKey).toMatch(
        new RegExp(`^merchants/${w.a.merchantId}/logo/[0-9a-f-]{36}\\.png$`),
      );

      const profile = await http()
        .get('/api/v1/merchant/profile')
        .set('Authorization', owner)
        .expect(200);
      expect(profile.body.logo).toEqual({
        storageKey: put.body.storageKey,
        contentType: 'image/png',
      });

      await http()
        .put('/api/v1/merchant/profile/logo')
        .set('Authorization', owner)
        .send({ contentType: 'image/gif' })
        .expect(400);
      await http()
        .put('/api/v1/merchant/profile/logo')
        .set('Authorization', owner)
        .send({
          contentType: 'image/png',
          storageKey: `merchants/${w.b.merchantId}/logo/steal.png`,
        })
        .expect(400);
      await http()
        .put('/api/v1/merchant/profile/logo')
        .set('Authorization', await as(w.a.staff1.email))
        .send({ contentType: 'image/png' })
        .expect(403);

      await http().delete('/api/v1/merchant/profile/logo').set('Authorization', owner).expect(204);
      const cleared = await http()
        .get('/api/v1/merchant/profile')
        .set('Authorization', owner)
        .expect(200);
      expect(cleared.body.logo).toBeNull();
      expect(await audit(w.a.merchantId, 'merchant.logo_updated')).toHaveLength(1);
      expect(await audit(w.a.merchantId, 'merchant.logo_removed')).toHaveLength(1);
    });
  });

  describe('branches', () => {
    it('creates a branch with normalised phone, audited, in the caller’s merchant only', async () => {
      const owner = await as(w.a.owner.email);
      const res = await http()
        .post('/api/v1/merchant/branches')
        .set('Authorization', owner)
        .send({
          nameEn: ' Megenagna ',
          nameAm: 'መገናኛ',
          addressText: 'Near the roundabout',
          city: 'Addis Ababa',
          phone: '0911 000 111',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        nameEn: 'Megenagna',
        nameAm: 'መገናኛ',
        city: 'Addis Ababa',
        phoneE164: '+251911000111',
        status: 'ACTIVE',
      });

      const row = await prisma.branch.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(row.merchantId).toBe(w.a.merchantId);

      const created = await audit(w.a.merchantId, 'branch.created');
      expect(created.map((e) => e.branchId)).toContain(res.body.id);

      const listB = await http()
        .get('/api/v1/merchant/branches')
        .set('Authorization', await as(w.b.owner.email))
        .expect(200);
      expect(listB.body.map((b: { id: string }) => b.id)).not.toContain(res.body.id);
    });

    it('lets managers manage branches but not branch staff', async () => {
      await http()
        .post('/api/v1/merchant/branches')
        .set('Authorization', await as(w.a.manager.email))
        .send({ nameEn: 'Manager branch' })
        .expect(201);
      const staff = await as(w.a.staff1.email);
      await http()
        .post('/api/v1/merchant/branches')
        .set('Authorization', staff)
        .send({ nameEn: 'x' })
        .expect(403);
      await http()
        .patch(`/api/v1/merchant/branches/${w.a.branches[0]}`)
        .set('Authorization', staff)
        .send({ city: 'x' })
        .expect(403);
      await http()
        .post(`/api/v1/merchant/branches/${w.a.branches[0]}/deactivate`)
        .set('Authorization', staff)
        .expect(403);
    });

    it('validates branch input and rejects client-supplied merchant ids and status', async () => {
      const owner = await as(w.a.owner.email);
      const post = (body: object) =>
        http().post('/api/v1/merchant/branches').set('Authorization', owner).send(body);
      await post({}).expect(400);
      await post({ nameEn: '' }).expect(400);
      await post({ nameEn: 'x', phone: '12' }).expect(400);
      await post({ nameEn: 'x', merchantId: w.b.merchantId }).expect(400);
      await post({ nameEn: 'x', status: 'INACTIVE' }).expect(400);
      await post({ nameEn: 'x'.repeat(121) }).expect(400);
    });

    it('updates partially, clears with null, and rejects empty updates', async () => {
      const owner = await as(w.a.owner.email);
      const url = `/api/v1/merchant/branches/${w.a.branches[0]}`;
      const res = await http()
        .patch(url)
        .set('Authorization', owner)
        .send({ city: 'Adama', phone: '0722334455' })
        .expect(200);
      expect(res.body).toMatchObject({ city: 'Adama', phoneE164: '+251722334455' });

      const cleared = await http()
        .patch(url)
        .set('Authorization', owner)
        .send({ city: null, phone: null })
        .expect(200);
      expect(cleared.body.city).toBeNull();
      expect(cleared.body.phoneE164).toBeNull();
      expect(cleared.body.nameEn).toBeTruthy();

      await http().patch(url).set('Authorization', owner).send({}).expect(400);
      await http().patch(url).set('Authorization', owner).send({ phone: 'bad' }).expect(400);

      const events = await audit(w.a.merchantId, 'branch.updated');
      const fields = events.flatMap(
        (e) => (e.metadata as { changedFields: string[] }).changedFields,
      );
      expect(fields).toEqual(expect.arrayContaining(['city', 'phoneE164']));
      expect(JSON.stringify(events)).not.toContain('251722334455');
    });

    it("answers 404 for another merchant's branch on every write", async () => {
      const owner = await as(w.a.owner.email);
      const other = `/api/v1/merchant/branches/${w.b.branches[0]}`;
      await http().patch(other).set('Authorization', owner).send({ city: 'Hijack' }).expect(404);
      await http().post(`${other}/deactivate`).set('Authorization', owner).expect(404);
      await http().post(`${other}/activate`).set('Authorization', owner).expect(404);
      const row = await prisma.branch.findUniqueOrThrow({ where: { id: w.b.branches[0] } });
      expect(row.city).not.toBe('Hijack');
      expect(row.status).toBe('ACTIVE');
    });

    it('deactivates and re-activates idempotently, keeping history and removing operating access', async () => {
      const owner = await as(w.a.owner.email);
      const staff = await as(w.a.staff1.email);
      const target = w.a.branches[0];
      await http()
        .get(`/api/v1/merchant/branches/${target}`)
        .set('Authorization', staff)
        .expect(200);

      const off = await http()
        .post(`/api/v1/merchant/branches/${target}/deactivate`)
        .set('Authorization', owner)
        .expect(200);
      expect(off.body.status).toBe('INACTIVE');
      await http()
        .post(`/api/v1/merchant/branches/${target}/deactivate`)
        .set('Authorization', owner)
        .expect(200);
      expect(await audit(w.a.merchantId, 'branch.deactivated')).toHaveLength(1);

      // Assigned staff immediately lose the branch; the owner still sees it (as inactive).
      await http()
        .get(`/api/v1/merchant/branches/${target}`)
        .set('Authorization', staff)
        .expect(404);
      const list = await http()
        .get('/api/v1/merchant/branches')
        .set('Authorization', owner)
        .expect(200);
      expect(list.body.find((b: { id: string }) => b.id === target).status).toBe('INACTIVE');

      const row = await prisma.branch.findUniqueOrThrow({ where: { id: target } });
      expect(row.deactivatedAt).not.toBeNull();
      expect(
        await prisma.staffBranchAssignment.count({ where: { branchId: target } }),
      ).toBeGreaterThan(0);

      const on = await http()
        .post(`/api/v1/merchant/branches/${target}/activate`)
        .set('Authorization', owner)
        .expect(200);
      expect(on.body.status).toBe('ACTIVE');
      await http()
        .post(`/api/v1/merchant/branches/${target}/activate`)
        .set('Authorization', owner)
        .expect(200);
      expect(await audit(w.a.merchantId, 'branch.activated')).toHaveLength(1);
      await http()
        .get(`/api/v1/merchant/branches/${target}`)
        .set('Authorization', staff)
        .expect(200);
    });

    it('never lets a merchant deactivate its last active branch, even concurrently', async () => {
      const fresh = await createWorld(prisma);
      const owner = await as(fresh.a.owner.email);
      // Two branches: deactivating both at once must leave exactly one active.
      const results = await Promise.all(
        fresh.a.branches.map((id) =>
          http().post(`/api/v1/merchant/branches/${id}/deactivate`).set('Authorization', owner),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)?.body.error.code).toBe('LAST_ACTIVE_BRANCH');
      expect(
        await prisma.branch.count({ where: { merchantId: fresh.a.merchantId, status: 'ACTIVE' } }),
      ).toBe(1);
    });
  });

  describe('API documentation', () => {
    it('documents the new organisation endpoints', async () => {
      const res = await http().get('/api/docs-json').expect(200);
      const paths = Object.keys(res.body.paths);
      for (const p of [
        '/api/v1/merchant/profile',
        '/api/v1/merchant/profile/logo',
        '/api/v1/merchant/branches/{branchId}/deactivate',
        '/api/v1/merchant/branches/{branchId}/activate',
        '/api/v1/merchant/staff/{staffId}/branches',
        '/api/v1/merchant/staff/{staffId}/activity',
        '/api/v1/merchant/staff/{staffId}/invitation',
        '/api/v1/auth/invitations/accept',
      ]) {
        expect(paths).toContain(p);
      }
    });
  });
});

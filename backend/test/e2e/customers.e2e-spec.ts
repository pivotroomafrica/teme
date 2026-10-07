import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { World, bearer, createActiveProgram, createWorld, login } from '../support/auth-fixture';
import { createTestApp } from '../support/create-test-app';

describe('Customer search (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let w: World;
  let programA: { id: string };
  const http = () => request(app.getHttpServer());
  const as = async (email: string) => bearer(await login(app, email));
  const search = (token: string, qs = '') =>
    http().get(`/api/v1/merchant/customers${qs}`).set('Authorization', token);

  async function seedCustomer(
    merchantId: string,
    programId: string | null,
    phone: string,
    firstName: string,
  ) {
    const c = await prisma.customer.create({ data: { merchantId, phoneE164: phone, firstName } });
    if (programId) {
      await prisma.customerMembership.create({
        data: { merchantId, customerId: c.id, programId, tokenHash: `h-${c.id}` },
      });
    }
    return c;
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    w = await createWorld(prisma);
    programA = await createActiveProgram(prisma, w.a.merchantId);
    const programB = await createActiveProgram(prisma, w.b.merchantId);
    // Tenant A
    await seedCustomer(w.a.merchantId, programA.id, '+251911100001', 'Abebe');
    await seedCustomer(w.a.merchantId, programA.id, '+251911100002', 'Abeba');
    await seedCustomer(w.a.merchantId, programA.id, '+251911100003', 'Sara');
    await seedCustomer(w.a.merchantId, programA.id, '+251922200004', 'አበበ');
    // Tenant B: deliberately reuses A's first phone number and a similar name.
    await seedCustomer(w.b.merchantId, programB.id, '+251911100001', 'Abebe');
    await seedCustomer(w.b.merchantId, programB.id, '+251933300005', 'OnlyAtB');
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('searching', () => {
    it('finds a customer by any format of their phone number', async () => {
      const owner = await as(w.a.owner.email);
      for (const q of ['0911100001', '+251 91 110 0001', '251911100001', '(0911) 100-001']) {
        const res = await search(owner, `?q=${encodeURIComponent(q)}`).expect(200);
        expect(res.body.items.map((c: { firstName: string }) => c.firstName)).toEqual(['Abebe']);
        expect(res.body.items[0].phone).toBe('+251911100001');
      }
    });

    it('finds customers by case-insensitive name fragments, including Amharic', async () => {
      const owner = await as(w.a.owner.email);
      const names = async (q: string) =>
        (await search(owner, `?q=${encodeURIComponent(q)}`).expect(200)).body.items
          .map((c: { firstName: string }) => c.firstName)
          .sort();
      expect(await names('abeb')).toEqual(['Abeba', 'Abebe']);
      expect(await names('ABEBE')).toEqual(['Abebe']);
      expect(await names('አበ')).toEqual(['አበበ']);
      expect(await names('nobody')).toEqual([]);
    });

    it('supports partial numbers (4+ digits) for managers', async () => {
      const manager = await as(w.a.manager.email);
      const res = await search(manager, '?q=11000').expect(200);
      expect(res.body.items.map((c: { phone: string }) => c.phone).sort()).toEqual([
        '+251911100001',
        '+251911100002',
        '+251911100003',
      ]);
      expect((await search(manager, '?q=123').expect(200)).body.items).toEqual([]);
    });

    it('does not treat SQL wildcards as "match everything"', async () => {
      const owner = await as(w.a.owner.email);
      const all = await search(owner).expect(200);
      expect(all.body.items).toHaveLength(4);
      for (const q of ['%', '_', 'a%', '%%%%']) {
        const res = await search(owner, `?q=${encodeURIComponent(q)}`).expect(200);
        // "%" and "_" are stripped, leaving a plain listing or a plain prefix search.
        expect(res.body.items.length).toBeLessThanOrEqual(4);
      }
      const underscore = await search(owner, `?q=${encodeURIComponent('A_eb')}`).expect(200);
      expect(underscore.body.items.map((c: { firstName: string }) => c.firstName).sort()).toEqual(
        [],
      );
    });
  });

  describe('tenant isolation', () => {
    it('only ever returns the caller’s own customers, even for a shared phone number', async () => {
      const ownerA = await as(w.a.owner.email);
      const ownerB = await as(w.b.owner.email);

      const a = await search(ownerA, '?q=0911100001').expect(200);
      const b = await search(ownerB, '?q=0911100001').expect(200);
      expect(a.body.items).toHaveLength(1);
      expect(b.body.items).toHaveLength(1);
      expect(a.body.items[0].id).not.toBe(b.body.items[0].id);

      expect((await search(ownerA, '?q=OnlyAtB').expect(200)).body.items).toEqual([]);
      const listA = (await search(ownerA, '?limit=100').expect(200)).body.items;
      expect(JSON.stringify(listA)).not.toContain('OnlyAtB');
      expect(JSON.stringify(listA)).not.toContain('933300005');
    });

    it('reports another tenant’s customer as not found', async () => {
      const ownerA = await as(w.a.owner.email);
      const atB = await prisma.customer.findFirstOrThrow({
        where: { merchantId: w.b.merchantId, firstName: 'OnlyAtB' },
      });
      await http()
        .get(`/api/v1/merchant/customers/${atB.id}`)
        .set('Authorization', ownerA)
        .expect(404);
    });
  });

  describe('paging', () => {
    it('pages newest-first without gaps or duplicates', async () => {
      const fresh = await createWorld(prisma);
      const program = await createActiveProgram(prisma, fresh.a.merchantId);
      for (let i = 0; i < 7; i++) {
        await seedCustomer(
          fresh.a.merchantId,
          program.id,
          `+2519111110${String(i).padStart(2, '0')}`,
          `Person${i}`,
        );
      }
      const owner = await as(fresh.a.owner.email);

      const seen: Array<{ id: string; joinedAt: string }> = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: request.Response = await search(
          owner,
          `?limit=3${cursor ? `&cursor=${cursor}` : ''}`,
        ).expect(200);
        expect(res.body.items.length).toBeLessThanOrEqual(3);
        seen.push(...res.body.items);
        cursor = res.body.nextCursor;
        pages++;
      } while (cursor);

      expect(pages).toBe(3);
      expect(seen).toHaveLength(7);
      expect(new Set(seen.map((c) => c.id)).size).toBe(7);
      const times = seen.map((c) => new Date(c.joinedAt).getTime());
      expect([...times].sort((x, y) => y - x)).toEqual(times);
    });

    it('validates paging parameters', async () => {
      const owner = await as(w.a.owner.email);
      await search(owner, '?limit=0').expect(400);
      await search(owner, '?limit=101').expect(400);
      await search(owner, '?limit=x').expect(400);
      await search(owner, `?q=${'x'.repeat(101)}`).expect(400);
      await search(owner, '?cursor=garbage').expect(200);
      await search(owner, '?merchantId=anything').expect(400); // clients cannot choose a tenant
    });
  });

  describe('permissions and privacy', () => {
    it('masks phone numbers for branch staff and requires a full number to search', async () => {
      const staff = await as(w.a.staff1.email);
      const listed = await search(staff).expect(200);
      expect(listed.body.items.length).toBeGreaterThan(0);
      for (const c of listed.body.items) {
        expect(c.phoneMasked).toBe(true);
        expect(c.phone).toMatch(/^\+2519\*+\d{3}$/);
      }
      expect(JSON.stringify(listed.body)).not.toContain('+251911100001');

      // A complete number finds the customer (still masked); a fragment does not.
      const exact = await search(staff, '?q=0911100001').expect(200);
      expect(exact.body.items).toHaveLength(1);
      expect(exact.body.items[0].phone).not.toContain('11100001');
      expect((await search(staff, '?q=11000').expect(200)).body.items).toEqual([]);

      const detail = await http()
        .get(`/api/v1/merchant/customers/${exact.body.items[0].id}`)
        .set('Authorization', staff)
        .expect(200);
      expect(detail.body.phoneMasked).toBe(true);
    });

    it('shows full numbers and consent state to owners and managers', async () => {
      const manager = await as(w.a.manager.email);
      const res = await search(manager, '?q=0911100001').expect(200);
      expect(res.body.items[0]).toMatchObject({
        phone: '+251911100001',
        phoneMasked: false,
        marketingConsent: false,
        preferredLanguage: 'EN',
      });
      expect(res.body.items[0].memberships).toHaveLength(1);
      expect(res.body.items[0].memberships[0]).toMatchObject({
        programId: programA.id,
        status: 'ACTIVE',
      });
    });

    it('rejects anonymous callers and platform administrators', async () => {
      await http().get('/api/v1/merchant/customers').expect(401);
      await search(await as(w.platformAdmin.email)).expect(403);
    });

    it('excludes anonymized customers from search', async () => {
      const fresh = await createWorld(prisma);
      const owner = await as(fresh.a.owner.email);
      const c = await prisma.customer.create({
        data: { merchantId: fresh.a.merchantId, phoneE164: '+251944400001', firstName: 'Gone' },
      });
      expect((await search(owner, '?q=Gone').expect(200)).body.items).toHaveLength(1);
      await prisma.customer.update({
        where: { id: c.id },
        data: { status: 'ANONYMIZED', anonymizedAt: new Date(), phoneE164: null, firstName: null },
      });
      expect((await search(owner, '?q=Gone').expect(200)).body.items).toHaveLength(0);
      expect((await search(owner, '?q=0944400001').expect(200)).body.items).toHaveLength(0);
    });
  });
});

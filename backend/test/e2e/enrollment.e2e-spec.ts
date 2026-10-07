import { createHash } from 'node:crypto';
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

describe('Customer enrollment, consent and cards (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let w: World;
  let programA: { id: string };
  let programB: { id: string };
  const http = () => request(app.getHttpServer());
  const as = async (email: string) => bearer(await login(app, email));
  const sha = (v: string) => createHash('sha256').update(v).digest('hex');

  const body = (over: Record<string, unknown> = {}) => ({
    phone: randomPhone(),
    firstName: 'Abebe',
    preferredLanguage: 'AM',
    acceptTerms: true,
    ...over,
  });
  const enroll = (ref: string, over: Record<string, unknown> = {}) =>
    http().post(`/api/v1/join/${ref}/enroll`).send(body(over));

  beforeAll(async () => {
    prisma = new PrismaClient();
    w = await createWorld(prisma);
    programA = await createActiveProgram(prisma, w.a.merchantId, { stampsRequired: 6 });
    programB = await createActiveProgram(prisma, w.b.merchantId);
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('public join page', () => {
    it('shows the program in both languages without internal ids or contact data', async () => {
      const res = await http().get(`/api/v1/join/${w.a.joinReference}`).expect(200);
      expect(res.body.merchant.nameEn).toBeTruthy();
      expect(res.body.program).toMatchObject({
        nameEn: 'Test Card',
        nameAm: 'የሙከራ ካርድ',
        stampsRequired: 6,
        reward: { nameEn: 'Free item', nameAm: 'ነጻ እቃ' },
      });
      expect(res.body.consent.version).toMatch(/^\d{4}-\d{2}-v\d+$/);
      expect(res.body.wallet.map((o: { provider: string }) => o.provider)).toEqual([
        'WEB',
        'APPLE',
        'GOOGLE',
      ]);

      const text = JSON.stringify(res.body);
      for (const secret of [w.a.merchantId, programA.id, w.a.owner.email]) {
        expect(text).not.toContain(secret);
      }
    });

    it('reports web as available and Apple/Google as not configured', async () => {
      const res = await http().get(`/api/v1/join/${w.a.joinReference}`).expect(200);
      expect(res.body.wallet).toEqual([
        { provider: 'WEB', available: true, reason: null, addUrl: null },
        { provider: 'APPLE', available: false, reason: 'NOT_CONFIGURED', addUrl: null },
        { provider: 'GOOGLE', available: false, reason: 'NOT_CONFIGURED', addUrl: null },
      ]);
    });

    it('answers identically for unknown links and merchants without an active program', async () => {
      const fresh = await createWorld(prisma); // no program at all
      const unknown = await http().get('/api/v1/join/no-such-reference').expect(404);
      const noProgram = await http().get(`/api/v1/join/${fresh.a.joinReference}`).expect(404);
      expect(noProgram.body.error.code).toBe(unknown.body.error.code);
      expect(noProgram.body.error.message).toBe(unknown.body.error.message);
      await enroll(fresh.a.joinReference).expect(404);
    });

    it.each(['DRAFT', 'PAUSED', 'ARCHIVED'] as const)(
      'is closed while the program is %s',
      async (status) => {
        const fresh = await createWorld(prisma);
        const program = await createActiveProgram(prisma, fresh.a.merchantId);
        await prisma.loyaltyProgram.update({
          where: { id: program.id },
          data: { status, isDefault: status !== 'ARCHIVED' },
        });
        await http().get(`/api/v1/join/${fresh.a.joinReference}`).expect(404);
        await enroll(fresh.a.joinReference).expect(404);
        expect(await prisma.customer.count({ where: { merchantId: fresh.a.merchantId } })).toBe(0);
      },
    );

    it('is closed for a suspended merchant', async () => {
      const fresh = await createWorld(prisma);
      await createActiveProgram(prisma, fresh.a.merchantId);
      await prisma.merchant.update({
        where: { id: fresh.a.merchantId },
        data: { status: 'SUSPENDED' },
      });
      await http().get(`/api/v1/join/${fresh.a.joinReference}`).expect(404);
      await enroll(fresh.a.joinReference).expect(404);
    });
  });

  describe('enrolling', () => {
    it('creates the customer, membership, consent, web pass and a one-time card token', async () => {
      const raw = '0911 234 567';
      const res = await enroll(w.a.joinReference, {
        phone: raw,
        firstName: ' Abebe ',
        marketingConsent: true,
      }).expect(201);
      expect(res.body).toMatchObject({
        status: 'CREATED',
        customer: { firstName: 'Abebe', preferredLanguage: 'AM' },
      });
      const token: string = res.body.card.token;
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const customer = await prisma.customer.findFirstOrThrow({
        where: { merchantId: w.a.merchantId, phoneE164: '+251911234567' },
        include: { memberships: { include: { walletPasses: true } }, consents: true },
      });
      expect(customer).toMatchObject({
        firstName: 'Abebe',
        preferredLanguage: 'AM',
        status: 'ACTIVE',
      });
      expect(customer.memberships).toHaveLength(1);
      const m = customer.memberships[0]!;
      expect(m.programId).toBe(programA.id);
      expect(m.status).toBe('ACTIVE');
      expect(m.tokenHash).toBe(sha(token));
      expect(JSON.stringify(m)).not.toContain(token);
      expect(m.walletPasses.map((p) => [p.provider, p.status])).toEqual([['WEB', 'ACTIVE']]);

      expect(customer.consents.map((c) => `${c.type}:${c.action}`).sort()).toEqual([
        'LOYALTY_TERMS:GRANTED',
        'MARKETING:GRANTED',
      ]);
      for (const c of customer.consents) {
        expect(c.version).toMatch(/^\d{4}-\d{2}-v\d+$/);
        expect(c.source).toBe('JOIN_FORM');
        expect(Date.now() - c.occurredAt.getTime()).toBeLessThan(60_000);
      }
    });

    it('records no marketing consent unless explicitly given', async () => {
      const res = await enroll(w.a.joinReference).expect(201);
      const customer = await prisma.customer.findFirstOrThrow({
        where: { memberships: { some: { tokenHash: sha(res.body.card.token) } } },
        include: { consents: true },
      });
      expect(customer.consents.map((c) => c.type)).toEqual(['LOYALTY_TERMS']);
    });

    it('writes an audit event that contains no personal data', async () => {
      const phone = randomPhone();
      const res = await enroll(w.a.joinReference, { phone, firstName: 'Zerihun' }).expect(201);
      const m = await prisma.customerMembership.findFirstOrThrow({
        where: { tokenHash: sha(res.body.card.token) },
      });
      const event = await prisma.auditEvent.findFirstOrThrow({
        where: { action: 'customer.enrolled', targetId: m.id },
      });
      expect(event).toMatchObject({ merchantId: w.a.merchantId, actorType: 'SYSTEM' });
      expect(event.metadata).toMatchObject({ source: 'join_form', newCustomer: true });
      const dump = JSON.stringify(event);
      for (const pii of [phone, phone.slice(1), 'Zerihun', res.body.card.token])
        expect(dump).not.toContain(pii);
    });

    it('treats every phone format as the same customer and never duplicates', async () => {
      const local = randomPhone(); // 0911…
      const e164 = `+251${local.slice(1)}`;
      const first = await enroll(w.a.joinReference, { phone: local }).expect(201);
      expect(first.body.status).toBe('CREATED');

      for (const variant of [
        e164,
        `251${local.slice(1)}`,
        `00${e164.slice(1)}`,
        `${local.slice(0, 4)} ${local.slice(4, 7)}-${local.slice(7)}`,
      ]) {
        const again = await enroll(w.a.joinReference, { phone: variant }).expect(201);
        expect(again.body.status).toBe('EXISTING');
        expect(again.body.card).toBeNull();
      }
      expect(
        await prisma.customer.count({ where: { merchantId: w.a.merchantId, phoneE164: e164 } }),
      ).toBe(1);
      expect(
        await prisma.customerMembership.count({
          where: { merchantId: w.a.merchantId, customer: { phoneE164: e164 } },
        }),
      ).toBe(1);
    });

    it('cannot be used to overwrite an existing customer’s name, language or consent', async () => {
      const phone = randomPhone();
      await enroll(w.a.joinReference, {
        phone,
        firstName: 'Original',
        preferredLanguage: 'EN',
        marketingConsent: true,
      }).expect(201);

      const attack = await enroll(w.a.joinReference, {
        phone,
        firstName: 'Mallory',
        preferredLanguage: 'AM',
        marketingConsent: false,
      }).expect(201);
      expect(attack.body.status).toBe('EXISTING');
      // The response echoes the submission; it never reveals stored data.
      expect(JSON.stringify(attack.body)).not.toContain('Original');

      const customer = await prisma.customer.findFirstOrThrow({
        where: { merchantId: w.a.merchantId, phoneE164: `+251${phone.slice(1)}` },
        include: { consents: true },
      });
      expect(customer).toMatchObject({ firstName: 'Original', preferredLanguage: 'EN' });
      expect(customer.consents.filter((c) => c.type === 'MARKETING').map((c) => c.action)).toEqual([
        'GRANTED',
      ]);
    });

    it('lets only one of several simultaneous sign-ups for one phone create anything', async () => {
      const phone = randomPhone();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => enroll(w.a.joinReference, { phone })),
      );
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(results.filter((r) => r.body.status === 'CREATED')).toHaveLength(1);
      expect(results.filter((r) => r.body.card !== null)).toHaveLength(1);
      expect(
        await prisma.customer.count({
          where: { merchantId: w.a.merchantId, phoneE164: `+251${phone.slice(1)}` },
        }),
      ).toBe(1);
    });

    it('validates input and requires explicit consent to the terms', async () => {
      const ref = w.a.joinReference;
      await enroll(ref, { acceptTerms: false }).expect(400);
      await enroll(ref, { acceptTerms: undefined }).expect(400);
      await enroll(ref, { acceptTerms: 'yes' }).expect(400);
      await enroll(ref, { phone: '12345' }).expect(400);
      await enroll(ref, { phone: '+254711000000' }).expect(400);
      await enroll(ref, { phone: '0611234567' }).expect(400);
      await enroll(ref, { phone: undefined }).expect(400);
      await enroll(ref, { firstName: '' }).expect(400);
      await enroll(ref, { firstName: '<script>alert(1)</script>' }).expect(400);
      await enroll(ref, { firstName: 'x'.repeat(61) }).expect(400);
      await enroll(ref, { preferredLanguage: 'FR' }).expect(400);
      await enroll(ref, { marketingConsent: 'true' }).expect(400);
      await enroll(ref, { merchantId: w.b.merchantId }).expect(400);
      await enroll(ref, { programId: programB.id }).expect(400);
      await enroll(ref, { firstName: 'አበበ ከበደ' }).expect(201);
      await enroll(ref, { firstName: "Abebe G/Michael O'Neil-Smith" }).expect(201);
    });

    it('rejects a stale consent version but accepts the current one', async () => {
      const info = await http().get(`/api/v1/join/${w.a.joinReference}`).expect(200);
      const stale = await enroll(w.a.joinReference, { consentVersion: '1999-01-v0' }).expect(409);
      expect(stale.body.error.code).toBe('CONSENT_VERSION_STALE');
      await enroll(w.a.joinReference, { consentVersion: info.body.consent.version }).expect(201);
    });
  });

  describe('wallet links when no wallet is configured', () => {
    it('offers only the web card and refuses Apple and Google politely', async () => {
      const res = await enroll(w.a.joinReference).expect(201);
      const token = res.body.card.token as string;
      for (const provider of ['APPLE', 'GOOGLE']) {
        const refused = await http()
          .post('/api/v1/card/wallet/links')
          .send({ cardToken: token, provider })
          .expect(409);
        expect(refused.body.error.code).toBe('PROVIDER_NOT_AVAILABLE');
      }
      const web = await http()
        .post('/api/v1/card/wallet/links')
        .send({ cardToken: token, provider: 'WEB' })
        .expect(200);
      expect(web.body.kind).toBe('NONE');
      const card = await http().post('/api/v1/card/web').send({ cardToken: token }).expect(200);
      expect(card.body.progress).toMatchObject({ current: 0, required: 6 });
    });
  });

  describe('merchant isolation', () => {
    it('keeps the same phone as unrelated customers at two merchants', async () => {
      const phone = randomPhone();
      const a = await enroll(w.a.joinReference, { phone, firstName: 'Alem' }).expect(201);
      const b = await enroll(w.b.joinReference, { phone, firstName: 'Berhane' }).expect(201);
      expect(a.body.status).toBe('CREATED');
      expect(b.body.status).toBe('CREATED');

      const rows = await prisma.customer.findMany({
        where: { phoneE164: `+251${phone.slice(1)}` },
      });
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((r) => r.merchantId))).toEqual(
        new Set([w.a.merchantId, w.b.merchantId]),
      );
      expect(rows.find((r) => r.merchantId === w.a.merchantId)?.firstName).toBe('Alem');
      expect(rows.find((r) => r.merchantId === w.b.merchantId)?.firstName).toBe('Berhane');
    });

    it('gives a brand-new number and a number known only to another merchant identical responses', async () => {
      const knownElsewhere = randomPhone();
      await enroll(w.b.joinReference, { phone: knownElsewhere }).expect(201);

      const fresh = await enroll(w.a.joinReference, { phone: randomPhone() }).expect(201);
      const other = await enroll(w.a.joinReference, { phone: knownElsewhere }).expect(201);

      const shape = (r: { body: Record<string, unknown> }) => ({
        status: r.body.status,
        keys: Object.keys(r.body).sort(),
        cardKeys: Object.keys((r.body.card as object) ?? {}),
      });
      expect(shape(other)).toEqual(shape(fresh));
      expect(other.body.status).toBe('CREATED');
      // And nothing from the other merchant appears in the answer.
      const text = JSON.stringify(other.body);
      expect(text).not.toContain(w.b.merchantId);
      expect(text).not.toContain(programB.id);
    });

    it('never shows another merchant’s customers or memberships in this merchant’s API', async () => {
      const phone = randomPhone();
      const created = await enroll(w.b.joinReference, { phone, firstName: 'OnlyAtB' }).expect(201);
      const owner = await as(w.a.owner.email);
      const res = await http()
        .get(`/api/v1/merchant/customers?q=OnlyAtB`)
        .set('Authorization', owner)
        .expect(200);
      expect(res.body.items).toHaveLength(0);
      const m = await prisma.customerMembership.findFirstOrThrow({
        where: { tokenHash: sha(created.body.card.token) },
      });
      await http()
        .post(`/api/v1/merchant/memberships/${m.id}/reissue-card`)
        .set('Authorization', owner)
        .expect(404);
    });
  });

  describe('marketing consent withdrawal', () => {
    async function joined(marketing = true) {
      const res = await enroll(w.a.joinReference, { marketingConsent: marketing }).expect(201);
      const membership = await prisma.customerMembership.findFirstOrThrow({
        where: { tokenHash: sha(res.body.card.token) },
      });
      return {
        token: res.body.card.token as string,
        membership,
        customerId: membership.customerId,
      };
    }

    it('lets the customer withdraw with their card, keeping the membership and card', async () => {
      const { token, membership, customerId } = await joined();
      await http()
        .post('/api/v1/card/consent/marketing/withdraw')
        .send({ cardToken: token })
        .expect(204);

      const rows = await prisma.customerConsent.findMany({
        where: { customerId, type: 'MARKETING' },
        orderBy: { occurredAt: 'asc' },
      });
      expect(rows.map((r) => r.action)).toEqual(['GRANTED', 'WITHDRAWN']);
      expect(rows[1]).toMatchObject({ source: 'PRIVACY_REQUEST' });
      const after = await prisma.customerMembership.findUniqueOrThrow({
        where: { id: membership.id },
      });
      expect(after.status).toBe('ACTIVE');
      expect(after.tokenHash).toBe(sha(token)); // the card still works

      const owner = await as(w.a.owner.email);
      const view = await http()
        .get(`/api/v1/merchant/customers/${customerId}`)
        .set('Authorization', owner)
        .expect(200);
      expect(view.body.marketingConsent).toBe(false);
      expect(view.body.memberships[0].status).toBe('ACTIVE');
    });

    it('is idempotent and writes nothing when consent was never given', async () => {
      const { token, customerId } = await joined(true);
      await http()
        .post('/api/v1/card/consent/marketing/withdraw')
        .send({ cardToken: token })
        .expect(204);
      await http()
        .post('/api/v1/card/consent/marketing/withdraw')
        .send({ cardToken: token })
        .expect(204);
      expect(
        await prisma.customerConsent.count({
          where: { customerId, type: 'MARKETING', action: 'WITHDRAWN' },
        }),
      ).toBe(1);

      const never = await joined(false);
      await http()
        .post('/api/v1/card/consent/marketing/withdraw')
        .send({ cardToken: never.token })
        .expect(204);
      expect(
        await prisma.customerConsent.count({
          where: { customerId: never.customerId, type: 'MARKETING' },
        }),
      ).toBe(0);
    });

    it('rejects unknown and malformed cards', async () => {
      await http()
        .post('/api/v1/card/consent/marketing/withdraw')
        .send({ cardToken: 'a'.repeat(43) })
        .expect(404);
      await http()
        .post('/api/v1/card/consent/marketing/withdraw')
        .send({ cardToken: '+251911000000' + 'x'.repeat(10) })
        .expect(404);
      await http()
        .post('/api/v1/card/consent/marketing/withdraw')
        .send({ cardToken: 'short' })
        .expect(400);
    });

    it('lets managers withdraw on behalf of a customer, but not branch staff', async () => {
      const { customerId } = await joined();
      const url = `/api/v1/merchant/customers/${customerId}/consents/marketing/withdraw`;
      await http()
        .post(url)
        .set('Authorization', await as(w.a.staff1.email))
        .expect(403);
      await http()
        .post(url)
        .set('Authorization', await as(w.b.owner.email))
        .expect(404);
      const res = await http()
        .post(url)
        .set('Authorization', await as(w.a.manager.email))
        .expect(200);
      expect(res.body.marketingConsent).toBe(false);
      await http()
        .post(url)
        .set('Authorization', await as(w.a.manager.email))
        .expect(200); // idempotent
      const rows = await prisma.customerConsent.findMany({
        where: { customerId, type: 'MARKETING' },
      });
      expect(rows.filter((r) => r.action === 'WITHDRAWN')).toHaveLength(1);
      expect(rows.find((r) => r.action === 'WITHDRAWN')?.source).toBe('STAFF_ASSISTED');
      expect(
        await prisma.auditEvent.count({
          where: { action: 'customer.marketing_consent_withdrawn', targetId: customerId },
        }),
      ).toBe(1);
    });
  });

  describe('card reissue', () => {
    it('replaces the token, kills the old one and flags wallet passes for refresh', async () => {
      const res = await enroll(w.a.joinReference).expect(201);
      const oldToken: string = res.body.card.token;
      const membership = await prisma.customerMembership.findFirstOrThrow({
        where: { tokenHash: sha(oldToken) },
      });
      const before = await prisma.walletPass.findFirstOrThrow({
        where: { membershipId: membership.id },
      });

      await http()
        .post(`/api/v1/merchant/memberships/${membership.id}/reissue-card`)
        .set('Authorization', await as(w.a.staff1.email))
        .expect(403);
      const issued = await http()
        .post(`/api/v1/merchant/memberships/${membership.id}/reissue-card`)
        .set('Authorization', await as(w.a.manager.email))
        .expect(201);
      const newToken: string = issued.body.token;
      expect(newToken).not.toBe(oldToken);

      await http()
        .post('/api/v1/card/consent/marketing/withdraw')
        .send({ cardToken: oldToken })
        .expect(404);
      await http()
        .post('/api/v1/card/consent/marketing/withdraw')
        .send({ cardToken: newToken })
        .expect(204);

      const after = await prisma.walletPass.findFirstOrThrow({
        where: { membershipId: membership.id },
      });
      expect(after.passVersion).toBe(before.passVersion + 1);
      expect(after.syncStatus).toBe('PENDING');
      expect(
        await prisma.auditEvent.count({
          where: { action: 'membership.card_reissued', targetId: membership.id },
        }),
      ).toBe(1);
    });
  });
});

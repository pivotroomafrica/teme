import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { World, createActiveProgram, createWorld, randomPhone } from '../support/auth-fixture';

describe('Public enrollment rate limiting (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let w: World;

  beforeAll(async () => {
    // Config is read when the app module loads, so set the strict limit before importing it.
    process.env.ENROLL_RATE_LIMIT_MAX = '3';
    prisma = new PrismaClient();
    w = await createWorld(prisma);
    await createActiveProgram(prisma, w.a.merchantId);
    const { createTestApp } = await import('../support/create-test-app');
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const enroll = () =>
    request(app.getHttpServer()).post(`/api/v1/join/${w.a.joinReference}/enroll`).send({
      phone: randomPhone(),
      firstName: 'Rate',
      preferredLanguage: 'EN',
      acceptTerms: true,
    });

  it('throttles repeated enrollments from one client with RATE_LIMITED', async () => {
    for (let i = 0; i < 3; i++) await enroll().expect(201);
    const res = await enroll().expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    // Nothing was created by the rejected request.
    expect(await prisma.customer.count({ where: { merchantId: w.a.merchantId } })).toBe(3);
  });

  it('does not throttle the read-only join page with the enrollment budget', async () => {
    for (let i = 0; i < 6; i++) {
      await request(app.getHttpServer()).get(`/api/v1/join/${w.a.joinReference}`).expect(200);
    }
  });
});

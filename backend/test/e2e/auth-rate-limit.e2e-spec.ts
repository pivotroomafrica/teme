import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { TEST_PASSWORD, createWorld, World } from '../support/auth-fixture';

describe('Login rate limiting (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let world: World;

  beforeAll(async () => {
    // Config is read when the app module loads, so set the strict limit before importing it.
    process.env.LOGIN_RATE_LIMIT_MAX = '3';
    prisma = new PrismaClient();
    world = await createWorld(prisma);
    const { createTestApp } = await import('../support/create-test-app');
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const login = (email: string, password: string) =>
    request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password });

  it('throttles repeated login attempts per IP and email with a RATE_LIMITED error', async () => {
    const email = world.a.owner.email;
    for (let i = 0; i < 3; i++) await login(email, 'wrong').expect(401);
    const res = await login(email, TEST_PASSWORD).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('does not let one email exhaust the budget for another', async () => {
    await login(world.b.owner.email, TEST_PASSWORD).expect(200);
  });

  it('does not apply the strict login budget to other routes', async () => {
    for (let i = 0; i < 6; i++)
      await request(app.getHttpServer()).get('/api/v1/health').expect(200);
  });
});

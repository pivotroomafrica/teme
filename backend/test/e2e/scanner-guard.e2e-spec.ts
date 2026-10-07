import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import {
  World,
  bearer,
  createActiveProgram,
  createCard,
  createWorld,
  login,
} from '../support/auth-fixture';

describe('Scanner double-scan guard (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let w: World;

  beforeAll(async () => {
    // Config is read when the app module loads, so set the guard before importing it.
    process.env.SCANNER_MIN_INTERVAL_SECONDS = '5';
    prisma = new PrismaClient();
    w = await createWorld(prisma);
    const { createTestApp } = await import('../support/create-test-app');
    app = await createTestApp();
  });

  afterAll(async () => {
    process.env.SCANNER_MIN_INTERVAL_SECONDS = '0';
    await app.close();
    await prisma.$disconnect();
  });

  it('blocks an accidental second scan even when the program has no cooldown', async () => {
    const program = await createActiveProgram(prisma, w.a.merchantId, { cooldownMinutes: 0 });
    const c = await createCard(prisma, w.a.merchantId, program.id);
    const auth = bearer(await login(app, w.a.staff1.email));
    const scan = () =>
      request(app.getHttpServer())
        .post('/api/v1/scanner/stamps')
        .set('Authorization', auth)
        .set('Idempotency-Key', randomUUID())
        .send({ cardToken: c.token });

    const first = await scan().expect(200);
    expect(first.body.outcome).toBe('STAMPED');
    const second = await scan().expect(200);
    expect(second.body).toMatchObject({ outcome: 'REJECTED', reason: 'COOLDOWN_ACTIVE' });
    expect(second.body.retryAfterSeconds).toBeLessThanOrEqual(5);
    expect(await prisma.stampEvent.count({ where: { membershipId: c.membershipId } })).toBe(1);
  });
});

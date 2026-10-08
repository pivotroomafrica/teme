import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from '../support/create-test-app';

/** The production onboarding path: no seed data, an operator runs the bootstrap CLI. */
describe('Production bootstrap CLI (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const tag = randomUUID().slice(0, 8);
  const password = 'Correct-Horse-Battery-9';

  const cli = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(
      process.execPath,
      ['node_modules/ts-node/dist/bin.js', 'prisma/bootstrap.ts', ...args],
      {
        encoding: 'utf8',
        env: { ...process.env, ...env },
      },
    );

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('creates a platform administrator who can sign in, and refuses a short password or a duplicate', async () => {
    const email = `ops-${tag}@t.test`;
    expect(cli(['admin', email, 'Ops'], { BOOTSTRAP_PASSWORD: 'short' }).status).not.toBe(0);
    const ok = cli(['admin', email, 'Ops'], { BOOTSTRAP_PASSWORD: password });
    expect(ok.status).toBe(0);
    expect(ok.stdout).not.toContain(password);
    expect(cli(['admin', email, 'Ops'], { BOOTSTRAP_PASSWORD: password }).status).not.toBe(0);

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    expect(res.body.user).toMatchObject({ accountType: 'PLATFORM_ADMIN' });
    expect(
      await prisma.auditEvent.count({ where: { action: 'platform.admin_bootstrapped' } }),
    ).toBeGreaterThan(0);
  }, 120_000);

  it('creates a merchant whose owner activates the account with the one-time token', async () => {
    const slug = `boot-${tag}`;
    const email = `owner-${tag}@t.test`;
    const run = cli(['merchant', slug, 'Bootstrap Cafe', email, 'Owner One']);
    expect(run.status).toBe(0);
    const token = run.stdout.trim().split(/\r?\n/).pop()!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    // The account cannot be used before the invitation is accepted.
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/invitations/accept')
      .send({ token, password })
      .expect((r) => expect([200, 201, 204]).toContain(r.status));
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body.role ?? me.body.roleKey).toBe('OWNER');

    // Only the hash of the token is stored, and the token cannot be reused.
    expect(JSON.stringify(await prisma.staffInvitation.findMany())).not.toContain(token);
    await request(app.getHttpServer())
      .post('/api/v1/auth/invitations/accept')
      .send({ token, password })
      .expect(400);
    expect(cli(['merchant', slug, 'Again', email, 'Owner']).status).not.toBe(0);
  }, 120_000);
});

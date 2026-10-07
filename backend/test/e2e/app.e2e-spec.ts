import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../support/create-test-app';

describe('App foundation (e2e, database stubbed)', () => {
  let app: INestApplication;
  const prismaStub = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };

  beforeAll(async () => {
    app = await createTestApp(prismaStub as never);
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves liveness under /api/v1', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('reports readiness when the database responds', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('reports 503 readiness when the database is down', async () => {
    prismaStub.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503);
    expect(JSON.stringify(res.body)).not.toContain('connection refused');
  });

  it('returns the consistent error envelope for unknown routes', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope').expect(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(res.body.error.requestId).toBeTruthy();
    expect(new Date(res.body.error.timestamp).toISOString()).toBe(res.body.error.timestamp);
  });

  it('generates and echoes a request id, honoring a supplied one', async () => {
    const a = await request(app.getHttpServer()).get('/api/v1/health');
    expect(a.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const b = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('x-request-id', 'client-trace-0001');
    expect(b.headers['x-request-id']).toBe('client-trace-0001');
  });

  it('sets secure default headers', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('applies CORS from configuration only', async () => {
    const allowed = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:3001');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    const denied = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'http://evil.test');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('exposes OpenAPI docs when enabled', async () => {
    await request(app.getHttpServer()).get('/api/docs-json').expect(200);
  });
});

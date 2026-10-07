import { INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import {
  AUTHENTICATED_ONLY_KEY,
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
} from '../../src/common/decorators/access.decorators';
import { World, bearer, createWorld, login } from '../support/auth-fixture';
import { createTestApp } from '../support/create-test-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Route {
  method: string;
  /** e.g. /api/v1/merchant/customers/:customerId/data */
  path: string;
  public: boolean;
  authenticatedOnly: boolean;
  permissions: string[] | undefined;
  handler: string;
}

const NIL = '00000000-0000-4000-8000-000000000000';

/** Every public route, deliberately listed. Adding one means consciously extending this list. */
const PUBLIC_ROUTES = [
  // Health probes
  'GET /api/v1/health',
  'GET /api/v1/health/ready',
  // Sign-in flow (credentials or a refresh/invitation token are the proof)
  'POST /api/v1/auth/invitations/accept',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/logout',
  'POST /api/v1/auth/refresh',
  // Customer-facing: the customer's own card token is the credential
  'GET /api/v1/join/:joinReference',
  'POST /api/v1/join/:joinReference/enroll',
  'POST /api/v1/card/consent/marketing/withdraw',
  'POST /api/v1/card/wallet/links',
  'POST /api/v1/card/web',
  // Apple Wallet web service: protocol-defined, authenticated by the pass's own token
  'DELETE /api/v1/wallet/apple/v1/devices/:deviceId/registrations/:passTypeId/:serial',
  'GET /api/v1/wallet/apple/download/:serial',
  'GET /api/v1/wallet/apple/v1/devices/:deviceId/registrations/:passTypeId',
  'GET /api/v1/wallet/apple/v1/passes/:passTypeId/:serial',
  'POST /api/v1/wallet/apple/v1/devices/:deviceId/registrations/:passTypeId/:serial',
  'POST /api/v1/wallet/apple/v1/log',
];
/** Defined by Apple's protocol and deliberately left out of Swagger. */
const UNDOCUMENTED = /^\/api\/v1\/wallet\/apple\//;

describe('Production hardening (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let w: World;
  let routes: Route[];
  const http = () => request(app.getHttpServer());

  function collectRoutes(): Route[] {
    const reflector = app.get(Reflector);
    const found: Route[] = [];
    for (const module of app.get(ModulesContainer).values()) {
      for (const wrapper of module.controllers.values()) {
        const controller = wrapper.metatype as (new (...a: unknown[]) => object) | null;
        if (!controller?.prototype) continue;
        const base = Reflect.getMetadata(PATH_METADATA, controller) as
          string | string[] | undefined;
        const basePath = (Array.isArray(base) ? base[0] : base) ?? '';
        for (const name of Object.getOwnPropertyNames(controller.prototype)) {
          const handler = controller.prototype[name as keyof object] as unknown as () => void;
          if (typeof handler !== 'function' || name === 'constructor') continue;
          const verb = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
          if (verb === undefined) continue;
          const sub = Reflect.getMetadata(PATH_METADATA, handler) as string | string[];
          const subPath = (Array.isArray(sub) ? sub[0] : sub) ?? '';
          const targets = [handler, controller];
          found.push({
            method: RequestMethod[verb]!,
            path: `/api/v1/${[basePath, subPath].join('/')}`
              .replace(/\/+/g, '/')
              .replace(/\/$/, ''),
            public: !!reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets),
            authenticatedOnly: !!reflector.getAllAndOverride<boolean>(
              AUTHENTICATED_ONLY_KEY,
              targets,
            ),
            permissions: reflector.getAllAndOverride<string[] | undefined>(
              PERMISSIONS_KEY,
              targets,
            ),
            handler: `${controller.name}.${name}`,
          });
        }
      }
    }
    return found;
  }

  const concrete = (path: string) => path.replace(/:[A-Za-z]+/g, NIL);
  const send = (r: Route, auth?: string) => {
    let req = http()[r.method.toLowerCase() as 'get'](concrete(r.path));
    if (auth) req = req.set('Authorization', auth);
    return r.method === 'GET' || r.method === 'DELETE' ? req : req.send({});
  };

  beforeAll(async () => {
    prisma = new PrismaClient();
    w = await createWorld(prisma);
    app = await createTestApp();
    routes = collectRoutes();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('authorization coverage', () => {
    it('discovers the whole API', () => {
      expect(routes.length).toBeGreaterThan(80);
    });

    it('declares exactly one access rule on every route', () => {
      const undeclared = routes
        .filter(
          (r) =>
            [r.public, r.authenticatedOnly, r.permissions !== undefined].filter(Boolean).length !==
            1,
        )
        .map((r) => `${r.method} ${r.path} (${r.handler})`);
      expect(undeclared).toEqual([]);
    });

    it('keeps the list of unauthenticated routes exactly as intended', () => {
      const actual = routes
        .filter((r) => r.public)
        .map((r) => `${r.method} ${r.path}`)
        .sort();
      expect(actual).toEqual([...PUBLIC_ROUTES].sort());
    });

    it('answers 401 on every protected route without credentials or with a bad token', async () => {
      const failures: string[] = [];
      for (const r of routes.filter((x) => !x.public)) {
        for (const auth of [undefined, 'Bearer not.a.token', 'Basic abc']) {
          const res = await send(r, auth);
          if (res.status !== 401)
            failures.push(`${r.method} ${r.path} -> ${res.status} (${auth ?? 'no auth'})`);
        }
      }
      expect(failures).toEqual([]);
    }, 120_000);

    it('denies every role every route it lacks the permission for (authorization matrix)', async () => {
      const roleKeys = ['STAFF', 'MANAGER', 'OWNER', 'PLATFORM_ADMIN'] as const;
      const granted = new Map<string, Set<string>>();
      for (const key of roleKeys) {
        const rows = await prisma.rolePermission.findMany({
          where: { role: { key } },
          include: { permission: true },
        });
        granted.set(key, new Set(rows.map((r) => r.permission.key)));
      }
      const users = {
        STAFF: w.a.staff1,
        MANAGER: w.a.manager,
        OWNER: w.a.owner,
        PLATFORM_ADMIN: { email: w.platformAdmin.email },
      } as const;
      const tokens = new Map<string, string>();
      for (const key of roleKeys) tokens.set(key, bearer(await login(app, users[key].email)));

      const failures: string[] = [];
      let denials = 0;
      for (const r of routes.filter((x) => x.permissions && x.permissions.length)) {
        for (const key of roleKeys) {
          const isPlatform = key === 'PLATFORM_ADMIN';
          const allowed = r.permissions!.every((p) =>
            p.startsWith('platform:')
              ? isPlatform && granted.get(key)!.has(p)
              : !isPlatform && granted.get(key)!.has(p),
          );
          if (allowed) continue; // not executed: it would perform the action
          denials++;
          const res = await send(r, tokens.get(key));
          if (res.status !== 403) failures.push(`${key} ${r.method} ${r.path} -> ${res.status}`);
        }
      }
      expect(denials).toBeGreaterThan(100);
      expect(failures).toEqual([]);
    }, 180_000);

    it('never grants platform administrators merchant data permissions, or merchants platform ones', async () => {
      const admin = await prisma.rolePermission.findMany({
        where: { role: { key: 'PLATFORM_ADMIN' } },
        include: { permission: true },
      });
      expect(admin.every((p) => p.permission.key.startsWith('platform:'))).toBe(true);
      const merchant = await prisma.rolePermission.findMany({
        where: { role: { key: { in: ['OWNER', 'MANAGER', 'STAFF'] } } },
        include: { permission: true },
      });
      expect(merchant.some((p) => p.permission.key.startsWith('platform:'))).toBe(false);
    });
  });

  describe('API documentation', () => {
    let doc: Json;
    beforeAll(async () => {
      doc = (await http().get('/api/docs-json').expect(200)).body;
    });
    const toTemplate = (p: string) => p.replace(/:([A-Za-z]+)/g, '{$1}');

    it('documents every route, with a summary and a tag', () => {
      const missing: string[] = [];
      for (const r of routes.filter((x) => !UNDOCUMENTED.test(x.path))) {
        const op = doc.paths?.[toTemplate(r.path)]?.[r.method.toLowerCase()];
        if (!op) missing.push(`${r.method} ${r.path}: not in OpenAPI`);
        else if (!op.summary || !op.tags?.length)
          missing.push(`${r.method} ${r.path}: no summary/tag`);
      }
      expect(missing).toEqual([]);
    });

    it('marks exactly the protected routes as needing a bearer token', () => {
      const wrong: string[] = [];
      for (const r of routes.filter((x) => !UNDOCUMENTED.test(x.path))) {
        const op = doc.paths?.[toTemplate(r.path)]?.[r.method.toLowerCase()];
        const secured = Array.isArray(op?.security) && op.security.length > 0;
        if (secured === r.public)
          wrong.push(`${r.method} ${r.path}: public=${r.public} secured=${secured}`);
      }
      expect(wrong).toEqual([]);
    });
  });

  describe('transport security', () => {
    it('sends security headers and never caches API responses', async () => {
      const res = await http().get('/api/v1/health').expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['strict-transport-security']).toMatch(/max-age=/);
      expect(res.headers['x-frame-options']).toBeDefined();
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-request-id']).toBeDefined();
    });

    it('allows only configured browser origins', async () => {
      const allowed = await http()
        .options('/api/v1/auth/login')
        .set('Origin', 'http://localhost:3001')
        .set('Access-Control-Request-Method', 'POST')
        .expect(204);
      expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3001');
      expect(allowed.headers['access-control-allow-credentials']).toBe('true');
      const denied = await http()
        .options('/api/v1/auth/login')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'POST');
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('error responses', () => {
    const expectShape = (body: Json, code: string) => {
      expect(body.error).toMatchObject({
        code,
        message: expect.any(String),
        requestId: expect.any(String),
        timestamp: expect.any(String),
      });
      expect(JSON.stringify(body)).not.toMatch(/node_modules|\bat\s+\S+\s+\(|prisma|stack/i);
    };

    it('uses one error shape for unknown routes', async () => {
      const res = await http().get('/api/v1/nope').expect(404);
      expectShape(res.body, 'NOT_FOUND');
    });

    it('rejects malformed JSON with a clean 400', async () => {
      const res = await http()
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": ')
        .expect(400);
      expectShape(res.body, 'VALIDATION_FAILED');
    });

    it('rejects oversized bodies with 413 instead of buffering them', async () => {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'a@b.test', password: 'x'.repeat(300_000) })
        .expect(413);
      expect(res.body.error.requestId).toEqual(expect.any(String));
    });

    it('rejects unknown fields and wrong types', async () => {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'a@b.test', password: 'x', isAdmin: true })
        .expect(400);
      expectShape(res.body, 'VALIDATION_FAILED');
    });
  });
});

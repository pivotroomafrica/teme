import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { unzipSync, strFromU8 } from 'fflate';
import request from 'supertest';
import { deriveAppleAuthToken, signLinkToken } from '../../src/modules/wallet/domain/credentials';
import {
  TestCard,
  World,
  bearer,
  createActiveProgram,
  createCard,
  createWorld,
  login,
} from '../support/auth-fixture';
import { MockGoogle } from '../support/mock-google';
import {
  TestAppleCredentials,
  TestGoogleCredentials,
  createAppleCredentials,
  createGoogleCredentials,
} from '../support/wallet-credentials';

jest.setTimeout(180_000);

const PASS_TYPE = 'pass.test.temelashcard';
const ISSUER = '3388000000012345678';
const SECRET = process.env.WALLET_BARCODE_SECRET as string;

/**
 * "Live" mode with the real Apple signer and the real Google client, but throw-away credentials and a
 * local stand-in for Google's servers. Proves the production code paths work end to end over HTTP.
 */
describe('Wallet passes in live mode (e2e, generated credentials + local Google stand-in)', () => {
  let apple: TestAppleCredentials;
  let google: TestGoogleCredentials;
  let mock: MockGoogle;
  let prisma: PrismaClient;
  let w: World;
  let program: { id: string };
  const saved: Record<string, string | undefined> = {};

  /** The app reads its configuration when its module is first imported, so load a fresh copy each time. */
  const loadApp = async () => {
    jest.resetModules();
    const { createTestApp } = await import('../support/create-test-app');
    const { OutboxWorker } = await import('../../src/modules/jobs');
    return { createTestApp, OutboxWorker };
  };
  const setEnv = (values: Record<string, string>) => {
    for (const [k, v] of Object.entries(values)) {
      if (!(k in saved)) saved[k] = process.env[k];
      process.env[k] = v;
    }
  };
  const liveEnv = () => ({
    WALLET_MODE: 'live',
    WALLET_APPLE_ENABLED: 'true',
    WALLET_GOOGLE_ENABLED: 'true',
    WALLET_PUBLIC_BASE_URL: 'https://api.example.test',
    APPLE_PASS_TYPE_ID: PASS_TYPE,
    APPLE_TEAM_ID: 'TEAM123456',
    APPLE_PASS_CERT_PATH: apple.certPath,
    APPLE_PASS_KEY_PATH: apple.keyPath,
    APPLE_WWDR_CERT_PATH: apple.wwdrPath,
    GOOGLE_WALLET_ENV: 'demo',
    GOOGLE_WALLET_ISSUER_ID: ISSUER,
    GOOGLE_WALLET_SERVICE_ACCOUNT_KEY_PATH: google.keyPath,
    GOOGLE_WALLET_DEFAULT_LOGO_URL: 'https://cdn.example.test/logo.png',
    GOOGLE_WALLET_ORIGINS: 'https://app.example.test',
    GOOGLE_WALLET_API_BASE: mock.url,
    GOOGLE_OAUTH_TOKEN_URL: `${mock.url}/token`,
  });

  beforeAll(async () => {
    apple = createAppleCredentials();
    google = createGoogleCredentials();
    mock = new MockGoogle(google);
    await mock.start();
    prisma = new PrismaClient();
    await prisma.outboxJob.updateMany({
      where: { status: { in: ['PENDING', 'FAILED', 'PROCESSING'] } },
      data: { status: 'COMPLETED' },
    });
    w = await createWorld(prisma);
    program = await createActiveProgram(prisma, w.a.merchantId, {
      stampsRequired: 3,
      cooldownMinutes: 0,
    });
  });

  afterAll(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await mock.stop();
    await prisma.$disconnect();
  });

  it('refuses to start when an enabled provider has unusable credentials', async () => {
    setEnv({ ...liveEnv(), APPLE_PASS_CERT_PATH: apple.certPath + '.missing' });
    await expect((await loadApp()).createTestApp()).rejects.toThrow(/APPLE_PASS_CERT_PATH/);
    setEnv({ ...liveEnv(), GOOGLE_WALLET_SERVICE_ACCOUNT_KEY_PATH: google.keyPath + '.missing' });
    await expect((await loadApp()).createTestApp()).rejects.toThrow(
      /GOOGLE_WALLET_SERVICE_ACCOUNT_KEY_PATH/,
    );
  });

  describe('with valid credentials', () => {
    let app: INestApplication;
    let owner: string;
    let card: TestCard;
    let OutboxWorkerClass: Awaited<ReturnType<typeof loadApp>>['OutboxWorker'];
    const http = () => request(app.getHttpServer());

    beforeAll(async () => {
      setEnv(liveEnv());
      const loaded = await loadApp();
      app = await loaded.createTestApp();
      OutboxWorkerClass = loaded.OutboxWorker;
      owner = bearer(await login(app, w.a.owner.email));
      card = await createCard(prisma, w.a.merchantId, program.id, 'Selam');
    });
    afterAll(async () => {
      await app.close();
    });

    it('delivers a genuinely signed .pkpass over HTTP, as a binary download', async () => {
      const res = await http()
        .post('/api/v1/card/wallet/links')
        .send({ cardToken: card.token, provider: 'APPLE' })
        .expect(200);
      expect(res.body.kind).toBe('DOWNLOAD');
      expect(res.body.url).toMatch(
        /^https:\/\/api\.example\.test\/api\/v1\/wallet\/apple\/download\//,
      );

      const pass = await prisma.walletPass.findFirstOrThrow({
        where: { membershipId: card.membershipId, provider: 'APPLE' },
      });
      const token = signLinkToken(SECRET, pass.id, new Date(Date.now() + 60_000));
      const file = await http()
        .get(`/api/v1/wallet/apple/download/${pass.id}?t=${encodeURIComponent(token)}`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(file.headers['content-type']).toContain('application/vnd.apple.pkpass');
      expect(file.headers['content-disposition']).toContain('.pkpass');

      const body = file.body as Buffer;
      expect(body.subarray(0, 2).toString()).toBe('PK'); // a zip archive, not a JSON-encoded buffer
      const files = unzipSync(new Uint8Array(body));
      expect(Object.keys(files)).toEqual(
        expect.arrayContaining(['pass.json', 'manifest.json', 'signature']),
      );
      const passJson = JSON.parse(strFromU8(files['pass.json'] as Uint8Array));
      expect(passJson).toMatchObject({
        serialNumber: pass.id,
        passTypeIdentifier: PASS_TYPE,
        teamIdentifier: 'TEAM123456',
        webServiceURL: 'https://api.example.test/api/v1/wallet/apple',
        authenticationToken: deriveAppleAuthToken(SECRET, pass.id),
      });
      expect(passJson.barcodes[0].message).toHaveLength(43);

      // The same file comes from Apple's pull endpoint, with Last-Modified for conditional requests.
      const pull = await http()
        .get(`/api/v1/wallet/apple/v1/passes/${PASS_TYPE}/${pass.id}`)
        .set('Authorization', `ApplePass ${deriveAppleAuthToken(SECRET, pass.id)}`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect((pull.body as Buffer).subarray(0, 2).toString()).toBe('PK');
      expect(pull.headers['last-modified']).toBeTruthy();
    });

    it('creates the Google class and object through the real client, signs the save link, and keeps it updated', async () => {
      const res = await http()
        .post('/api/v1/card/wallet/links')
        .send({ cardToken: card.token, provider: 'GOOGLE' })
        .expect(200);
      expect(res.body).toMatchObject({ provider: 'GOOGLE', kind: 'REDIRECT' });
      expect(res.body.url).toMatch(
        /^https:\/\/pay\.google\.com\/gp\/v\/save\/[\w-]+\.[\w-]+\.[\w-]+$/,
      );

      const pass = await prisma.walletPass.findFirstOrThrow({
        where: { membershipId: card.membershipId, provider: 'GOOGLE' },
      });
      const objectId = `${ISSUER}.pass_${pass.id.replace(/-/g, '')}`;
      expect(pass.providerPassId).toBe(objectId);
      expect([...mock.classes.keys()]).toEqual([
        `${ISSUER}.program_${program.id.replace(/-/g, '')}`,
      ]);
      expect(mock.objects.get(objectId)).toMatchObject({
        state: 'ACTIVE',
        accountName: 'Selam',
        loyaltyPoints: { balance: { string: '0 / 3' } },
      });

      // A stamp is delivered to the (stand-in) Google servers by the outbox worker.
      await http()
        .post('/api/v1/scanner/stamps')
        .set('Authorization', owner)
        .set('Idempotency-Key', randomUUID())
        .send({ cardToken: card.token, branchId: w.a.branches[0] })
        .expect(200);
      expect(mock.objects.get(objectId)).toMatchObject({
        loyaltyPoints: { balance: { string: '0 / 3' } },
      }); // not yet: nothing happens inside the stamp request
      const worker = app.get(OutboxWorkerClass);
      for (let i = 0; i < 5 && (await worker.processBatch(50)).claimed > 0; i++);
      expect(mock.objects.get(objectId)).toMatchObject({
        loyaltyPoints: { balance: { string: '1 / 3' } },
      });
      expect(await prisma.walletPass.findUniqueOrThrow({ where: { id: pass.id } })).toMatchObject({
        syncStatus: 'SYNCED',
        lastError: null,
      });
    });

    it('reports an unreachable Google as a safe error and leaves the pass to be finished later', async () => {
      const c = await createCard(prisma, w.a.merchantId, program.id);
      mock.failWith = { status: 503, times: 5 };
      const res = await http()
        .post('/api/v1/card/wallet/links')
        .send({ cardToken: c.token, provider: 'GOOGLE' })
        .expect(502);
      expect(res.body.error.code).toBe('WALLET_PROVIDER_UNAVAILABLE');
      expect(JSON.stringify(res.body)).not.toMatch(/boom|BEGIN|503|googleapis/);
      mock.failWith = null;
      const pending = await prisma.walletPass.findFirstOrThrow({
        where: { membershipId: c.membershipId, provider: 'GOOGLE' },
      });
      expect(pending.status).toBe('PENDING');
      await http()
        .post('/api/v1/card/wallet/links')
        .send({ cardToken: c.token, provider: 'GOOGLE' })
        .expect(200);
    });
  });
});

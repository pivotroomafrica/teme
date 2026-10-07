import { createVerify } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MockGoogle } from '../../../../../test/support/mock-google';
import {
  TestGoogleCredentials,
  createGoogleCredentials,
} from '../../../../../test/support/wallet-credentials';
import type { PassState } from '../../domain/pass-state';
import { WalletProviderError } from '../wallet-provider';
import { GoogleWalletRestApi } from './google-api.client';
import { GoogleConfig, GoogleConfigError, loadGoogleConfig } from './google-config';
import { GoogleWalletAdapter } from './google.adapter';
import {
  buildLoyaltyClass,
  buildLoyaltyObject,
  buildObjectPatch,
  classIdFor,
  objectIdFor,
} from './loyalty-payloads';

jest.setTimeout(60_000);

const ISSUER = '3388000000012345678';
const PASS_ID = '0b9c7e1a-4d2f-4a8e-9b61-3c5d7f9a1e2b';
const PROGRAM_ID = '6f1d2c3b-aaaa-4bbb-8ccc-0123456789ab';

const state = (over: Partial<PassState> = {}): PassState => ({
  passId: PASS_ID,
  membershipId: 'm-1',
  programId: PROGRAM_ID,
  provider: 'GOOGLE',
  status: 'ACTIVE',
  language: 'EN',
  version: 2,
  updatedAt: new Date(),
  merchantName: { en: 'Sample Cafe', am: 'ናሙና ቡና ቤት' },
  programName: { en: 'Coffee Card', am: 'የቡና ካርድ' },
  firstName: 'Abebe',
  brandColor: '#7A4B2A',
  stampsRequired: 8,
  currentStamps: 3,
  completedCards: 0,
  rewardsAvailable: 0,
  reward: { name: { en: 'Free coffee', am: 'ነጻ ቡና' }, description: { en: 'd', am: null } },
  terms: { en: 'One stamp per visit.', am: null },
  barcode: 'C'.repeat(43),
  ...over,
});

describe('Google Wallet adapter (against a local mock of Google)', () => {
  let creds: TestGoogleCredentials;
  let google: MockGoogle;
  let config: GoogleConfig;
  let adapter: GoogleWalletAdapter;

  const build = (over: Partial<GoogleConfig> = {}) => {
    const cfg = { ...config, ...over };
    return new GoogleWalletAdapter(cfg, new GoogleWalletRestApi(cfg));
  };

  beforeAll(async () => {
    creds = createGoogleCredentials();
    google = new MockGoogle(creds);
    await google.start();
    config = loadGoogleConfig({
      environment: 'demo',
      issuerId: ISSUER,
      keyPath: creds.keyPath,
      origins: ['https://app.example.test'],
      defaultLogoUrl: 'https://cdn.example.test/logo.png',
      apiBase: google.url,
      tokenUrl: `${google.url}/token`,
    });
  });
  afterAll(() => google.stop());
  beforeEach(() => {
    google.classes.clear();
    google.objects.clear();
    google.requests.length = 0;
    google.tokenCalls = 0;
    google.failWith = null;
    google.rejectAuth = false;
    adapter = build();
  });

  describe('configuration', () => {
    it('loads a service-account key and validates the rest', () => {
      expect(config.clientEmail).toBe(creds.clientEmail);
      const bad = (over: Record<string, unknown>) => () =>
        loadGoogleConfig({
          environment: 'demo',
          issuerId: ISSUER,
          keyPath: creds.keyPath,
          origins: [],
          defaultLogoUrl: 'https://x/y.png',
          apiBase: google.url,
          tokenUrl: `${google.url}/token`,
          ...over,
        } as never);
      expect(bad({ keyPath: join(creds.dir, 'missing.json') })).toThrow(/file not found/);
      expect(bad({ issuerId: 'abc' })).toThrow(/numeric issuer id/);
      expect(bad({ defaultLogoUrl: 'http://insecure/logo.png' })).toThrow(/https/);
      const notJson = join(creds.dir, 'broken.json');
      writeFileSync(notJson, '{ nope');
      expect(bad({ keyPath: notJson })).toThrow(GoogleConfigError);
      const noKey = join(creds.dir, 'nokey.json');
      writeFileSync(noKey, JSON.stringify({ client_email: 'x@y.z' }));
      expect(bad({ keyPath: noKey })).toThrow(/missing client_email or private_key/);
      const badKey = join(creds.dir, 'badkey.json');
      writeFileSync(badKey, JSON.stringify({ client_email: 'x@y.z', private_key: 'not a key' }));
      expect(bad({ keyPath: badKey })).toThrow(/not a valid key/);
    });

    it('never echoes key material in configuration errors', () => {
      const badKey = join(creds.dir, 'badkey2.json');
      writeFileSync(
        badKey,
        JSON.stringify({ client_email: 'x@y.z', private_key: creds.privateKey.slice(0, 200) }),
      );
      try {
        loadGoogleConfig({
          environment: 'demo',
          issuerId: ISSUER,
          keyPath: badKey,
          origins: [],
          defaultLogoUrl: 'https://x/y.png',
          apiBase: google.url,
          tokenUrl: google.url,
        });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as Error).message).not.toContain('BEGIN');
        expect((e as Error).message).not.toContain(creds.dir);
      }
    });
  });

  describe('payloads', () => {
    it('models one class per program and one object per pass', () => {
      expect(classIdFor(ISSUER, PROGRAM_ID)).toBe(
        `${ISSUER}.program_6f1d2c3baaaa4bbb8ccc0123456789ab`,
      );
      expect(objectIdFor(ISSUER, PASS_ID)).toBe(`${ISSUER}.pass_0b9c7e1a4d2f4a8e9b613c5d7f9a1e2b`);
      const cls = buildLoyaltyClass(state(), config);
      expect(cls).toMatchObject({
        id: classIdFor(ISSUER, PROGRAM_ID),
        issuerName: 'Sample Cafe',
        programName: 'Coffee Card',
        hexBackgroundColor: '#7a4b2a',
        reviewStatus: 'DRAFT',
        programLogo: { sourceUri: { uri: 'https://cdn.example.test/logo.png' } },
      });
      expect(cls.localizedIssuerName.translatedValues).toEqual([
        { language: 'am', value: 'ናሙና ቡና ቤት' },
      ]);
    });

    it('supports demo and production modes', () => {
      expect(buildLoyaltyClass(state(), { ...config, environment: 'demo' }).reviewStatus).toBe(
        'DRAFT',
      );
      expect(
        buildLoyaltyClass(state(), { ...config, environment: 'production' }).reviewStatus,
      ).toBe('UNDER_REVIEW');
    });

    it('shows progress, reward and the opaque barcode, with Amharic translations', () => {
      const obj = buildLoyaltyObject(state(), config);
      expect(obj).toMatchObject({
        classId: classIdFor(ISSUER, PROGRAM_ID),
        state: 'ACTIVE',
        accountName: 'Abebe',
        barcode: { type: 'QR_CODE', value: 'C'.repeat(43) },
        loyaltyPoints: { balance: { string: '3 / 8' } },
      });
      expect(obj.loyaltyPoints.localizedLabel.translatedValues).toEqual([
        { language: 'am', value: 'ስታምፕ' },
      ]);
      expect(obj.textModulesData[0]).toMatchObject({ id: 'reward', body: 'Free coffee' });
      // No phone number, ids or internal data on the card.
      expect(JSON.stringify(obj)).not.toMatch(/\+251|membership|m-1/);
    });

    it('maps suspended and invalidated passes to INACTIVE / EXPIRED with a void barcode', () => {
      expect(buildObjectPatch(state({ status: 'SUSPENDED' })).state).toBe('INACTIVE');
      const gone = buildObjectPatch(state({ status: 'INVALIDATED' }));
      expect(gone.state).toBe('EXPIRED');
      expect(gone.barcode).toMatchObject({ value: 'VOID' });
    });
  });

  describe('create / link / update', () => {
    it('creates the class on first use and the object for the pass, authenticating as the service account', async () => {
      const res = await adapter.createPass(state());
      expect(res.providerPassId).toBe(objectIdFor(ISSUER, PASS_ID));
      expect(google.classes.has(classIdFor(ISSUER, PROGRAM_ID))).toBe(true);
      expect(google.objects.get(res.providerPassId)).toMatchObject({
        state: 'ACTIVE',
        loyaltyPoints: { balance: { string: '3 / 8' } },
      });
      expect(google.tokenCalls).toBe(1);
      expect(google.requests.every((r) => r.auth === 'Bearer tok-1')).toBe(true);
    });

    it('reuses an existing class and tolerates a repeated create', async () => {
      await adapter.createPass(state());
      const other = build();
      await other.createPass(state({ passId: '11111111-1111-4111-8111-111111111111' }));
      await build().createPass(state()); // same object again: 409 is fine
      expect(google.classes.size).toBe(1);
      expect(google.objects.size).toBe(2);
    });

    it('builds a signed "Save to Google Wallet" link that references the object, not its contents', async () => {
      const { providerPassId } = await adapter.createPass(state());
      const link = await adapter.addLink({ passId: PASS_ID, providerPassId }, state());
      expect(link.kind).toBe('REDIRECT');
      const jwt = (link.url as string).replace('https://pay.google.com/gp/v/save/', '');
      const [h, p, s] = jwt.split('.') as [string, string, string];
      expect(
        createVerify('RSA-SHA256')
          .update(`${h}.${p}`)
          .verify(creds.publicKey, Buffer.from(s, 'base64url')),
      ).toBe(true);
      const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
      expect(claims).toMatchObject({
        iss: creds.clientEmail,
        aud: 'google',
        typ: 'savetowallet',
        origins: ['https://app.example.test'],
        payload: { loyaltyObjects: [{ id: providerPassId }] },
      });
      expect(JSON.stringify(claims)).not.toMatch(/barcode|Abebe|loyaltyPoints/);
      // The private key never leaves the process.
      expect(jwt).not.toContain('PRIVATE');
    });

    it('updates progress and reward status after a stamp, redemption or reversal', async () => {
      const { providerPassId } = await adapter.createPass(state());
      await adapter.updatePass(
        { passId: PASS_ID, providerPassId },
        state({ currentStamps: 0, completedCards: 1, rewardsAvailable: 1 }),
      );
      expect(google.objects.get(providerPassId)).toMatchObject({
        loyaltyPoints: { balance: { string: '0 / 8' } },
        textModulesData: expect.arrayContaining([
          expect.objectContaining({ id: 'ready', body: '1' }),
        ]),
      });
    });

    it('suspends and invalidates passes', async () => {
      const { providerPassId } = await adapter.createPass(state());
      const ref = { passId: PASS_ID, providerPassId };
      await adapter.suspendPass(ref, state({ status: 'SUSPENDED' }));
      expect(google.objects.get(providerPassId)).toMatchObject({ state: 'INACTIVE' });
      await adapter.suspendPass(ref, state({ status: 'INVALIDATED' }));
      expect(google.objects.get(providerPassId)).toMatchObject({
        state: 'EXPIRED',
        barcode: { value: 'VOID' },
      });
    });

    it('recreates an object that was deleted on Google’s side', async () => {
      const { providerPassId } = await adapter.createPass(state());
      google.objects.delete(providerPassId);
      await adapter.updatePass({ passId: PASS_ID, providerPassId }, state({ currentStamps: 5 }));
      expect(google.objects.get(providerPassId)).toMatchObject({
        loyaltyPoints: { balance: { string: '5 / 8' } },
      });
    });

    it('re-uses the access token between calls and refreshes it if Google expires it early', async () => {
      await adapter.createPass(state());
      await adapter.updatePass(
        { passId: PASS_ID, providerPassId: objectIdFor(ISSUER, PASS_ID) },
        state(),
      );
      expect(google.tokenCalls).toBe(1);
      google.expireTokenOnce = true;
      google.tokenCalls = 0;
      const fresh = build();
      await fresh.updatePass(
        { passId: PASS_ID, providerPassId: objectIdFor(ISSUER, PASS_ID) },
        state(),
      );
      expect(google.tokenCalls).toBe(2); // first token was rejected once, a new one was minted
    });
  });

  describe('failure handling', () => {
    it('treats outages and rate limits as retryable and rejections as permanent', async () => {
      google.failWith = { status: 503, times: 1 };
      await expect(adapter.createPass(state())).rejects.toMatchObject({
        retryable: true,
        code: 'GOOGLE_HTTP_503',
      });
      google.failWith = { status: 429, times: 1 };
      await expect(build().createPass(state())).rejects.toMatchObject({ retryable: true });
      google.failWith = { status: 403, times: 1 };
      await expect(build().createPass(state())).rejects.toMatchObject({
        retryable: false,
        code: 'GOOGLE_HTTP_403',
      });
    });

    it('reports rejected service-account sign-in as a permanent configuration problem', async () => {
      google.rejectAuth = true;
      const err = await adapter.createPass(state()).catch((e) => e as WalletProviderError);
      expect(err).toBeInstanceOf(WalletProviderError);
      expect(err).toMatchObject({ retryable: false, code: 'GOOGLE_AUTH' });
    });

    it('reports an unreachable Google as retryable', async () => {
      const down = build({ apiBase: 'http://127.0.0.1:1', tokenUrl: 'http://127.0.0.1:1/token' });
      await expect(down.createPass(state())).rejects.toMatchObject({
        retryable: true,
        code: 'GOOGLE_NETWORK',
      });
    });

    it('never leaks keys, assertions, tokens or response bodies in errors', async () => {
      google.failWith = { status: 500, times: 1 };
      const err = (await adapter.createPass(state()).catch((e) => e)) as Error;
      const text = `${err.message} ${JSON.stringify(err)}`;
      expect(text).not.toContain('BEGIN');
      expect(text).not.toContain('boom with secret');
      expect(text).not.toMatch(/tok-\d/);
      expect(text).not.toContain(creds.clientEmail);
    });
  });
});

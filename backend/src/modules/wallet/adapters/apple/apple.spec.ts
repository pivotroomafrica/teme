import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import * as http2 from 'node:http2';
import { join } from 'node:path';
import forge from 'node-forge';
import { unzipSync, strFromU8 } from 'fflate';
import {
  TestAppleCredentials,
  createAppleCredentials,
  createLocalhostTls,
  writeUnrelatedKey,
} from '../../../../../test/support/wallet-credentials';
import { deriveAppleAuthToken } from '../../domain/credentials';
import type { PassState } from '../../domain/pass-state';
import { WalletProviderError } from '../wallet-provider';
import { ApnsClient, PushSender } from './apns.client';
import { AppleRegistrationStore, AppleWalletAdapter } from './apple.adapter';
import { AppleConfigError, loadAppleConfig } from './apple-config';
import { buildPkPass } from './pkpass.builder';

jest.setTimeout(120_000);

const SECRET = 'apple-spec-secret-apple-spec-secret-123';
const PASS_ID = '0b9c7e1a-4d2f-4a8e-9b61-3c5d7f9a1e2b';

const state = (over: Partial<PassState> = {}): PassState => ({
  passId: PASS_ID,
  membershipId: 'm-1',
  programId: 'p-1',
  provider: 'APPLE',
  status: 'ACTIVE',
  language: 'EN',
  version: 3,
  updatedAt: new Date('2026-06-01T00:00:00Z'),
  merchantName: { en: 'Sample Cafe', am: 'ናሙና ቡና ቤት' },
  programName: { en: 'Coffee Card', am: 'የቡና ካርድ' },
  firstName: 'Abebe',
  brandColor: '#7A4B2A',
  stampsRequired: 8,
  currentStamps: 3,
  completedCards: 1,
  rewardsAvailable: 1,
  reward: {
    name: { en: 'Free coffee', am: 'ነጻ ቡና' },
    description: { en: 'One free coffee', am: 'አንድ ነጻ ቡና' },
  },
  terms: { en: 'One stamp per visit.', am: 'በአንድ ጉብኝት አንድ ስታምፕ።' },
  barcode: 'B'.repeat(43),
  ...over,
});

let creds: TestAppleCredentials;
const input = (over: Record<string, unknown> = {}) => ({
  passTypeId: 'pass.test.temelashcard',
  teamId: 'TEAM123456',
  organizationName: 'TemelashCard',
  apnsHost: 'api.push.apple.com',
  webServiceUrl: 'https://api.example.test/api/v1/wallet/apple',
  certPath: creds.certPath,
  keyPath: creds.keyPath,
  wwdrPath: creds.wwdrPath,
  ...over,
});

beforeAll(() => {
  creds = createAppleCredentials();
});

describe('loadAppleConfig', () => {
  it('loads valid PEM credentials', () => {
    const cfg = loadAppleConfig(input());
    expect(cfg.passTypeId).toBe('pass.test.temelashcard');
    expect(cfg.certificates.signerCert.toString()).toContain('BEGIN CERTIFICATE');
  });

  it('accepts an encrypted key with the right passphrase and refuses the wrong one', () => {
    const enc = createAppleCredentials({ passphrase: 'correct horse' });
    const base = { certPath: enc.certPath, keyPath: enc.keyPath, wwdrPath: enc.wwdrPath };
    expect(() => loadAppleConfig(input({ ...base, keyPassphrase: 'correct horse' }))).not.toThrow();
    expect(() => loadAppleConfig(input({ ...base, keyPassphrase: 'wrong' }))).toThrow(
      AppleConfigError,
    );
    expect(() => loadAppleConfig(input({ ...base }))).toThrow(AppleConfigError);
  });

  it('fails clearly for missing files, bad PEM, expired certificates and mismatched keys', () => {
    expect(() => loadAppleConfig(input({ certPath: join(creds.dir, 'nope.pem') }))).toThrow(
      /APPLE_PASS_CERT_PATH: file not found/,
    );
    const junk = join(creds.dir, 'junk.pem');
    writeFileSync(junk, 'not a certificate');
    expect(() => loadAppleConfig(input({ certPath: junk }))).toThrow(/PEM-encoded/);
    expect(() => loadAppleConfig(input({ keyPath: junk }))).toThrow(/key cannot be read/);
    const expired = createAppleCredentials({ expired: true });
    expect(() =>
      loadAppleConfig(
        input({ certPath: expired.certPath, keyPath: expired.keyPath, wwdrPath: expired.wwdrPath }),
      ),
    ).toThrow(/expired/);
    expect(() => loadAppleConfig(input({ keyPath: writeUnrelatedKey(creds.dir) }))).toThrow(
      /does not belong/,
    );
  });

  it('never puts file contents or directories into error messages', () => {
    for (const bad of [
      { keyPath: writeUnrelatedKey(creds.dir) },
      { certPath: join(creds.dir, 'missing.pem') },
    ]) {
      try {
        loadAppleConfig(input(bad));
        throw new Error('should have thrown');
      } catch (err) {
        const msg = (err as Error).message;
        expect(msg).not.toContain('BEGIN');
        expect(msg).not.toContain(creds.dir);
      }
    }
  });
});

describe('buildPkPass', () => {
  const cfg = () => loadAppleConfig(input());
  const open = (buf: Buffer) => unzipSync(new Uint8Array(buf));
  const json = (files: Record<string, Uint8Array>, name: string) =>
    JSON.parse(strFromU8(files[name] as Uint8Array));
  const token = deriveAppleAuthToken(SECRET, PASS_ID);

  it('contains the pass, images, localizations, manifest and signature', () => {
    const files = open(buildPkPass(state(), cfg(), token));
    for (const name of [
      'pass.json',
      'manifest.json',
      'signature',
      'icon.png',
      'icon@2x.png',
      'strip.png',
      'strip@2x.png',
      'en.lproj/pass.strings',
      'am.lproj/pass.strings',
    ]) {
      expect(Object.keys(files)).toContain(name);
    }
    expect(strFromU8(files['am.lproj/pass.strings'] as Uint8Array)).toContain('ስታምፕ');
  });

  it('describes a stamp card with an opaque QR barcode and the Apple web service', () => {
    const pass = json(open(buildPkPass(state(), cfg(), token)), 'pass.json');
    expect(pass).toMatchObject({
      formatVersion: 1,
      passTypeIdentifier: 'pass.test.temelashcard',
      teamIdentifier: 'TEAM123456',
      serialNumber: PASS_ID,
      organizationName: 'TemelashCard',
      webServiceURL: 'https://api.example.test/api/v1/wallet/apple',
      authenticationToken: token,
      logoText: 'Sample Cafe',
    });
    expect(pass.voided).toBeFalsy();
    expect(pass.storeCard.primaryFields[0]).toMatchObject({ key: 'stamps', value: '3 / 8' });
    expect(pass.storeCard.secondaryFields[0]).toMatchObject({
      key: 'reward',
      value: 'Free coffee',
    });
    expect(pass.storeCard.auxiliaryFields[0]).toMatchObject({ value: '1' });
    expect(pass.barcodes[0]).toMatchObject({
      format: 'PKBarcodeFormatQR',
      message: 'B'.repeat(43),
    });
    // The barcode is opaque: no name, phone or ids.
    const text = JSON.stringify(pass.barcodes);
    expect(text).not.toMatch(/Abebe|\+251|0b9c7e1a/);
    expect(token.length).toBeGreaterThanOrEqual(16);
  });

  it('shows values in the customer’s language', () => {
    const pass = json(open(buildPkPass(state({ language: 'AM' }), cfg(), token)), 'pass.json');
    expect(pass.logoText).toBe('ናሙና ቡና ቤት');
    expect(pass.storeCard.secondaryFields[0].value).toBe('ነጻ ቡና');
  });

  it('voids suspended and invalidated passes and removes their barcode', () => {
    for (const status of ['SUSPENDED', 'INVALIDATED'] as const) {
      const pass = json(open(buildPkPass(state({ status }), cfg(), token)), 'pass.json');
      expect(pass.voided).toBe(true);
      expect(pass.barcodes ?? []).toEqual([]);
      expect(pass.barcode).toBeUndefined();
    }
  });

  it('lists every file in the manifest with its SHA-1', () => {
    const files = open(buildPkPass(state(), cfg(), token));
    const manifest = json(files, 'manifest.json') as Record<string, string>;
    const names = Object.keys(files).filter((n) => n !== 'manifest.json' && n !== 'signature');
    expect(Object.keys(manifest).sort()).toEqual(names.sort());
    for (const [name, sha1] of Object.entries(manifest)) {
      expect(
        createHash('sha1')
          .update(files[name] as Uint8Array)
          .digest('hex'),
      ).toBe(sha1);
    }
  });

  it('is signed with the pass certificate (PKCS#7, verified here without OpenSSL)', () => {
    const files = open(buildPkPass(state(), cfg(), token));
    const manifest = Buffer.from(files['manifest.json'] as Uint8Array);
    const der = forge.util.createBuffer(
      Buffer.from(files['signature'] as Uint8Array).toString('binary'),
    );
    const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(der)) as unknown as {
      certificates: forge.pki.Certificate[];
      rawCapture: {
        authenticatedAttributes: forge.asn1.Asn1[];
        signature: string;
        digestAlgorithm: string;
      };
    };

    // Both the pass certificate and the WWDR intermediate travel with the signature.
    const subjects = p7.certificates.map((c) => c.subject.getField('CN').value);
    expect(subjects).toEqual(
      expect.arrayContaining(['Pass Type ID: pass.test.temelashcard', 'Test WWDR CA']),
    );

    const oid = forge.asn1.derToOid(p7.rawCapture.digestAlgorithm);
    const algo = oid === forge.pki.oids.sha256 ? 'sha256' : 'sha1';
    const attrs = p7.rawCapture.authenticatedAttributes;
    // 1) the signed message-digest attribute equals the digest of the manifest
    const digestAttr = attrs.find(
      (a) =>
        forge.asn1.derToOid((a.value[0] as forge.asn1.Asn1).value as string) ===
        forge.pki.oids.messageDigest,
    );
    const signedDigest = ((digestAttr?.value[1] as forge.asn1.Asn1).value[0] as forge.asn1.Asn1)
      .value as string;
    expect(Buffer.from(signedDigest, 'binary').toString('hex')).toBe(
      createHash(algo).update(manifest).digest('hex'),
    );
    // 2) the signature over the attributes verifies with the pass certificate's public key
    const md = algo === 'sha256' ? forge.md.sha256.create() : forge.md.sha1.create();
    md.update(
      forge.asn1
        .toDer(forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attrs))
        .getBytes(),
    );
    expect(
      (creds.signerCert.publicKey as forge.pki.rsa.PublicKey).verify(
        md.digest().bytes(),
        p7.rawCapture.signature,
      ),
    ).toBe(true);
  });

  it('never embeds private keys or passphrases in the pass', () => {
    const buf = buildPkPass(state(), cfg(), token);
    expect(buf.includes('PRIVATE KEY')).toBe(false);
    const all = Object.values(open(buf))
      .map((u) => Buffer.from(u).toString('latin1'))
      .join('');
    expect(all).not.toContain('PRIVATE KEY');
  });
});

describe('AppleWalletAdapter', () => {
  const cfg = () => loadAppleConfig(input());
  const makeAdapter = (store: AppleRegistrationStore, push: PushSender) =>
    new AppleWalletAdapter(cfg(), SECRET, 'https://api.example.test', store, push);

  it('uses the pass id as the Apple serial number and hands out a short-lived signed download link', async () => {
    const adapter = makeAdapter(
      { pushTargets: async () => [], remove: async () => undefined },
      { push: async () => ({ sent: [], gone: [], retryable: [] }) },
    );
    expect(await adapter.createPass(state())).toEqual({ providerPassId: PASS_ID });
    const link = await adapter.addLink({ passId: PASS_ID, providerPassId: PASS_ID });
    expect(link.kind).toBe('DOWNLOAD');
    expect(link.url).toMatch(
      new RegExp(
        `^https://api\\.example\\.test/api/v1/wallet/apple/download/${PASS_ID}\\?t=\\d+\\.`,
      ),
    );
    expect(new Date(link.expiresAt as string).getTime() - Date.now()).toBeLessThanOrEqual(
      10 * 60_000,
    );
  });

  it('pushes to registered devices, forgets dead tokens, and reports retryable failures', async () => {
    const removed: string[] = [];
    const store = {
      pushTargets: async () => [
        { deviceLibraryIdentifier: 'dev-a', pushToken: 'tok-a' },
        { deviceLibraryIdentifier: 'dev-b', pushToken: 'tok-b' },
      ],
      remove: async (_p: string, d: string) => void removed.push(d),
    };
    const pushed: string[][] = [];
    const adapter = makeAdapter(store, {
      push: async (tokens) => {
        pushed.push(tokens);
        return { sent: ['tok-a'], gone: ['tok-b'], retryable: [] };
      },
    });
    await adapter.updatePass({ passId: PASS_ID, providerPassId: PASS_ID });
    expect(pushed).toEqual([['tok-a', 'tok-b']]);
    expect(removed).toEqual(['dev-b']);

    const flaky = makeAdapter(store, {
      push: async () => ({
        sent: [],
        gone: [],
        retryable: [{ token: 'tok-a', status: 503, reason: 'ServiceUnavailable' }],
      }),
    });
    await expect(
      flaky.updatePass({ passId: PASS_ID, providerPassId: PASS_ID }),
    ).rejects.toMatchObject({ retryable: true });
  });

  it('does nothing when no device has the pass yet', async () => {
    const push = jest.fn();
    const adapter = makeAdapter(
      { pushTargets: async () => [], remove: async () => undefined },
      { push },
    );
    await adapter.updatePass({ passId: PASS_ID, providerPassId: PASS_ID });
    await adapter.suspendPass({ passId: PASS_ID, providerPassId: PASS_ID });
    expect(push).not.toHaveBeenCalled();
  });

  it('turns a pass-building failure into a generic permanent error without leaking details', async () => {
    const adapter = makeAdapter(
      { pushTargets: async () => [], remove: async () => undefined },
      { push: async () => ({ sent: [], gone: [], retryable: [] }) },
    );
    await expect(adapter.renderPass(state({ passId: '' }))).rejects.toBeInstanceOf(
      WalletProviderError,
    );
    await expect(adapter.renderPass(state({ passId: '' }))).rejects.toMatchObject({
      retryable: false,
      message: 'Could not build the Apple pass',
    });
  });
});

describe('ApnsClient (against a local HTTP/2 server)', () => {
  const tls = createLocalhostTls();
  const requests: Array<{
    path: string;
    topic: unknown;
    body: string;
    method: string;
    clientCert: boolean;
  }> = [];
  let server: http2.Http2SecureServer;
  let host = '';
  const verdicts = new Map<string, { status: number; reason?: string }>();

  beforeAll(async () => {
    server = http2.createSecureServer({
      key: tls.key,
      cert: tls.cert,
      requestCert: true,
      rejectUnauthorized: false,
    });
    server.on('stream', (stream: http2.ServerHttp2Stream, headers) => {
      let body = '';
      stream.setEncoding('utf8');
      stream.on('data', (d: string) => (body += d));
      stream.on('end', () => {
        const path = String(headers[':path']);
        const token = decodeURIComponent(path.split('/').pop() as string);
        requests.push({
          path,
          topic: headers['apns-topic'],
          body,
          method: String(headers[':method']),
          clientCert: Boolean(
            (
              stream.session?.socket as unknown as { getPeerCertificate?: () => { raw?: Buffer } }
            )?.getPeerCertificate?.()?.raw,
          ),
        });
        const v = verdicts.get(token) ?? { status: 200 };
        stream.respond({ ':status': v.status, 'content-type': 'application/json' });
        stream.end(v.reason ? JSON.stringify({ reason: v.reason }) : '');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    host = `localhost:${(server.address() as { port: number }).port}`;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  beforeEach(() => {
    requests.length = 0;
    verdicts.clear();
  });

  const client = () =>
    new ApnsClient({
      host,
      cert: creds.certPem,
      key: readFileSync(creds.keyPath),
      topic: 'pass.test.temelashcard',
      tls: { ca: tls.cert },
    });

  it('sends an empty push per token to the pass-type topic, presenting the pass certificate', async () => {
    const result = await client().push(['token-one', 'token-two']);
    expect(result.sent).toEqual(['token-one', 'token-two']);
    expect(requests.map((r) => r.path)).toEqual(['/3/device/token-one', '/3/device/token-two']);
    for (const r of requests) {
      expect(r).toMatchObject({
        method: 'POST',
        topic: 'pass.test.temelashcard',
        body: '{}',
        clientCert: true,
      });
    }
  });

  it('classifies APNs answers: gone, retryable and permanent', async () => {
    verdicts.set('gone', { status: 410, reason: 'Unregistered' });
    verdicts.set('bad', { status: 400, reason: 'BadDeviceToken' });
    verdicts.set('busy', { status: 429, reason: 'TooManyRequests' });
    verdicts.set('down', { status: 503, reason: 'ServiceUnavailable' });
    const result = await client().push(['ok', 'gone', 'bad', 'busy', 'down']);
    expect(result.sent).toEqual(['ok']);
    expect(result.gone.sort()).toEqual(['bad', 'gone']);
    expect(result.retryable.map((r) => r.token).sort()).toEqual(['busy', 'down']);

    verdicts.set('rejected', { status: 403, reason: 'InvalidProviderToken' });
    await expect(client().push(['rejected'])).rejects.toMatchObject({
      retryable: false,
      code: 'APNS_REJECTED',
    });
  });

  it('reports an unreachable server as retryable without exposing push tokens', async () => {
    const dead = new ApnsClient({
      host: 'localhost:1',
      cert: creds.certPem,
      key: readFileSync(creds.keyPath),
      topic: 't',
      tls: { ca: tls.cert },
    });
    const err = await dead.push(['secret-device-token']).catch((e) => e as WalletProviderError);
    expect(err).toBeInstanceOf(WalletProviderError);
    expect((err as WalletProviderError).retryable).toBe(true);
    expect((err as WalletProviderError).message).not.toContain('secret-device-token');
  });

  it('does nothing for an empty token list', async () => {
    expect(await client().push([])).toEqual({ sent: [], gone: [], retryable: [] });
    expect(requests).toHaveLength(0);
  });
});

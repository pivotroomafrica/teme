import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import forge from 'node-forge';

/**
 * Throw-away credentials for tests, generated on the fly. They let the REAL Apple signing and Google
 * request code run end to end without any Apple or Google account. Nothing here is ever written
 * inside the repository.
 */
export interface TestAppleCredentials {
  dir: string;
  certPath: string;
  keyPath: string;
  wwdrPath: string;
  certPem: string;
  wwdrPem: string;
  /** Public key of the signing certificate, to verify signatures made by the code under test. */
  signerCert: forge.pki.Certificate;
}

function makeCert(
  subject: forge.pki.CertificateField[],
  issuer: forge.pki.CertificateField[],
  publicKey: forge.pki.PublicKey,
  signingKey: forge.pki.PrivateKey,
  options: {
    ca?: boolean;
    days?: number;
    startDaysAgo?: number;
    altNames?: forge.pki.CertificateField[];
  } = {},
): forge.pki.Certificate {
  const cert = forge.pki.createCertificate();
  cert.publicKey = publicKey;
  cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(8));
  const start = new Date(Date.now() - (options.startDaysAgo ?? 1) * 86_400_000);
  cert.validity.notBefore = start;
  cert.validity.notAfter = new Date(start.getTime() + (options.days ?? 365) * 86_400_000);
  cert.setSubject(subject);
  cert.setIssuer(issuer);
  const extensions: unknown[] = [{ name: 'basicConstraints', cA: options.ca ?? false }];
  if (options.altNames) {
    extensions.push({
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
      ],
    });
  }
  cert.setExtensions(extensions as never);
  cert.sign(signingKey as forge.pki.rsa.PrivateKey, forge.md.sha256.create());
  return cert;
}

export function createAppleCredentials(
  options: { expired?: boolean; passphrase?: string } = {},
): TestAppleCredentials {
  const dir = mkdtempSync(join(tmpdir(), 'tc-apple-'));
  const caKeys = forge.pki.rsa.generateKeyPair(2048);
  const leafKeys = forge.pki.rsa.generateKeyPair(2048);
  const caSubject = [{ name: 'commonName', value: 'Test WWDR CA' }];
  const wwdr = makeCert(caSubject, caSubject, caKeys.publicKey, caKeys.privateKey, {
    ca: true,
    days: 3650,
  });
  const leaf = makeCert(
    [
      { name: 'commonName', value: 'Pass Type ID: pass.test.temelashcard' },
      { name: 'organizationName', value: 'Test Org' },
    ],
    caSubject,
    leafKeys.publicKey,
    caKeys.privateKey,
    options.expired ? { days: 30, startDaysAgo: 400 } : {},
  );
  const certPem = forge.pki.certificateToPem(leaf);
  const wwdrPem = forge.pki.certificateToPem(wwdr);
  const keyPem = options.passphrase
    ? forge.pki.encryptRsaPrivateKey(leafKeys.privateKey, options.passphrase)
    : forge.pki.privateKeyToPem(leafKeys.privateKey);
  const certPath = join(dir, 'pass-cert.pem');
  const keyPath = join(dir, 'pass-key.pem');
  const wwdrPath = join(dir, 'wwdr.pem');
  writeFileSync(certPath, certPem);
  writeFileSync(keyPath, keyPem);
  writeFileSync(wwdrPath, wwdrPem);
  return { dir, certPath, keyPath, wwdrPath, certPem, wwdrPem, signerCert: leaf };
}

/** A key pair that does NOT belong to the certificate, for the mismatch test. */
export function writeUnrelatedKey(dir: string): string {
  const path = join(dir, 'other-key.pem');
  writeFileSync(path, forge.pki.privateKeyToPem(forge.pki.rsa.generateKeyPair(2048).privateKey));
  return path;
}

export interface TestGoogleCredentials {
  dir: string;
  keyPath: string;
  clientEmail: string;
  privateKey: string;
  publicKey: string;
}

export function createGoogleCredentials(): TestGoogleCredentials {
  const dir = mkdtempSync(join(tmpdir(), 'tc-google-'));
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const clientEmail = 'wallet-test@temelashcard-test.iam.gserviceaccount.com';
  const keyPath = join(dir, 'service-account.json');
  writeFileSync(
    keyPath,
    JSON.stringify({ type: 'service_account', client_email: clientEmail, private_key: privateKey }),
  );
  return { dir, keyPath, clientEmail, privateKey, publicKey };
}

/** Self-signed localhost certificate for the local APNs stand-in. */
export function createLocalhostTls(): { key: string; cert: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const subject = [{ name: 'commonName', value: 'localhost' }];
  const cert = makeCert(subject, subject, keys.publicKey, keys.privateKey, { altNames: subject });
  return {
    key: forge.pki.privateKeyToPem(keys.privateKey),
    cert: forge.pki.certificateToPem(cert),
  };
}

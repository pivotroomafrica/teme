import { existsSync, readFileSync } from 'node:fs';
import forge from 'node-forge';

export interface AppleConfig {
  passTypeId: string;
  teamId: string;
  organizationName: string;
  apnsHost: string;
  /** Base URL Apple devices call for registrations and updates (…/api/v1/wallet/apple). */
  webServiceUrl: string;
  certificates: {
    wwdr: Buffer;
    signerCert: Buffer;
    signerKey: Buffer;
    signerKeyPassphrase?: string;
  };
}

export interface AppleConfigInput {
  passTypeId: string;
  teamId: string;
  organizationName: string;
  apnsHost: string;
  webServiceUrl: string;
  certPath: string;
  keyPath: string;
  keyPassphrase?: string;
  wwdrPath: string;
}

/** Raised for any problem with the Apple setup. Messages name the setting, never its contents. */
export class AppleConfigError extends Error {}

function readFile(label: string, path: string): Buffer {
  if (!existsSync(path)) throw new AppleConfigError(`${label}: file not found`);
  try {
    return readFileSync(path);
  } catch {
    throw new AppleConfigError(`${label}: file cannot be read`);
  }
}

/**
 * Loads and sanity-checks the Apple signing material at startup (only when Apple is enabled), so a
 * bad certificate fails the deployment immediately instead of the first customer's download.
 * Nothing read here is ever logged.
 */
export function loadAppleConfig(input: AppleConfigInput): AppleConfig {
  const signerCert = readFile('APPLE_PASS_CERT_PATH', input.certPath);
  const signerKey = readFile('APPLE_PASS_KEY_PATH', input.keyPath);
  const wwdr = readFile('APPLE_WWDR_CERT_PATH', input.wwdrPath);

  let cert: forge.pki.Certificate;
  try {
    cert = forge.pki.certificateFromPem(signerCert.toString('utf8'));
    forge.pki.certificateFromPem(wwdr.toString('utf8'));
  } catch {
    throw new AppleConfigError(
      'Apple certificates must be PEM-encoded (convert .cer/.p12 with openssl)',
    );
  }
  const now = new Date();
  if (cert.validity.notAfter < now || cert.validity.notBefore > now) {
    throw new AppleConfigError('APPLE_PASS_CERT_PATH: certificate is expired or not yet valid');
  }

  let key: forge.pki.rsa.PrivateKey | null;
  try {
    const pem = signerKey.toString('utf8');
    key = pem.includes('ENCRYPTED')
      ? (forge.pki.decryptRsaPrivateKey(
          pem,
          input.keyPassphrase ?? '',
        ) as forge.pki.rsa.PrivateKey | null)
      : (forge.pki.privateKeyFromPem(pem) as forge.pki.rsa.PrivateKey);
  } catch {
    key = null;
  }
  if (!key) {
    throw new AppleConfigError(
      'APPLE_PASS_KEY_PATH: key cannot be read (wrong passphrase or not PEM?)',
    );
  }
  const pub = cert.publicKey as forge.pki.rsa.PublicKey;
  if (pub.n.compareTo(key.n) !== 0) {
    throw new AppleConfigError('APPLE_PASS_KEY_PATH: key does not belong to APPLE_PASS_CERT_PATH');
  }

  return {
    passTypeId: input.passTypeId,
    teamId: input.teamId,
    organizationName: input.organizationName,
    apnsHost: input.apnsHost,
    webServiceUrl: input.webServiceUrl,
    certificates: {
      wwdr,
      signerCert,
      signerKey,
      ...(input.keyPassphrase ? { signerKeyPassphrase: input.keyPassphrase } : {}),
    },
  };
}

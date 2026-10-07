import { createPrivateKey } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

export interface GoogleConfig {
  /** demo: classes stay in DRAFT and only Console test users can add passes. production: submitted for review. */
  environment: 'demo' | 'production';
  issuerId: string;
  /** Service-account identity used to sign save links and to authenticate REST calls. */
  clientEmail: string;
  privateKey: string;
  origins: string[];
  defaultLogoUrl: string;
  apiBase: string;
  tokenUrl: string;
}

export interface GoogleConfigInput {
  environment: 'demo' | 'production';
  issuerId: string;
  keyPath: string;
  origins: string[];
  defaultLogoUrl: string;
  apiBase: string;
  tokenUrl: string;
}

export class GoogleConfigError extends Error {}

/**
 * Loads the service-account key at startup (only when Google is enabled). Errors name the setting and
 * never include any part of the key.
 */
export function loadGoogleConfig(input: GoogleConfigInput): GoogleConfig {
  if (!existsSync(input.keyPath)) {
    throw new GoogleConfigError('GOOGLE_WALLET_SERVICE_ACCOUNT_KEY_PATH: file not found');
  }
  let parsed: { client_email?: unknown; private_key?: unknown };
  try {
    parsed = JSON.parse(readFileSync(input.keyPath, 'utf8')) as typeof parsed;
  } catch {
    throw new GoogleConfigError(
      'GOOGLE_WALLET_SERVICE_ACCOUNT_KEY_PATH: not a valid service-account JSON file',
    );
  }
  if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
    throw new GoogleConfigError(
      'GOOGLE_WALLET_SERVICE_ACCOUNT_KEY_PATH: missing client_email or private_key',
    );
  }
  try {
    createPrivateKey(parsed.private_key);
  } catch {
    throw new GoogleConfigError(
      'GOOGLE_WALLET_SERVICE_ACCOUNT_KEY_PATH: private_key is not a valid key',
    );
  }
  if (!/^[0-9]+$/.test(input.issuerId)) {
    throw new GoogleConfigError(
      'GOOGLE_WALLET_ISSUER_ID must be the numeric issuer id from the Google Pay & Wallet Console',
    );
  }
  if (!input.defaultLogoUrl.startsWith('https://')) {
    throw new GoogleConfigError('GOOGLE_WALLET_DEFAULT_LOGO_URL must be an https URL');
  }
  return {
    environment: input.environment,
    issuerId: input.issuerId,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key,
    origins: input.origins,
    defaultLogoUrl: input.defaultLogoUrl,
    apiBase: input.apiBase.replace(/\/$/, ''),
    tokenUrl: input.tokenUrl,
  };
}

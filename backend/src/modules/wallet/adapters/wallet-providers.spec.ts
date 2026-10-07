import type { ConfigService } from '@nestjs/config';
import {
  createAppleCredentials,
  createGoogleCredentials,
} from '../../../../test/support/wallet-credentials';
import type { Env } from '../../../config/env.schema';
import type { WalletPassesRepository } from '../infrastructure/wallet-passes.repository';
import { AppleWalletAdapter } from './apple/apple.adapter';
import { AppleConfigError } from './apple/apple-config';
import { FakeWalletAdapter, FakeWalletBackend } from './fake/fake-wallet.adapters';
import { GoogleConfigError } from './google/google-config';
import { GoogleWalletAdapter } from './google/google.adapter';
import { WalletProviders } from './wallet-providers';
import { WebWalletAdapter } from './web.adapter';

jest.setTimeout(120_000);

const SECRET = 'providers-spec-secret-providers-spec-123';

function make(env: Record<string, unknown>) {
  const defaults: Record<string, unknown> = {
    WALLET_MODE: 'fake',
    WALLET_PUBLIC_BASE_URL: 'https://api.example.test',
    WALLET_APPLE_ENABLED: false,
    WALLET_GOOGLE_ENABLED: false,
    WALLET_BARCODE_SECRET: SECRET,
    APPLE_ORGANIZATION_NAME: 'TemelashCard',
    APPLE_APNS_HOST: 'api.push.apple.com',
    GOOGLE_WALLET_ENV: 'demo',
    GOOGLE_WALLET_ORIGINS: [],
    GOOGLE_WALLET_API_BASE: 'https://walletobjects.googleapis.com',
    GOOGLE_OAUTH_TOKEN_URL: 'https://oauth2.googleapis.com/token',
  };
  const merged = { ...defaults, ...env };
  const config = { get: (k: string) => merged[k] } as unknown as ConfigService<Env, true>;
  return new WalletProviders(config, {} as WalletPassesRepository, new FakeWalletBackend());
}

describe('WalletProviders', () => {
  it('always offers the web card and nothing else when no wallet is enabled', () => {
    const p = make({});
    expect(p.get('WEB')).toBeInstanceOf(WebWalletAdapter);
    expect(p.isEnabled('APPLE')).toBe(false);
    expect(p.isEnabled('GOOGLE')).toBe(false);
    expect(() => p.require('APPLE')).toThrow(/not available/);
    expect(() => p.require('GOOGLE')).toThrow(
      expect.objectContaining({ httpStatus: 409, code: 'PROVIDER_NOT_AVAILABLE' }),
    );
  });

  it('runs entirely on fake adapters in fake mode, with no credentials at all', () => {
    const p = make({ WALLET_APPLE_ENABLED: true, WALLET_GOOGLE_ENABLED: true });
    expect(p.get('APPLE')).toBeInstanceOf(FakeWalletAdapter);
    expect(p.get('GOOGLE')).toBeInstanceOf(FakeWalletAdapter);
  });

  it('does not look at credentials for providers that are not enabled, even in live mode', () => {
    const p = make({
      WALLET_MODE: 'live',
      APPLE_PASS_CERT_PATH: '/definitely/not/here.pem',
      GOOGLE_WALLET_SERVICE_ACCOUNT_KEY_PATH: '/nor/here.json',
    });
    expect(p.isEnabled('APPLE')).toBe(false);
    expect(p.isEnabled('GOOGLE')).toBe(false);
    expect(p.isEnabled('WEB')).toBe(true);
  });

  it('builds real adapters in live mode from valid credential files', () => {
    const apple = createAppleCredentials();
    const google = createGoogleCredentials();
    const p = make({
      WALLET_MODE: 'live',
      WALLET_APPLE_ENABLED: true,
      WALLET_GOOGLE_ENABLED: true,
      APPLE_PASS_TYPE_ID: 'pass.test.temelashcard',
      APPLE_TEAM_ID: 'TEAM123456',
      APPLE_PASS_CERT_PATH: apple.certPath,
      APPLE_PASS_KEY_PATH: apple.keyPath,
      APPLE_WWDR_CERT_PATH: apple.wwdrPath,
      GOOGLE_WALLET_ISSUER_ID: '3388000000012345678',
      GOOGLE_WALLET_SERVICE_ACCOUNT_KEY_PATH: google.keyPath,
      GOOGLE_WALLET_DEFAULT_LOGO_URL: 'https://cdn.example.test/logo.png',
    });
    expect(p.get('APPLE')).toBeInstanceOf(AppleWalletAdapter);
    expect(p.get('GOOGLE')).toBeInstanceOf(GoogleWalletAdapter);
    expect(p.applePassTypeId).toBe('pass.test.temelashcard');
  });

  it('refuses to start in live mode with bad Apple or Google credentials', () => {
    expect(() =>
      make({
        WALLET_MODE: 'live',
        WALLET_APPLE_ENABLED: true,
        APPLE_PASS_TYPE_ID: 'pass.x',
        APPLE_TEAM_ID: 'T',
        APPLE_PASS_CERT_PATH: '/missing/cert.pem',
        APPLE_PASS_KEY_PATH: '/missing/key.pem',
        APPLE_WWDR_CERT_PATH: '/missing/wwdr.pem',
      }),
    ).toThrow(AppleConfigError);
    expect(() =>
      make({
        WALLET_MODE: 'live',
        WALLET_GOOGLE_ENABLED: true,
        GOOGLE_WALLET_ISSUER_ID: '123',
        GOOGLE_WALLET_SERVICE_ACCOUNT_KEY_PATH: '/missing/sa.json',
        GOOGLE_WALLET_DEFAULT_LOGO_URL: 'https://x/y.png',
      }),
    ).toThrow(GoogleConfigError);
  });
});

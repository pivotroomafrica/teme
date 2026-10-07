import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainError } from '../../../common/errors/domain-error';
import type { Env } from '../../../config/env.schema';
import type { WalletProviderKey } from '../domain/pass-state';
import { WalletPassesRepository } from '../infrastructure/wallet-passes.repository';
import { ApnsClient } from './apple/apns.client';
import { AppleWalletAdapter } from './apple/apple.adapter';
import { loadAppleConfig } from './apple/apple-config';
import { FakeWalletAdapter, FakeWalletBackend } from './fake/fake-wallet.adapters';
import { GoogleWalletRestApi } from './google/google-api.client';
import { loadGoogleConfig } from './google/google-config';
import { GoogleWalletAdapter } from './google/google.adapter';
import { WebWalletAdapter } from './web.adapter';
import { WalletProviderAdapter } from './wallet-provider';

/**
 * Chooses the adapter for each provider from configuration:
 *  - the web card is always available;
 *  - Apple / Google are available only when switched on;
 *  - WALLET_MODE=fake gives them in-memory adapters, so the app runs with no credentials at all;
 *  - WALLET_MODE=live loads and validates the real credentials, and only for providers that are enabled.
 * A misconfigured live provider stops the application at startup, never at a customer's first request.
 */
@Injectable()
export class WalletProviders {
  private readonly logger = new Logger(WalletProviders.name);
  private readonly adapters = new Map<WalletProviderKey, WalletProviderAdapter>();
  readonly applePassTypeId: string;
  readonly barcodeSecret: string | undefined;

  constructor(
    config: ConfigService<Env, true>,
    passes: WalletPassesRepository,
    fakeBackend: FakeWalletBackend,
  ) {
    const mode = config.get('WALLET_MODE', { infer: true });
    const baseUrl = config.get('WALLET_PUBLIC_BASE_URL', { infer: true });
    this.barcodeSecret = config.get('WALLET_BARCODE_SECRET', { infer: true });
    const appleOn = config.get('WALLET_APPLE_ENABLED', { infer: true });
    const googleOn = config.get('WALLET_GOOGLE_ENABLED', { infer: true });
    this.applePassTypeId =
      config.get('APPLE_PASS_TYPE_ID', { infer: true }) ?? 'pass.test.temelashcard';

    this.adapters.set('WEB', new WebWalletAdapter());

    if (appleOn) {
      if (mode === 'fake') {
        this.adapters.set('APPLE', new FakeWalletAdapter('APPLE', fakeBackend));
      } else {
        const cfg = loadAppleConfig({
          passTypeId: config.get('APPLE_PASS_TYPE_ID', { infer: true }) as string,
          teamId: config.get('APPLE_TEAM_ID', { infer: true }) as string,
          organizationName: config.get('APPLE_ORGANIZATION_NAME', { infer: true }),
          apnsHost: config.get('APPLE_APNS_HOST', { infer: true }),
          webServiceUrl: `${baseUrl.replace(/\/$/, '')}/api/v1/wallet/apple`,
          certPath: config.get('APPLE_PASS_CERT_PATH', { infer: true }) as string,
          keyPath: config.get('APPLE_PASS_KEY_PATH', { infer: true }) as string,
          keyPassphrase: config.get('APPLE_PASS_KEY_PASSPHRASE', { infer: true }),
          wwdrPath: config.get('APPLE_WWDR_CERT_PATH', { infer: true }) as string,
        });
        this.adapters.set(
          'APPLE',
          new AppleWalletAdapter(
            cfg,
            this.barcodeSecret as string,
            baseUrl,
            {
              pushTargets: (passId) => passes.pushTargets(passId),
              remove: (passId, device) => passes.removeRegistration(passId, device),
            },
            new ApnsClient({
              host: cfg.apnsHost,
              cert: cfg.certificates.signerCert,
              key: cfg.certificates.signerKey,
              passphrase: cfg.certificates.signerKeyPassphrase,
              topic: cfg.passTypeId,
            }),
          ),
        );
      }
    }

    if (googleOn) {
      if (mode === 'fake') {
        this.adapters.set('GOOGLE', new FakeWalletAdapter('GOOGLE', fakeBackend));
      } else {
        const cfg = loadGoogleConfig({
          environment: config.get('GOOGLE_WALLET_ENV', { infer: true }),
          issuerId: config.get('GOOGLE_WALLET_ISSUER_ID', { infer: true }) as string,
          keyPath: config.get('GOOGLE_WALLET_SERVICE_ACCOUNT_KEY_PATH', { infer: true }) as string,
          origins: config.get('GOOGLE_WALLET_ORIGINS', { infer: true }),
          defaultLogoUrl: config.get('GOOGLE_WALLET_DEFAULT_LOGO_URL', { infer: true }) as string,
          apiBase: config.get('GOOGLE_WALLET_API_BASE', { infer: true }),
          tokenUrl: config.get('GOOGLE_OAUTH_TOKEN_URL', { infer: true }),
        });
        this.adapters.set('GOOGLE', new GoogleWalletAdapter(cfg, new GoogleWalletRestApi(cfg)));
      }
    }

    this.logger.log(
      `Wallet providers: ${[...this.adapters.keys()].join(', ')} (${mode} mode${mode === 'fake' && (appleOn || googleOn) ? ': no real wallet will receive passes' : ''})`,
    );
  }

  get(provider: WalletProviderKey): WalletProviderAdapter | undefined {
    return this.adapters.get(provider);
  }

  isEnabled(provider: WalletProviderKey): boolean {
    return this.adapters.has(provider);
  }

  /** The adapter, or a 409 the customer can act on when that wallet is not offered. */
  require(provider: WalletProviderKey): WalletProviderAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new DomainError('PROVIDER_NOT_AVAILABLE', 'This wallet is not available.', 409);
    }
    return adapter;
  }
}

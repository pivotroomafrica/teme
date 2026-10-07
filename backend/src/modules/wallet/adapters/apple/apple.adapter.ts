import { deriveAppleAuthToken, signLinkToken } from '../../domain/credentials';
import type { PassState } from '../../domain/pass-state';
import {
  AddLink,
  ApplePassRenderer,
  PassRef,
  WalletProviderAdapter,
  WalletProviderError,
} from '../wallet-provider';
import type { AppleConfig } from './apple-config';
import type { PushSender } from './apns.client';
import { buildPkPass } from './pkpass.builder';

/** Where the adapter finds devices to notify. Implemented on top of the registrations table. */
export interface AppleRegistrationStore {
  pushTargets(
    passId: string,
  ): Promise<Array<{ deviceLibraryIdentifier: string; pushToken: string }>>;
  remove(passId: string, deviceLibraryIdentifier: string): Promise<void>;
}

export const APPLE_LINK_TTL_MS = 10 * 60_000;

/**
 * Apple Wallet. Unlike Google, Apple PULLS passes: the device fetches the latest .pkpass from our web
 * service. "Updating" a pass therefore means sending a push so devices come and fetch it, and the
 * file itself is rendered fresh from the ledger on every request.
 */
export class AppleWalletAdapter implements WalletProviderAdapter, ApplePassRenderer {
  readonly provider = 'APPLE' as const;

  constructor(
    private readonly config: AppleConfig,
    private readonly secret: string,
    private readonly publicBaseUrl: string,
    private readonly registrations: AppleRegistrationStore,
    private readonly push: PushSender,
  ) {}

  async createPass(state: PassState): Promise<{ providerPassId: string }> {
    // Nothing exists at Apple until a device downloads the file; the serial number is our pass id.
    return { providerPassId: state.passId };
  }

  async addLink(ref: PassRef, _state?: PassState): Promise<AddLink> {
    const expiresAt = new Date(Date.now() + APPLE_LINK_TTL_MS);
    const token = signLinkToken(this.secret, ref.passId, expiresAt);
    const base = this.publicBaseUrl.replace(/\/$/, '');
    return {
      kind: 'DOWNLOAD',
      url: `${base}/api/v1/wallet/apple/download/${ref.passId}?t=${encodeURIComponent(token)}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async renderPass(state: PassState): Promise<{ body: Buffer; contentType: string }> {
    try {
      const authToken = deriveAppleAuthToken(this.secret, state.passId);
      return {
        body: buildPkPass(state, this.config, authToken),
        contentType: 'application/vnd.apple.pkpass',
      };
    } catch {
      // Never forward the library's message: it could mention certificate details.
      throw new WalletProviderError('Could not build the Apple pass', false, 'PKPASS_BUILD');
    }
  }

  updatePass(ref: PassRef): Promise<void> {
    return this.notify(ref);
  }

  suspendPass(ref: PassRef): Promise<void> {
    // The pass endpoint renders suspended/invalidated passes as voided; devices pick that up on this push.
    return this.notify(ref);
  }

  private async notify(ref: PassRef): Promise<void> {
    const targets = await this.registrations.pushTargets(ref.passId);
    if (targets.length === 0) return; // nobody has the pass yet: nothing to refresh
    const result = await this.push.push(targets.map((t) => t.pushToken));
    for (const token of result.gone) {
      const target = targets.find((t) => t.pushToken === token);
      if (target) await this.registrations.remove(ref.passId, target.deviceLibraryIdentifier);
    }
    if (result.retryable.length > 0) {
      throw new WalletProviderError(
        `APNs could not deliver ${result.retryable.length} push(es); will retry`,
        true,
        'APNS_RETRYABLE',
      );
    }
  }
}

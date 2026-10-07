import { signJwtRs256 } from '../../../../common/crypto/jwt-rs256';
import type { PassState } from '../../domain/pass-state';
import { AddLink, PassRef, WalletProviderAdapter } from '../wallet-provider';
import type { GoogleWalletApi } from './google-api.client';
import type { GoogleConfig } from './google-config';
import {
  buildLoyaltyClass,
  buildLoyaltyObject,
  buildObjectPatch,
  classIdFor,
  objectIdFor,
} from './loyalty-payloads';

/**
 * Google Wallet. Each merchant program is a loyalty CLASS (created on first use, then kept in sync) and
 * each membership pass is a loyalty OBJECT that we update by REST after every stamp, redemption or
 * reversal. "Add to Google Wallet" links are JWTs signed with the service-account key.
 */
export class GoogleWalletAdapter implements WalletProviderAdapter {
  readonly provider = 'GOOGLE' as const;
  private readonly knownClasses = new Set<string>();

  constructor(
    private readonly config: GoogleConfig,
    private readonly api: GoogleWalletApi,
  ) {}

  async createPass(state: PassState): Promise<{ providerPassId: string }> {
    await this.ensureClass(state);
    const object = buildLoyaltyObject(state, this.config);
    await this.api.insertObject(object); // an existing object (409) is fine: we PATCH on update
    return { providerPassId: object.id };
  }

  async addLink(ref: PassRef, _state?: PassState): Promise<AddLink> {
    const objectId = ref.providerPassId ?? objectIdFor(this.config.issuerId, ref.passId);
    const now = Math.floor(Date.now() / 1000);
    const jwt = signJwtRs256(
      {
        iss: this.config.clientEmail,
        aud: 'google',
        typ: 'savetowallet',
        iat: now,
        origins: this.config.origins,
        // Reference the object we already created server-side rather than embedding its contents, so the
        // link cannot be used to add anything we did not issue.
        payload: { loyaltyObjects: [{ id: objectId }] },
      },
      this.config.privateKey,
    );
    return { kind: 'REDIRECT', url: `https://pay.google.com/gp/v/save/${jwt}`, expiresAt: null };
  }

  async updatePass(ref: PassRef, state: PassState): Promise<void> {
    await this.ensureClass(state);
    const id = ref.providerPassId ?? objectIdFor(this.config.issuerId, state.passId);
    const outcome = await this.api.patchObject(id, buildObjectPatch(state));
    if (outcome === 'missing') {
      // Deleted on Google's side (or never inserted): recreate it with current content.
      await this.api.insertObject(buildLoyaltyObject(state, this.config));
    }
  }

  async suspendPass(ref: PassRef, state: PassState): Promise<void> {
    await this.updatePass(ref, state); // state.status drives INACTIVE / EXPIRED and drops the barcode
  }

  private async ensureClass(state: PassState): Promise<void> {
    const id = classIdFor(this.config.issuerId, state.programId);
    if (this.knownClasses.has(id)) return;
    const body = buildLoyaltyClass(state, this.config);
    if (await this.api.getClass(id)) await this.api.patchClass(id, body);
    else await this.api.insertClass(body);
    this.knownClasses.add(id);
  }
}

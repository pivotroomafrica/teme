import type { PassState } from '../domain/pass-state';
import { AddLink, PassRef, WalletProviderAdapter } from './wallet-provider';

/**
 * The web card needs no provider: the customer's browser shows live data from `POST /card/web`, so
 * there is nothing to push. It is always available and is the fallback when no wallet is configured.
 */
export class WebWalletAdapter implements WalletProviderAdapter {
  readonly provider = 'WEB' as const;

  async createPass(state: PassState): Promise<{ providerPassId: string }> {
    return { providerPassId: state.passId };
  }

  async addLink(): Promise<AddLink> {
    return { kind: 'NONE', url: null, expiresAt: null };
  }

  async updatePass(_ref: PassRef, _state: PassState): Promise<void> {
    // Live data: nothing to deliver.
  }

  async suspendPass(_ref: PassRef, _state: PassState): Promise<void> {
    // Status is read live; the pass endpoint refuses suspended cards.
  }
}

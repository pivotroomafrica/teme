import type { PassState, WalletProviderKey } from '../domain/pass-state';

/** A failure talking to a wallet provider. `retryable` says whether trying again later can help. */
export class WalletProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly code: string = 'PROVIDER_ERROR',
  ) {
    super(message);
    this.name = 'WalletProviderError';
  }
}

export interface PassRef {
  passId: string;
  /** Apple serial number / Google object id; null until the pass has been created at the provider. */
  providerPassId: string | null;
}

export interface AddLink {
  /** DOWNLOAD: open the URL to get a file. REDIRECT: open the URL to add the pass. NONE: nothing to add. */
  kind: 'DOWNLOAD' | 'REDIRECT' | 'NONE';
  url: string | null;
  expiresAt: string | null;
}

/**
 * What the wallet service needs from any provider. Apple, Google, the web fallback and the in-memory
 * fakes all implement this, so the rest of the system never knows which one it is talking to.
 */
export interface WalletProviderAdapter {
  readonly provider: WalletProviderKey;

  /** Registers the pass with the provider; returns the provider-side identifier. */
  createPass(state: PassState): Promise<{ providerPassId: string }>;

  /** A link or download the customer can open to add the pass to their wallet. */
  addLink(ref: PassRef, state: PassState): Promise<AddLink>;

  /** Pushes the current progress and reward status. Idempotent: safe to repeat. */
  updatePass(ref: PassRef, state: PassState): Promise<void>;

  /** Marks the pass suspended/invalidated at the provider (state.status says which). */
  suspendPass(ref: PassRef, state: PassState): Promise<void>;
}

/** Apple passes are pulled by the device, so Apple also needs to render the file on demand. */
export interface ApplePassRenderer {
  renderPass(state: PassState): Promise<{ body: Buffer; contentType: string }>;
}

export const isApplePassRenderer = (a: unknown): a is ApplePassRenderer =>
  typeof (a as ApplePassRenderer)?.renderPass === 'function';

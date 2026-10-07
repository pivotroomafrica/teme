import { Injectable } from '@nestjs/common';
import type { PassState, WalletProviderKey } from '../../domain/pass-state';
import {
  AddLink,
  ApplePassRenderer,
  PassRef,
  WalletProviderAdapter,
  WalletProviderError,
} from '../wallet-provider';

export type FakeOperation = 'create' | 'link' | 'update' | 'suspend' | 'render';

export interface FakeCall {
  provider: WalletProviderKey;
  operation: FakeOperation;
  passId: string;
  status: PassState['status'];
  currentStamps: number;
  rewardsAvailable: number;
  version: number;
}

interface PlannedFailure {
  provider: WalletProviderKey;
  operation?: FakeOperation;
  remaining: number;
  retryable: boolean;
}

/**
 * In-memory stand-in for Apple and Google, used for local development, demos and every automated test.
 * It records each call and can be told to fail, so retry, dead-letter and "provider down" behaviour can
 * be exercised without any credentials or network.
 */
@Injectable()
export class FakeWalletBackend {
  readonly calls: FakeCall[] = [];
  private failures: PlannedFailure[] = [];

  reset(): void {
    this.calls.length = 0;
    this.failures = [];
  }

  /** The next `times` matching calls throw. */
  failNext(
    provider: WalletProviderKey,
    options: { operation?: FakeOperation; times?: number; retryable?: boolean } = {},
  ): void {
    this.failures.push({
      provider,
      operation: options.operation,
      remaining: options.times ?? 1,
      retryable: options.retryable ?? true,
    });
  }

  /** Every matching call throws until `reset()`. */
  failAlways(provider: WalletProviderKey, retryable = true): void {
    this.failures.push({ provider, remaining: Infinity, retryable });
  }

  callsFor(provider: WalletProviderKey, operation?: FakeOperation): FakeCall[] {
    return this.calls.filter(
      (c) => c.provider === provider && (!operation || c.operation === operation),
    );
  }

  /** @internal used by the fake adapters */
  record(provider: WalletProviderKey, operation: FakeOperation, state: PassState): void {
    const failure = this.failures.find(
      (f) =>
        f.provider === provider && f.remaining > 0 && (!f.operation || f.operation === operation),
    );
    if (failure) {
      failure.remaining--;
      throw new WalletProviderError(
        `Fake ${provider} provider is unavailable`,
        failure.retryable,
        'FAKE_FAILURE',
      );
    }
    this.calls.push({
      provider,
      operation,
      passId: state.passId,
      status: state.status,
      currentStamps: state.currentStamps,
      rewardsAvailable: state.rewardsAvailable,
      version: state.version,
    });
  }
}

export class FakeWalletAdapter implements WalletProviderAdapter, ApplePassRenderer {
  constructor(
    readonly provider: Exclude<WalletProviderKey, 'WEB'>,
    private readonly backend: FakeWalletBackend,
  ) {}

  async createPass(state: PassState): Promise<{ providerPassId: string }> {
    this.backend.record(this.provider, 'create', state);
    return { providerPassId: `fake-${this.provider.toLowerCase()}-${state.passId}` };
  }

  async addLink(ref: PassRef, state: PassState): Promise<AddLink> {
    this.backend.record(this.provider, 'link', state);
    return {
      kind: this.provider === 'APPLE' ? 'DOWNLOAD' : 'REDIRECT',
      url: `https://fake-wallet.test/${this.provider.toLowerCase()}/${ref.passId}`,
      expiresAt: null,
    };
  }

  async updatePass(_ref: PassRef, state: PassState): Promise<void> {
    this.backend.record(this.provider, 'update', state);
  }

  async suspendPass(_ref: PassRef, state: PassState): Promise<void> {
    this.backend.record(this.provider, 'suspend', state);
  }

  /** A readable JSON description instead of a signed .pkpass: enough to see what a device would get. */
  async renderPass(state: PassState): Promise<{ body: Buffer; contentType: string }> {
    this.backend.record(this.provider, 'render', state);
    const body = {
      fake: true,
      serialNumber: state.passId,
      status: state.status,
      progress: `${state.currentStamps} / ${state.stampsRequired}`,
      rewardsAvailable: state.rewardsAvailable,
      barcode: state.barcode,
    };
    return { body: Buffer.from(JSON.stringify(body)), contentType: 'application/json' };
  }
}

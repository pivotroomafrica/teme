// Public API of the wallet module. Other modules may import only from here.
export { WalletModule } from './wallet.module';
export { WalletService } from './application/wallet.service';
export { WalletProviders } from './adapters/wallet-providers';
export { FakeWalletBackend } from './adapters/fake/fake-wallet.adapters';
export { WalletProviderError, type WalletProviderAdapter } from './adapters/wallet-provider';

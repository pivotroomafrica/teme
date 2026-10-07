import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers';
import { LoyaltyProgramsModule } from '../loyalty-programs';
import { MembershipsModule } from '../memberships';
import { MerchantsModule } from '../merchants';
import { RewardsModule } from '../rewards';
import { StampsModule } from '../stamps';
import { FakeWalletBackend } from './adapters/fake/fake-wallet.adapters';
import { WalletProviders } from './adapters/wallet-providers';
import { AppleWebServiceController } from './api/apple-web-service.controller';
import { CardWalletController } from './api/card-wallet.controller';
import { WalletAdminController } from './api/wallet-admin.controller';
import { PassStateBuilder } from './application/pass-state.builder';
import { WalletSyncHandler } from './application/wallet-sync.handler';
import { WalletService } from './application/wallet.service';
import { WalletPassesRepository } from './infrastructure/wallet-passes.repository';

@Module({
  imports: [
    CustomersModule,
    LoyaltyProgramsModule,
    MembershipsModule,
    MerchantsModule,
    RewardsModule,
    StampsModule,
  ],
  controllers: [CardWalletController, AppleWebServiceController, WalletAdminController],
  providers: [
    FakeWalletBackend,
    WalletPassesRepository,
    WalletProviders,
    PassStateBuilder,
    WalletService,
    WalletSyncHandler,
  ],
  exports: [WalletService, FakeWalletBackend, WalletProviders],
})
export class WalletModule {}

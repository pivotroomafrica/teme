import { Module } from '@nestjs/common';
import { MerchantProfileController } from './api/merchant-profile.controller';
import { PlatformMerchantsController } from './api/platform-merchants.controller';
import { MerchantDirectory } from './application/merchant-directory.service';
import { MerchantProfileService } from './application/merchant-profile.service';
import { MerchantProfileRepository } from './infrastructure/merchant-profile.repository';
import { PlatformMerchantsRepository } from './infrastructure/platform-merchants.repository';

@Module({
  controllers: [MerchantProfileController, PlatformMerchantsController],
  providers: [
    MerchantProfileService,
    MerchantProfileRepository,
    PlatformMerchantsRepository,
    MerchantDirectory,
  ],
  exports: [MerchantDirectory],
})
export class MerchantsModule {}

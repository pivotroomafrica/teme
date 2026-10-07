import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers';
import { MerchantsModule } from '../merchants';
import { WalletModule } from '../wallet';
import { PrivacyController } from './api/privacy.controller';
import { AnonymizationService } from './application/anonymization.service';
import { CustomerDataService } from './application/customer-data.service';
import { PrivacyJobs } from './application/privacy-jobs';
import { RetentionService } from './application/retention.service';
import { PrivacyRepository } from './infrastructure/privacy.repository';

@Module({
  imports: [CustomersModule, MerchantsModule, WalletModule],
  controllers: [PrivacyController],
  providers: [
    PrivacyRepository,
    CustomerDataService,
    AnonymizationService,
    RetentionService,
    PrivacyJobs,
  ],
  exports: [RetentionService, PrivacyJobs, AnonymizationService],
})
export class PrivacyModule {}

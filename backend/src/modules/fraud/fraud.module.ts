import { Module } from '@nestjs/common';
import { MerchantsModule } from '../merchants';
import { FraudController } from './api/fraud.controller';
import { FraudEvaluationService } from './application/fraud-evaluation.service';
import { FraudFlagsService } from './application/fraud-flags.service';
import { FraudJobs } from './application/fraud-jobs';
import { FraudRepository } from './infrastructure/fraud.repository';

@Module({
  imports: [MerchantsModule],
  controllers: [FraudController],
  providers: [FraudRepository, FraudEvaluationService, FraudFlagsService, FraudJobs],
  exports: [FraudEvaluationService, FraudJobs],
})
export class FraudModule {}

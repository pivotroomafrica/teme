import { Module } from '@nestjs/common';
import { MerchantsModule } from '../merchants';
import { AnalyticsController } from './api/analytics.controller';
import { AnalyticsService } from './application/analytics.service';
import { AnalyticsRepository } from './infrastructure/analytics.repository';

@Module({
  imports: [MerchantsModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsRepository],
})
export class AnalyticsModule {}

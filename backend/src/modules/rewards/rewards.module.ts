import { Module } from '@nestjs/common';
import { RewardsService } from './application/rewards.service';
import { RewardsRepository } from './infrastructure/rewards.repository';

@Module({
  providers: [RewardsService, RewardsRepository],
  exports: [RewardsService],
})
export class RewardsModule {}

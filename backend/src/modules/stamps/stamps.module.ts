import { Module } from '@nestjs/common';
import { BranchesModule } from '../branches';
import { CustomersModule } from '../customers';
import { LoyaltyProgramsModule } from '../loyalty-programs';
import { MembershipsModule } from '../memberships';
import { RewardsModule } from '../rewards';
import { ScannerController } from './api/scanner.controller';
import { CardAccessService } from './application/card-access.service';
import { ScannerService } from './application/scanner.service';
import { StampsRepository } from './infrastructure/stamps.repository';

@Module({
  imports: [
    BranchesModule,
    CustomersModule,
    LoyaltyProgramsModule,
    MembershipsModule,
    RewardsModule,
  ],
  controllers: [ScannerController],
  providers: [ScannerService, CardAccessService, StampsRepository],
  exports: [StampsRepository, CardAccessService],
})
export class StampsModule {}

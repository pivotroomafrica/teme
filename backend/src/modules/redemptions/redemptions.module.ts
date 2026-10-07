import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers';
import { LoyaltyProgramsModule } from '../loyalty-programs';
import { MembershipsModule } from '../memberships';
import { RewardsModule } from '../rewards';
import { StampsModule } from '../stamps';
import { RedemptionsController } from './api/redemptions.controller';
import { MembershipLedgerController, ReversalsController } from './api/reversals.controller';
import { MembershipLedgerService } from './application/membership-ledger.service';
import { RedemptionService } from './application/redemption.service';
import { ReversalService } from './application/reversal.service';
import { RedemptionsRepository } from './infrastructure/redemptions.repository';

@Module({
  imports: [StampsModule, RewardsModule, MembershipsModule, LoyaltyProgramsModule, CustomersModule],
  controllers: [RedemptionsController, ReversalsController, MembershipLedgerController],
  providers: [RedemptionService, ReversalService, MembershipLedgerService, RedemptionsRepository],
  exports: [RedemptionsRepository],
})
export class RedemptionsModule {}

import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers';
import { LoyaltyProgramsModule } from '../loyalty-programs';
import { MerchantsModule } from '../merchants';
import { CardController, MembershipsController } from './api/card.controller';
import { JoinController } from './api/join.controller';
import { CardService } from './application/card.service';
import { MembershipLifecycleService } from './application/membership-lifecycle.service';
import { EnrollmentService } from './application/enrollment.service';
import { MembershipsRepository } from './infrastructure/memberships.repository';

@Module({
  imports: [CustomersModule, LoyaltyProgramsModule, MerchantsModule],
  controllers: [JoinController, CardController, MembershipsController],
  providers: [EnrollmentService, CardService, MembershipLifecycleService, MembershipsRepository],
  exports: [MembershipsRepository],
})
export class MembershipsModule {}

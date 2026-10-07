import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { InvitationController } from './api/invitation.controller';
import { StaffController } from './api/staff.controller';
import { StaffActivityService } from './application/staff-activity.service';
import { StaffInvitationService } from './application/staff-invitation.service';
import { StaffService } from './application/staff.service';
import { StaffActivityRepository } from './infrastructure/staff-activity.repository';
import { StaffInvitationRepository } from './infrastructure/staff-invitation.repository';
import { StaffRepository } from './infrastructure/staff.repository';

@Module({
  imports: [AuthModule],
  controllers: [StaffController, InvitationController],
  providers: [
    StaffService,
    StaffInvitationService,
    StaffActivityService,
    StaffRepository,
    StaffInvitationRepository,
    StaffActivityRepository,
  ],
})
export class StaffModule {}

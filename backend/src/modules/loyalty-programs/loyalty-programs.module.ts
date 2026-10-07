import { Module } from '@nestjs/common';
import { MerchantsModule } from '../merchants';
import { ProgramsController } from './api/programs.controller';
import { ProgramsService } from './application/programs.service';
import { ProgramsRepository } from './infrastructure/programs.repository';

@Module({
  imports: [MerchantsModule],
  controllers: [ProgramsController],
  providers: [ProgramsService, ProgramsRepository],
  exports: [ProgramsRepository],
})
export class LoyaltyProgramsModule {}

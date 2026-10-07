import { Module } from '@nestjs/common';
import { BranchesController } from './api/branches.controller';
import { BranchesService } from './application/branches.service';
import { BranchesRepository } from './infrastructure/branches.repository';

@Module({
  controllers: [BranchesController],
  providers: [BranchesService, BranchesRepository],
  exports: [BranchesRepository],
})
export class BranchesModule {}

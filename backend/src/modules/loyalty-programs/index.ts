// Public API of the loyalty-programs module. Other modules may import only from here.
export { LoyaltyProgramsModule } from './loyalty-programs.module';
export { ProgramsRepository, type ProgramRecord } from './infrastructure/programs.repository';
export { isEnrollable } from './domain/program-lifecycle';

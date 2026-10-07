import { Global, Module } from '@nestjs/common';
import { AuditService } from './application/audit.service';
import { AuditRepository } from './infrastructure/audit.repository';

@Global()
@Module({ providers: [AuditRepository, AuditService], exports: [AuditService, AuditRepository] })
export class AuditModule {}

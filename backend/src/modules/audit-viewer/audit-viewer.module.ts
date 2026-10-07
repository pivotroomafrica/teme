import { Module } from '@nestjs/common';
import { MerchantsModule } from '../merchants';
import { AuditController } from './api/audit.controller';
import { AuditQueryService } from './application/audit-query.service';

/** Read side of the audit history. Separate from AuditModule (the writer) so the low-level writer never depends on merchants. */
@Module({
  imports: [MerchantsModule],
  controllers: [AuditController],
  providers: [AuditQueryService],
})
export class AuditViewerModule {}

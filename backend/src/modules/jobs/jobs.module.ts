import { Global, Module } from '@nestjs/common';
import { OutboxAdminController } from './api/outbox-admin.controller';
import { IdempotencyService } from './application/idempotency.service';
import { JobScheduler } from './application/job-scheduler.service';
import { OutboxHandlerRegistry } from './application/outbox-handler.registry';
import { OutboxWorker } from './application/outbox-worker.service';
import { OutboxService } from './application/outbox.service';
import { IdempotencyRepository } from './infrastructure/idempotency.repository';
import { OutboxRepository } from './infrastructure/outbox.repository';

@Global()
@Module({
  controllers: [OutboxAdminController],
  providers: [
    OutboxService,
    OutboxRepository,
    OutboxHandlerRegistry,
    OutboxWorker,
    JobScheduler,
    IdempotencyRepository,
    IdempotencyService,
  ],
  exports: [
    OutboxService,
    OutboxHandlerRegistry,
    OutboxWorker,
    JobScheduler,
    IdempotencyRepository,
    IdempotencyService,
  ],
})
export class JobsModule {}

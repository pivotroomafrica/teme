// Public API of the jobs module (idempotency + transactional outbox + worker). Other modules may import only from here.
export { JobsModule } from './jobs.module';
export { OutboxService, OutboxJobType, type OutboxJobInput } from './application/outbox.service';
export {
  OutboxHandlerRegistry,
  PermanentJobError,
  type OutboxHandler,
} from './application/outbox-handler.registry';
export { OutboxWorker, type BatchResult } from './application/outbox-worker.service';
export {
  IdempotencyRepository,
  type StoredResponse,
} from './infrastructure/idempotency.repository';
export type { ClaimedJob } from './infrastructure/outbox.repository';
export { IdempotencyService } from './application/idempotency.service';
export { isValidIdempotencyKey, requestFingerprint } from './domain/idempotency';
export { sanitizeError, decideFailure, backoffSeconds } from './domain/retry-policy';
export { JobScheduler } from './application/job-scheduler.service';

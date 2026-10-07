import { Injectable } from '@nestjs/common';
import type { DbClient } from '../../../database/db-client';
import { OutboxRepository } from '../infrastructure/outbox.repository';

export const OutboxJobType = {
  WALLET_PASS_UPDATE: 'wallet.pass_update',
  FRAUD_EVALUATE: 'fraud.evaluate',
  RETENTION_RUN: 'privacy.retention',
  MAINTENANCE_CLEANUP: 'maintenance.cleanup',
} as const;

export interface OutboxJobInput {
  /** Omit for platform-wide jobs. */
  merchantId?: string | null;
  type: string;
  aggregateType: string;
  aggregateId: string;
  /** Identifiers and reasons only: never personal data or secrets. */
  payload?: Record<string, unknown>;
}

/**
 * Transactional outbox: callers pass THEIR transaction, so the job commits or rolls back together
 * with the change that needs it. A worker (wallet step) processes pending jobs afterwards.
 */
@Injectable()
export class OutboxService {
  constructor(private readonly repository: OutboxRepository) {}

  /** Enqueues at most one job per `dedupeKey` (e.g. "fraud:<merchant>:<time bucket>"). Returns whether it was new. */
  enqueueUnique(job: OutboxJobInput, dedupeKey: string, db?: DbClient): Promise<boolean> {
    return this.repository.insertIfAbsent({ ...job, payload: job.payload ?? {}, dedupeKey }, db);
  }

  enqueue(job: OutboxJobInput, db?: DbClient): Promise<void> {
    return this.repository.insert({ ...job, payload: job.payload ?? {} }, db);
  }
}

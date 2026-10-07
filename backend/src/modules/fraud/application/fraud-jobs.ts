import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';
import {
  ClaimedJob,
  JobScheduler,
  OutboxHandler,
  OutboxHandlerRegistry,
  OutboxJobType,
  OutboxService,
  PermanentJobError,
} from '../../jobs';
import { MerchantDirectory } from '../../merchants';
import { FraudEvaluationService } from './fraud-evaluation.service';

/**
 * Periodic evaluation. The scheduler only enqueues one job per merchant per interval (keyed by the
 * interval, so several instances create it once); the outbox worker runs it with retries.
 */
@Injectable()
export class FraudJobs implements OutboxHandler, OnModuleInit {
  constructor(
    private readonly registry: OutboxHandlerRegistry,
    private readonly scheduler: JobScheduler,
    private readonly outbox: OutboxService,
    private readonly merchants: MerchantDirectory,
    private readonly evaluation: FraudEvaluationService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    this.registry.register(OutboxJobType.FRAUD_EVALUATE, this);
    const minutes = this.config.get('FRAUD_EVALUATION_INTERVAL_MINUTES', { infer: true }) ?? 15;
    this.scheduler.register('fraud.enqueue', minutes * 60_000, async () => {
      await this.enqueueAll(minutes);
    });
  }

  /** Public so tests can run a tick on demand. */
  async enqueueAll(intervalMinutes: number, now: Date = new Date()): Promise<number> {
    const bucket = Math.floor(now.getTime() / (intervalMinutes * 60_000));
    let created = 0;
    for (const merchantId of await this.merchants.listActiveMerchantIds()) {
      const isNew = await this.outbox.enqueueUnique(
        {
          merchantId,
          type: OutboxJobType.FRAUD_EVALUATE,
          aggregateType: 'merchant',
          aggregateId: merchantId,
        },
        `fraud:${merchantId}:${bucket}`,
      );
      if (isNew) created++;
    }
    return created;
  }

  async handle(job: ClaimedJob): Promise<void> {
    if (!job.merchantId) throw new PermanentJobError('Fraud job has no merchant');
    await this.evaluation.evaluate(job.merchantId);
  }
}

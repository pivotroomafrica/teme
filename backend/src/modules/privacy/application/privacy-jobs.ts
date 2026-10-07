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
import { RetentionService } from './retention.service';

/** Daily retention per merchant plus one platform-wide clean-up, both de-duplicated per interval. */
@Injectable()
export class PrivacyJobs implements OnModuleInit {
  constructor(
    private readonly registry: OutboxHandlerRegistry,
    private readonly scheduler: JobScheduler,
    private readonly outbox: OutboxService,
    private readonly merchants: MerchantDirectory,
    private readonly retention: RetentionService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    const retentionHandler: OutboxHandler = {
      handle: async (job: ClaimedJob) => {
        if (!job.merchantId) throw new PermanentJobError('Retention job has no merchant');
        await this.retention.runForMerchant(job.merchantId, { actorUserId: null });
      },
    };
    const cleanupHandler: OutboxHandler = {
      handle: async () => {
        await this.retention.cleanup();
      },
    };
    this.registry.register(OutboxJobType.RETENTION_RUN, retentionHandler);
    this.registry.register(OutboxJobType.MAINTENANCE_CLEANUP, cleanupHandler);

    const hours = this.config.get('RETENTION_INTERVAL_HOURS', { infer: true }) ?? 24;
    this.scheduler.register('privacy.enqueue', hours * 3_600_000, async () => {
      await this.enqueueAll(hours);
    });
  }

  /** Public so tests can run a tick on demand. Returns the number of jobs created. */
  async enqueueAll(intervalHours: number, now: Date = new Date()): Promise<number> {
    const bucket = Math.floor(now.getTime() / (intervalHours * 3_600_000));
    let created = 0;
    for (const merchantId of await this.merchants.listActiveMerchantIds()) {
      const isNew = await this.outbox.enqueueUnique(
        {
          merchantId,
          type: OutboxJobType.RETENTION_RUN,
          aggregateType: 'merchant',
          aggregateId: merchantId,
        },
        `retention:${merchantId}:${bucket}`,
      );
      if (isNew) created++;
    }
    const cleanupIsNew = await this.outbox.enqueueUnique(
      {
        type: OutboxJobType.MAINTENANCE_CLEANUP,
        aggregateType: 'platform',
        aggregateId: 'maintenance',
      },
      `cleanup:${bucket}`,
    );
    return created + (cleanupIsNew ? 1 : 0);
  }
}

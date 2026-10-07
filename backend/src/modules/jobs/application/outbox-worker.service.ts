import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';
import { decideFailure, sanitizeError } from '../domain/retry-policy';
import { OutboxRepository } from '../infrastructure/outbox.repository';
import { OutboxHandlerRegistry, PermanentJobError } from './outbox-handler.registry';

export interface BatchResult {
  claimed: number;
  completed: number;
  retried: number;
  dead: number;
}

/** A PROCESSING job whose worker has been silent this long is assumed crashed and is reclaimed. */
const LEASE_SECONDS = 300;

/**
 * Delivers outbox jobs after the transaction that created them has committed. Failures never touch
 * the loyalty data: a job is retried with exponential backoff, and dead-lettered once its attempt
 * budget is spent or the handler reports a permanent failure.
 */
@Injectable()
export class OutboxWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxWorker.name);
  private readonly workerId = `worker-${randomUUID().slice(0, 8)}`;
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> = Promise.resolve();
  private stopped = false;

  constructor(
    private readonly repository: OutboxRepository,
    private readonly registry: OutboxHandlerRegistry,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('OUTBOX_WORKER_ENABLED', { infer: true })) return;
    this.stopped = false;
    this.schedule(0);
    this.logger.log(`Outbox worker ${this.workerId} started`);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running; // let an in-flight batch finish
  }

  /** Processes one batch now. Also used by tests and operational tooling. */
  async processBatch(limit?: number): Promise<BatchResult> {
    const size = limit ?? this.config.get('OUTBOX_BATCH_SIZE', { infer: true }) ?? 10;
    const jobs = await this.repository.claimDue(this.workerId, size, LEASE_SECONDS);
    const result: BatchResult = { claimed: jobs.length, completed: 0, retried: 0, dead: 0 };

    for (const job of jobs) {
      const handler = this.registry.get(job.type);
      try {
        if (!handler) throw new PermanentJobError(`No handler registered for "${job.type}"`);
        await handler.handle(job);
        await this.repository.markCompleted(job.id);
        result.completed++;
      } catch (err) {
        const message = sanitizeError(err);
        const decision = decideFailure(job.attempts, job.maxAttempts, {
          retryable: !(err instanceof PermanentJobError),
        });
        if (decision.kind === 'dead') {
          await this.repository.markDead(job.id, message);
          result.dead++;
          this.logger.warn(
            `Job ${job.id} (${job.type}) dead-lettered after ${job.attempts} attempt(s): ${message}`,
          );
        } else {
          await this.repository.markRetry(
            job.id,
            new Date(Date.now() + decision.delaySeconds * 1000),
            message,
          );
          result.retried++;
          this.logger.warn(
            `Job ${job.id} (${job.type}) failed, retry in ${decision.delaySeconds}s: ${message}`,
          );
        }
      }
    }
    return result;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.processBatch()
        .then((r) =>
          r.claimed > 0 ? 0 : this.config.get('OUTBOX_POLL_INTERVAL_MS', { infer: true }),
        )
        .catch((err) => {
          this.logger.error(`Outbox batch failed: ${sanitizeError(err)}`);
          return this.config.get('OUTBOX_POLL_INTERVAL_MS', { infer: true });
        })
        .then((next) => this.schedule(next));
    }, delayMs);
    this.timer.unref?.();
  }
}

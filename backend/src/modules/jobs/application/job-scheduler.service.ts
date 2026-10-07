import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';
import { sanitizeError } from '../domain/retry-policy';

interface Task {
  name: string;
  intervalMs: number;
  tick: () => Promise<void>;
  timer?: NodeJS.Timeout;
}

/**
 * Runs lightweight periodic "enqueue the work" ticks. A tick only inserts outbox jobs (de-duplicated by
 * a time-bucket key), so running the application on several instances at once creates each job once,
 * and the heavy lifting happens in the outbox worker with its retries and dead-lettering.
 */
@Injectable()
export class JobScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(JobScheduler.name);
  private readonly tasks = new Map<string, Task>();

  constructor(private readonly config: ConfigService<Env, true>) {}

  /** Call from a module's onModuleInit (before the scheduler starts). */
  register(name: string, intervalMs: number, tick: () => Promise<void>): void {
    if (this.tasks.has(name)) throw new Error(`Scheduled task "${name}" is already registered`);
    this.tasks.set(name, { name, intervalMs, tick });
  }

  onApplicationBootstrap(): void {
    if (!this.config.get('SCHEDULER_ENABLED', { infer: true })) return;
    for (const task of this.tasks.values()) {
      task.timer = setInterval(() => void this.run(task), task.intervalMs);
      task.timer.unref?.();
      // First tick shortly after start so a fresh deployment does not wait a whole interval.
      const first = setTimeout(() => void this.run(task), 5_000);
      first.unref?.();
    }
    this.logger.log(`Scheduler started with ${this.tasks.size} task(s)`);
  }

  onApplicationShutdown(): void {
    for (const task of this.tasks.values()) if (task.timer) clearInterval(task.timer);
  }

  /** Runs one task immediately (tests and operational tooling). */
  async runNow(name: string): Promise<void> {
    const task = this.tasks.get(name);
    if (!task) throw new Error(`Unknown scheduled task "${name}"`);
    await task.tick();
  }

  private async run(task: Task): Promise<void> {
    try {
      await task.tick();
    } catch (err) {
      this.logger.error(`Scheduled task "${task.name}" failed: ${sanitizeError(err)}`);
    }
  }
}

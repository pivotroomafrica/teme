import { Injectable } from '@nestjs/common';
import type { ClaimedJob } from '../infrastructure/outbox.repository';

/**
 * Thrown by a handler to say retrying cannot help (bad data, revoked access...). The job is
 * dead-lettered immediately instead of burning its whole attempt budget.
 */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

export interface OutboxHandler {
  /** Must be idempotent: a job can be delivered more than once (crash after the work, before the ack). */
  handle(job: ClaimedJob): Promise<void>;
}

/** Feature modules register handlers here; the jobs module never depends on them. */
@Injectable()
export class OutboxHandlerRegistry {
  private readonly handlers = new Map<string, OutboxHandler>();

  register(type: string, handler: OutboxHandler): void {
    if (this.handlers.has(type))
      throw new Error(`Outbox handler for "${type}" is already registered`);
    this.handlers.set(type, handler);
  }

  get(type: string): OutboxHandler | undefined {
    return this.handlers.get(type);
  }
}

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { DbClient } from '../../../database/db-client';
import { PrismaService } from '../../../database/prisma.service';

export interface NewOutboxJob {
  merchantId?: string | null;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

export interface ClaimedJob {
  id: string;
  merchantId: string | null;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  /** Includes the attempt that is starting now. */
  attempts: number;
  maxAttempts: number;
}

export interface DeadJob {
  id: string;
  merchantId: string | null;
  type: string;
  aggregateType: string;
  aggregateId: string;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
}

@Injectable()
export class OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  async insert(job: NewOutboxJob, db: DbClient = this.prisma): Promise<void> {
    await db.outboxJob.create({
      data: { ...job, payload: job.payload as Prisma.InputJsonValue },
    });
  }

  /** Inserts unless a job with the same dedupe key already exists. Returns whether it was inserted. */
  async insertIfAbsent(
    job: NewOutboxJob & { dedupeKey: string },
    db: DbClient = this.prisma,
  ): Promise<boolean> {
    const res = await db.outboxJob.createMany({
      data: [{ ...job, payload: job.payload as Prisma.InputJsonValue }],
      skipDuplicates: true,
    });
    return res.count === 1;
  }

  /**
   * Atomically takes up to `limit` due jobs for this worker. `FOR UPDATE SKIP LOCKED` lets several
   * workers or instances run side by side without ever claiming the same job. Jobs whose worker died
   * (PROCESSING past the lease) are reclaimed.
   */
  async claimDue(workerId: string, limit: number, leaseSeconds: number): Promise<ClaimedJob[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        merchant_id: string | null;
        type: string;
        aggregate_type: string;
        aggregate_id: string;
        payload: Record<string, unknown>;
        attempts: number;
        max_attempts: number;
      }>
    >`
      UPDATE outbox_jobs SET status = 'PROCESSING', locked_at = clock_timestamp(),
             locked_by = ${workerId}, attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM outbox_jobs
        WHERE (status IN ('PENDING', 'FAILED') AND next_run_at <= clock_timestamp())
           OR (status = 'PROCESSING' AND locked_at < clock_timestamp() - make_interval(secs => ${leaseSeconds}))
        ORDER BY next_run_at ASC, created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, merchant_id, type, aggregate_type, aggregate_id, payload, attempts, max_attempts`;
    return rows.map((r) => ({
      id: r.id,
      merchantId: r.merchant_id,
      type: r.type,
      aggregateType: r.aggregate_type,
      aggregateId: r.aggregate_id,
      payload: r.payload ?? {},
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
    }));
  }

  async markCompleted(id: string): Promise<void> {
    await this.prisma.outboxJob.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      },
    });
  }

  async markRetry(id: string, nextRunAt: Date, error: string): Promise<void> {
    await this.prisma.outboxJob.update({
      where: { id },
      data: { status: 'FAILED', nextRunAt, lockedAt: null, lockedBy: null, lastError: error },
    });
  }

  /** Dead-letter: no more automatic attempts; an operator can inspect and requeue it. */
  async markDead(id: string, error: string): Promise<void> {
    await this.prisma.outboxJob.update({
      where: { id },
      data: { status: 'DEAD', lockedAt: null, lockedBy: null, lastError: error },
    });
  }

  async listDead(limit: number): Promise<DeadJob[]> {
    return this.prisma.outboxJob.findMany({
      where: { status: 'DEAD' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        merchantId: true,
        type: true,
        aggregateType: true,
        aggregateId: true,
        attempts: true,
        lastError: true,
        createdAt: true,
      },
    });
  }

  /** Gives a dead job a fresh attempt budget. Returns false if it was not dead. */
  async requeueDead(id: string): Promise<DeadJob | null> {
    const res = await this.prisma.outboxJob.updateMany({
      where: { id, status: 'DEAD' },
      data: { status: 'PENDING', attempts: 0, nextRunAt: new Date(), lastError: null },
    });
    if (res.count !== 1) return null;
    return this.prisma.outboxJob.findUnique({
      where: { id },
      select: {
        id: true,
        merchantId: true,
        type: true,
        aggregateType: true,
        aggregateId: true,
        attempts: true,
        lastError: true,
        createdAt: true,
      },
    });
  }

  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.prisma.outboxJob.groupBy({ by: ['status'], _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }
}

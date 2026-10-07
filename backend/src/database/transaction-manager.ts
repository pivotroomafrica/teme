import { Injectable } from '@nestjs/common';
import type { DbClient } from './db-client';
import { PrismaService } from './prisma.service';

/**
 * The only way application code opens a database transaction. Use-cases receive a DbClient
 * and pass it to repositories so every write in one business operation commits atomically.
 */
@Injectable()
export class TransactionManager {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(fn: (db: DbClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => fn(tx), { maxWait: 5_000, timeout: 15_000 });
  }
}

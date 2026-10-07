import type { Prisma, PrismaClient } from '@prisma/client';

/** Either the shared client or a transaction handle. Repositories accept both. */
export type DbClient = PrismaClient | Prisma.TransactionClient;

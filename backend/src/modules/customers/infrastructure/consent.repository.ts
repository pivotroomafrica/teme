import { Injectable } from '@nestjs/common';
import type { ConsentAction, ConsentSource, ConsentType } from '@prisma/client';
import type { DbClient } from '../../../database/db-client';
import { PrismaService } from '../../../database/prisma.service';
import type { ConsentRow } from '../domain/consent';

export interface NewConsent {
  customerId: string;
  type: ConsentType;
  action: ConsentAction;
  version: string;
  source: ConsentSource;
}

export interface ConsentHistoryRow extends ConsentRow {
  id: string;
  version: string;
  source: ConsentSource;
}

/** Append-only consent ledger. Withdrawal is a new row, never an update. */
@Injectable()
export class ConsentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async append(merchantId: string, rows: NewConsent[], db: DbClient): Promise<void> {
    if (rows.length === 0) return;
    await db.customerConsent.createMany({ data: rows.map((r) => ({ merchantId, ...r })) });
  }

  /** All rows for the given customers (a page worth), newest first. */
  async forCustomers(
    merchantId: string,
    customerIds: string[],
    db: DbClient = this.prisma,
  ): Promise<Map<string, ConsentHistoryRow[]>> {
    const out = new Map<string, ConsentHistoryRow[]>();
    if (customerIds.length === 0) return out;
    const rows = await db.customerConsent.findMany({
      where: { merchantId, customerId: { in: customerIds } },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        customerId: true,
        type: true,
        action: true,
        version: true,
        source: true,
        occurredAt: true,
      },
    });
    for (const r of rows) {
      const list = out.get(r.customerId) ?? [];
      list.push(r);
      out.set(r.customerId, list);
    }
    return out;
  }
}

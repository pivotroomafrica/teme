import { Injectable } from '@nestjs/common';
import type { CustomerStatus, Language, MembershipStatus, Prisma } from '@prisma/client';
import type { DbClient } from '../../../database/db-client';
import { PrismaService } from '../../../database/prisma.service';
import type { ParsedCustomerQuery } from '../domain/customer-query';

export interface CustomerRecord {
  id: string;
  phoneE164: string | null;
  firstName: string | null;
  preferredLanguage: Language;
  status: CustomerStatus;
  createdAt: Date;
  memberships: Array<{
    id: string;
    programId: string;
    status: MembershipStatus;
    joinedAt: Date;
  }>;
}

const select = {
  id: true,
  phoneE164: true,
  firstName: true,
  preferredLanguage: true,
  status: true,
  createdAt: true,
  memberships: {
    orderBy: { joinedAt: 'asc' },
    select: { id: true, programId: true, status: true, joinedAt: true },
  },
} satisfies Prisma.CustomerSelect;

/** Every query is scoped by merchantId, so one merchant can never see another's customers. */
@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Newest first, keyset-paginated. The query decides which column is matched. */
  search(
    merchantId: string,
    query: ParsedCustomerQuery,
    limit: number,
    after: { at: Date; id: string } | null,
  ): Promise<CustomerRecord[]> {
    if (query.kind === 'invalid') return Promise.resolve([]);

    const where: Prisma.CustomerWhereInput = { merchantId, status: 'ACTIVE' };
    if (query.kind === 'phone') where.phoneE164 = query.phone;
    if (query.kind === 'phone-partial') where.phoneE164 = { contains: query.digits };
    if (query.kind === 'name') where.firstName = { contains: query.text, mode: 'insensitive' };
    if (after) {
      where.AND = [
        {
          OR: [{ createdAt: { lt: after.at } }, { createdAt: after.at, id: { lt: after.id } }],
        },
      ];
    }
    return this.prisma.customer.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select,
    });
  }

  findById(
    merchantId: string,
    id: string,
    db: DbClient = this.prisma,
  ): Promise<CustomerRecord | null> {
    return db.customer.findFirst({ where: { id, merchantId }, select });
  }

  /** What a wallet card shows about the customer: first name and language. */
  async findDisplay(
    merchantId: string,
    id: string,
    db: DbClient = this.prisma,
  ): Promise<{ firstName: string | null; preferredLanguage: Language } | null> {
    return db.customer.findFirst({
      where: { id, merchantId },
      select: { firstName: true, preferredLanguage: true },
    });
  }

  /** First name only, for showing who is being served at the counter. */
  async findFirstName(
    merchantId: string,
    id: string,
    db: DbClient = this.prisma,
  ): Promise<string | null> {
    const c = await db.customer.findFirst({
      where: { id, merchantId },
      select: { firstName: true },
    });
    return c?.firstName ?? null;
  }

  findByPhone(
    merchantId: string,
    phoneE164: string,
    db: DbClient = this.prisma,
  ): Promise<CustomerRecord | null> {
    return db.customer.findFirst({ where: { merchantId, phoneE164 }, select });
  }

  async create(
    merchantId: string,
    data: { phoneE164: string; firstName: string; preferredLanguage: Language },
    db: DbClient,
  ): Promise<string> {
    const row = await db.customer.create({
      data: { merchantId, ...data },
      select: { id: true },
    });
    return row.id;
  }

  /** Fills gaps only; never overwrites what the customer or staff already recorded. */
  async fillMissing(
    merchantId: string,
    id: string,
    data: { firstName?: string },
    db: DbClient,
  ): Promise<void> {
    if (data.firstName) {
      await db.customer.updateMany({
        where: { id, merchantId, firstName: null },
        data: { firstName: data.firstName },
      });
    }
  }
}

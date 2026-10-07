import { Injectable } from '@nestjs/common';
import type { RequestMeta } from '../../../common/decorators/request-context.decorator';
import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import {
  DEFAULT_PAGE_SIZE,
  Page,
  decodeCursor,
  encodeCursor,
} from '../../../common/http/pagination';
import { TransactionManager } from '../../../database/transaction-manager';
import type { MerchantActor } from '../../tenancy';
import { isGranted } from '../domain/consent';
import { maskPhone, parseCustomerQuery } from '../domain/customer-query';
import { ConsentRepository } from '../infrastructure/consent.repository';
import { CustomerRecord, CustomersRepository } from '../infrastructure/customers.repository';
import { ConsentService } from './consent.service';

export interface CustomerView {
  id: string;
  firstName: string | null;
  /** Full number for roles with customer:manage, masked for everyone else. */
  phone: string | null;
  phoneMasked: boolean;
  preferredLanguage: string;
  joinedAt: Date;
  marketingConsent: boolean;
  memberships: CustomerRecord['memberships'];
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly customers: CustomersRepository,
    private readonly consents: ConsentRepository,
    private readonly consentService: ConsentService,
    private readonly transactions: TransactionManager,
  ) {}

  async search(
    actor: MerchantActor,
    input: { q?: string; limit?: number; cursor?: string },
  ): Promise<Page<CustomerView>> {
    const query = parseCustomerQuery(input.q);
    const limit = input.limit ?? DEFAULT_PAGE_SIZE;
    // Branch staff must type a complete number to find someone; partial-number browsing is for managers.
    const effective =
      query.kind === 'phone-partial' && !this.canManage(actor)
        ? { kind: 'invalid' as const }
        : query;

    const rows = await this.customers.search(
      actor.merchantId,
      effective,
      limit + 1,
      decodeCursor(input.cursor),
    );
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: await this.toViews(actor, page),
      nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  async get(actor: MerchantActor, customerId: string): Promise<CustomerView> {
    const row = await this.customers.findById(actor.merchantId, customerId);
    if (!row) throw new DomainError(ErrorCode.NOT_FOUND, 'Customer not found.', 404);
    return (await this.toViews(actor, [row]))[0] as CustomerView;
  }

  /** Withdraws marketing consent only; the customer keeps their membership and card. */
  async withdrawMarketing(
    actor: MerchantActor,
    customerId: string,
    meta: RequestMeta,
  ): Promise<CustomerView> {
    await this.transactions.run(async (db) => {
      const row = await this.customers.findById(actor.merchantId, customerId, db);
      if (!row) throw new DomainError(ErrorCode.NOT_FOUND, 'Customer not found.', 404);
      await this.consentService.withdrawMarketing(
        {
          merchantId: actor.merchantId,
          customerId,
          source: 'STAFF_ASSISTED',
          actorUserId: actor.userId,
          requestId: meta.requestId,
        },
        db,
      );
    });
    return this.get(actor, customerId);
  }

  private canManage(actor: MerchantActor): boolean {
    return actor.permissions.has('customer:manage');
  }

  private async toViews(actor: MerchantActor, rows: CustomerRecord[]): Promise<CustomerView[]> {
    const history = await this.consents.forCustomers(
      actor.merchantId,
      rows.map((r) => r.id),
    );
    const full = this.canManage(actor);
    return rows.map((r) => ({
      id: r.id,
      firstName: r.firstName,
      phone: full ? r.phoneE164 : maskPhone(r.phoneE164),
      phoneMasked: !full,
      preferredLanguage: r.preferredLanguage,
      joinedAt: r.createdAt,
      marketingConsent: isGranted(history.get(r.id) ?? [], 'MARKETING'),
      memberships: r.memberships,
    }));
  }
}

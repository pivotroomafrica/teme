import { Injectable } from '@nestjs/common';
import type { RequestMeta } from '../../../common/decorators/request-context.decorator';
import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { AuditService } from '../../audit';
import type { MerchantActor } from '../../tenancy';
import { buildCustomerExport, type CustomerExport } from '../domain/customer-export';
import { PrivacyRepository } from '../infrastructure/privacy.repository';

/** Lets a merchant owner see, and hand over, everything stored about one customer. Every use is audited. */
@Injectable()
export class CustomerDataService {
  constructor(
    private readonly repository: PrivacyRepository,
    private readonly audit: AuditService,
  ) {}

  view(actor: MerchantActor, customerId: string, meta: RequestMeta): Promise<CustomerExport> {
    return this.read(actor, customerId, 'customer.data_viewed', meta);
  }

  export(actor: MerchantActor, customerId: string, meta: RequestMeta): Promise<CustomerExport> {
    return this.read(actor, customerId, 'customer.data_exported', meta);
  }

  private async read(
    actor: MerchantActor,
    customerId: string,
    action: string,
    meta: RequestMeta,
  ): Promise<CustomerExport> {
    const data = await this.repository.collect(actor.merchantId, customerId);
    if (!data) throw new DomainError(ErrorCode.NOT_FOUND, 'Customer not found.', 404);
    // The audit row names the customer by id only; the data itself never enters the audit log.
    await this.audit.record({
      action,
      actorUserId: actor.userId,
      merchantId: actor.merchantId,
      targetType: 'customer',
      targetId: customerId,
      requestId: meta.requestId,
    });
    return buildCustomerExport(data, new Date());
  }
}

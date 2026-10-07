import { Injectable } from '@nestjs/common';
import type { DbClient } from '../../../database/db-client';
import { AuditService } from '../../audit';
import { CURRENT_CONSENT_VERSION, ConsentSource, isGranted } from '../domain/consent';
import { ConsentRepository } from '../infrastructure/consent.repository';

/**
 * Consent is an append-only ledger. Loyalty membership does not depend on marketing consent, so
 * withdrawing it only appends a WITHDRAWN row: the customer, membership and card are untouched.
 */
@Injectable()
export class ConsentService {
  constructor(
    private readonly consents: ConsentRepository,
    private readonly audit: AuditService,
  ) {}

  /** Idempotent. Returns true when a withdrawal row was actually written. */
  async withdrawMarketing(
    input: {
      merchantId: string;
      customerId: string;
      source: ConsentSource;
      actorUserId: string | null;
      requestId?: string;
    },
    db: DbClient,
  ): Promise<boolean> {
    const history = (
      await this.consents.forCustomers(input.merchantId, [input.customerId], db)
    ).get(input.customerId);
    if (!isGranted(history ?? [], 'MARKETING')) return false;

    await this.consents.append(
      input.merchantId,
      [
        {
          customerId: input.customerId,
          type: 'MARKETING',
          action: 'WITHDRAWN',
          version: CURRENT_CONSENT_VERSION,
          source: input.source,
        },
      ],
      db,
    );
    await this.audit.record(
      {
        action: 'customer.marketing_consent_withdrawn',
        actorType: input.actorUserId ? 'USER' : 'SYSTEM',
        actorUserId: input.actorUserId,
        merchantId: input.merchantId,
        targetType: 'customer',
        targetId: input.customerId,
        requestId: input.requestId,
        metadata: { source: input.source },
      },
      db,
    );
    return true;
  }
}

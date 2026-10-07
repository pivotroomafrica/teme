import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainError } from '../../../common/errors/domain-error';
import type { Env } from '../../../config/env.schema';
import type { DbClient } from '../../../database/db-client';
import { IdempotencyRepository } from '../infrastructure/idempotency.repository';

/**
 * Shared idempotency policy for every state-changing request: a key is scoped to a staff member and an
 * operation, remembers the answer, and refuses to be reused for a different request.
 */
@Injectable()
export class IdempotencyService {
  constructor(
    private readonly repository: IdempotencyRepository,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** The stored answer for this key, or null. Throws 422 if the key was used for another request. */
  async find(
    staffMembershipId: string,
    operation: string,
    key: string,
    fingerprint: string,
    db: DbClient,
  ): Promise<unknown | null> {
    const stored = await this.repository.find(staffMembershipId, operation, key, db);
    if (!stored) return null;
    if (stored.requestHash !== fingerprint) {
      throw new DomainError(
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used for a different request.',
        422,
      );
    }
    return stored.responseBody;
  }

  async remember(
    input: {
      merchantId: string;
      staffMembershipId: string;
      operation: string;
      key: string;
      fingerprint: string;
      response: unknown;
      /** The membership the answer is about, so anonymizing that customer can purge it. */
      membershipId?: string | null;
    },
    db: DbClient,
  ): Promise<void> {
    const ttlMs = this.config.get('IDEMPOTENCY_TTL_HOURS', { infer: true }) * 3_600_000;
    await this.repository.store(
      {
        merchantId: input.merchantId,
        staffMembershipId: input.staffMembershipId,
        operation: input.operation,
        key: input.key,
        membershipId: input.membershipId ?? null,
        requestHash: input.fingerprint,
        responseStatus: 200,
        responseBody: input.response,
        expiresAt: new Date(Date.now() + ttlMs),
      },
      db,
    );
  }
}

import { Injectable } from '@nestjs/common';
import type { RequestMeta } from '../../../common/decorators/request-context.decorator';
import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { normalizeEthiopianPhone } from '../../../common/phone/ethiopian-phone';
import { TransactionManager } from '../../../database/transaction-manager';
import { AuditService } from '../../audit';
import type { MerchantActor } from '../../tenancy';
import {
  BranchData,
  BranchRecord,
  BranchesRepository,
} from '../infrastructure/branches.repository';

export interface BranchInput {
  nameEn?: string;
  nameAm?: string | null;
  addressText?: string | null;
  city?: string | null;
  phone?: string | null;
}

const notFound = () => new DomainError(ErrorCode.NOT_FOUND, 'Branch not found.', 404);
const validation = (message: string) => new DomainError(ErrorCode.VALIDATION_FAILED, message, 400);

@Injectable()
export class BranchesService {
  constructor(
    private readonly repository: BranchesRepository,
    private readonly audit: AuditService,
    private readonly transactions: TransactionManager,
  ) {}

  /** Owners and managers see every branch; branch staff only their assigned active branches. */
  list(actor: MerchantActor): Promise<BranchRecord[]> {
    return this.repository.list(actor.merchantId, actor.branchScope);
  }

  /** Another tenant's branch and an unassigned branch are both reported as not found. */
  async get(actor: MerchantActor, branchId: string): Promise<BranchRecord> {
    const branch = await this.repository.findById(actor.merchantId, branchId, actor.branchScope);
    if (!branch) throw notFound();
    return branch;
  }

  async create(
    actor: MerchantActor,
    input: BranchInput & { nameEn: string },
    meta: RequestMeta,
  ): Promise<BranchRecord> {
    const data = this.toData(input) as BranchData & { nameEn: string };
    return this.transactions.run(async (db) => {
      const branch = await this.repository.create(actor.merchantId, data, db);
      await this.audit.record(
        {
          action: 'branch.created',
          actorUserId: actor.userId,
          merchantId: actor.merchantId,
          branchId: branch.id,
          targetType: 'branch',
          targetId: branch.id,
          requestId: meta.requestId,
        },
        db,
      );
      return branch;
    });
  }

  async update(
    actor: MerchantActor,
    branchId: string,
    input: BranchInput,
    meta: RequestMeta,
  ): Promise<BranchRecord> {
    const data = this.toData(input);
    if (Object.keys(data).length === 0) throw validation('Provide at least one field to update.');

    return this.transactions.run(async (db) => {
      const current = await this.repository.findById(actor.merchantId, branchId, 'ALL', db);
      if (!current) throw notFound();
      const changed = (Object.keys(data) as Array<keyof BranchData>).filter(
        (k) => data[k] !== current[k],
      );
      if (changed.length === 0) return current;

      await this.repository.update(actor.merchantId, branchId, data, db);
      await this.audit.record(
        {
          action: 'branch.updated',
          actorUserId: actor.userId,
          merchantId: actor.merchantId,
          branchId,
          targetType: 'branch',
          targetId: branchId,
          requestId: meta.requestId,
          metadata: { changedFields: changed },
        },
        db,
      );
      return (await this.repository.findById(
        actor.merchantId,
        branchId,
        'ALL',
        db,
      )) as BranchRecord;
    });
  }

  /** Branch history is kept. A merchant always keeps at least one active branch. Idempotent. */
  async deactivate(
    actor: MerchantActor,
    branchId: string,
    meta: RequestMeta,
  ): Promise<BranchRecord> {
    const now = new Date();
    return this.transactions.run(async (db) => {
      const active = await this.repository.lockActiveBranchIds(actor.merchantId, db);
      const branch = await this.repository.findById(actor.merchantId, branchId, 'ALL', db);
      if (!branch) throw notFound();
      if (branch.status === 'INACTIVE') return branch;
      if (active.length <= 1) {
        throw new DomainError(
          'LAST_ACTIVE_BRANCH',
          'A merchant must keep at least one active branch.',
          409,
        );
      }
      await this.repository.setStatus(actor.merchantId, branchId, 'INACTIVE', now, db);
      await this.recordStatus('branch.deactivated', actor, branchId, meta, db);
      return { ...branch, status: 'INACTIVE' };
    });
  }

  async activate(actor: MerchantActor, branchId: string, meta: RequestMeta): Promise<BranchRecord> {
    return this.transactions.run(async (db) => {
      const branch = await this.repository.findById(actor.merchantId, branchId, 'ALL', db);
      if (!branch) throw notFound();
      if (branch.status === 'ACTIVE') return branch;
      await this.repository.setStatus(actor.merchantId, branchId, 'ACTIVE', new Date(), db);
      await this.recordStatus('branch.activated', actor, branchId, meta, db);
      return { ...branch, status: 'ACTIVE' };
    });
  }

  private recordStatus(
    action: string,
    actor: MerchantActor,
    branchId: string,
    meta: RequestMeta,
    db: Parameters<AuditService['record']>[1],
  ) {
    return this.audit.record(
      {
        action,
        actorUserId: actor.userId,
        merchantId: actor.merchantId,
        branchId,
        targetType: 'branch',
        targetId: branchId,
        requestId: meta.requestId,
      },
      db,
    );
  }

  private toData(input: BranchInput): BranchData {
    const data: BranchData = {};
    if (input.nameEn !== undefined) data.nameEn = input.nameEn.trim();
    if (input.nameAm !== undefined) data.nameAm = input.nameAm?.trim() || null;
    if (input.addressText !== undefined) data.addressText = input.addressText?.trim() || null;
    if (input.city !== undefined) data.city = input.city?.trim() || null;
    if (input.phone !== undefined) {
      if (input.phone === null || input.phone.trim() === '') {
        data.phoneE164 = null;
      } else {
        const phone = normalizeEthiopianPhone(input.phone);
        if (!phone) throw validation('Branch phone must be a valid Ethiopian phone number.');
        data.phoneE164 = phone;
      }
    }
    return data;
  }
}

import { Injectable } from '@nestjs/common';
import type { DbClient } from '../../../database/db-client';
import { sanitizeMetadata } from '../domain/sanitize-metadata';
import { AuditRepository } from '../infrastructure/audit.repository';

export interface AuditEntry {
  action: string;
  actorType?: 'USER' | 'SYSTEM';
  actorUserId?: string | null;
  merchantId?: string | null;
  branchId?: string | null;
  targetType?: string;
  targetId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  /**
   * Pass the active transaction so the audit row commits or rolls back with the change it
   * describes. Metadata is sanitized to keep secrets and personal data out of the history.
   */
  async record(entry: AuditEntry, db?: DbClient): Promise<void> {
    await this.repository.append(
      {
        action: entry.action,
        actorType: entry.actorType ?? 'USER',
        actorUserId: entry.actorUserId ?? null,
        merchantId: entry.merchantId ?? null,
        branchId: entry.branchId ?? null,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        requestId: entry.requestId ?? null,
        metadata: sanitizeMetadata(entry.metadata ?? {}) as object,
      },
      db,
    );
  }
}

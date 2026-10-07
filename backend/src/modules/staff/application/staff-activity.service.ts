import { Injectable } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import {
  DEFAULT_PAGE_SIZE,
  Page,
  decodeCursor,
  encodeCursor,
} from '../../../common/http/pagination';
import type { MerchantActor } from '../../tenancy';
import {
  ActivityEvent,
  ActivitySummary,
  StaffActivityRepository,
} from '../infrastructure/staff-activity.repository';
import { StaffRepository } from '../infrastructure/staff.repository';

export interface StaffActivity {
  staff: { id: string; displayName: string; roleKey: string; status: string };
  summary: ActivitySummary;
  events: Page<ActivityEvent>;
}

@Injectable()
export class StaffActivityService {
  constructor(
    private readonly staff: StaffRepository,
    private readonly activity: StaffActivityRepository,
  ) {}

  async get(
    actor: MerchantActor,
    staffId: string,
    query: { limit?: number; cursor?: string },
  ): Promise<StaffActivity> {
    const target = await this.staff.findById(actor.merchantId, staffId);
    if (!target) throw new DomainError(ErrorCode.NOT_FOUND, 'Staff member not found.', 404);

    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const rows = await this.activity.events(
      actor.merchantId,
      target.userId,
      limit + 1,
      decodeCursor(query.cursor),
    );
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return {
      staff: {
        id: target.id,
        displayName: target.displayName,
        roleKey: target.roleKey,
        status: target.status,
      },
      summary: await this.activity.summary(actor.merchantId, target.id, target.userId),
      events: {
        items,
        nextCursor: rows.length > limit && last ? encodeCursor(last.occurredAt, last.id) : null,
      },
    };
  }
}

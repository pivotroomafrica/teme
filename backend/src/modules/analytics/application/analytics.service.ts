import { Injectable } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { DEFAULT_PAGE_SIZE, type Page } from '../../../common/http/pagination';
import { resolveRange } from '../../../common/time/range';
import { MerchantDirectory } from '../../merchants';
import type { MerchantActor } from '../../tenancy';
import { METRIC_DEFINITIONS } from '../domain/metric-definitions';
import { isMonth, monthOf, monthRange, monthsBetween, ratio, shiftMonth } from '../domain/periods';
import { AnalyticsRepository, type Scope } from '../infrastructure/analytics.repository';

export interface RangeQuery {
  from?: string;
  to?: string;
  programId?: string;
}
export interface PageQuery extends RangeQuery {
  limit?: number;
  cursor?: string;
}

export const MAX_COHORTS = 24;
export const MAX_COHORT_OFFSET = 12;
export const MAX_TREND_MONTHS = 24;

const bad = (message: string) => new DomainError(ErrorCode.VALIDATION_FAILED, message, 400);

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly repository: AnalyticsRepository,
    private readonly merchants: MerchantDirectory,
  ) {}

  definitions() {
    return METRIC_DEFINITIONS;
  }

  /** Dates are read in the merchant's time zone; the merchant comes from the signed-in actor only. */
  private async scope(actor: MerchantActor, q: RangeQuery, now = new Date()) {
    const timeZone = await this.merchants.timezone(actor.merchantId);
    const resolved = resolveRange(q.from, q.to, timeZone, now);
    if (!resolved.ok) throw bad(resolved.error);
    const scope: Scope = {
      merchantId: actor.merchantId,
      from: resolved.range.from,
      to: resolved.range.to,
      programId: q.programId,
    };
    return { scope, timeZone };
  }

  private describe(scope: Scope, timeZone: string) {
    return {
      from: scope.from.toISOString(),
      to: scope.to.toISOString(),
      timeZone,
      programId: scope.programId ?? null,
    };
  }

  async overview(actor: MerchantActor, q: RangeQuery) {
    const { scope, timeZone } = await this.scope(actor, q);
    const [newMembers, visits, returning, unlocked, redeemed, gaps] = await Promise.all([
      this.repository.newMembers(scope),
      this.repository.visits(scope),
      this.repository.returningCustomers(scope),
      this.repository.rewardsUnlocked(scope),
      this.repository.rewardsRedeemed(scope),
      this.repository.visitGaps(scope),
    ]);
    return {
      range: this.describe(scope, timeZone),
      newMembers,
      activeMembers: visits.activeMembers,
      returningCustomers: returning,
      stampsIssued: { count: visits.stamps, reversed: visits.reversed },
      rewardsUnlocked: unlocked,
      rewardsRedeemed: redeemed,
      redemptionRate: ratio(redeemed, unlocked),
      averageVisitsPerActiveMember: visits.activeMembers
        ? Math.round((visits.stamps / visits.activeMembers) * 100) / 100
        : null,
      timeBetweenVisits: gaps,
    };
  }

  /**
   * Monthly Returning Loyalty Customers for `month` (default: the current month) and the months before it.
   * Months follow the merchant's wall clock, so a visit at 23:30 on the last day counts in that month.
   */
  async monthlyReturning(
    actor: MerchantActor,
    query: { month?: string; months?: number; programId?: string },
  ) {
    const timeZone = await this.merchants.timezone(actor.merchantId);
    const current = monthOf(new Date(), timeZone);
    const month = query.month ?? current;
    if (!isMonth(month)) throw bad('month must look like 2026-10.');
    if (monthsBetween(current, month) > 0) throw bad('month cannot be in the future.');
    const count = query.months ?? 6;
    if (!Number.isInteger(count) || count < 1 || count > MAX_TREND_MONTHS) {
      throw bad(`months must be between 1 and ${MAX_TREND_MONTHS}.`);
    }
    const list = Array.from({ length: count }, (_, i) => shiftMonth(month, i - (count - 1)));
    const series = await Promise.all(
      list.map(async (m) => {
        const { from, to } = monthRange(m, timeZone);
        const scope: Scope = { merchantId: actor.merchantId, from, to, programId: query.programId };
        const [returning, visits] = await Promise.all([
          this.repository.returningCustomers(scope),
          this.repository.visits(scope),
        ]);
        return {
          month: m,
          returningCustomers: returning,
          activeMembers: visits.activeMembers,
          returningShare: ratio(returning, visits.activeMembers),
          partial: m === current,
        };
      }),
    );
    return {
      metric: 'monthlyReturningLoyaltyCustomers',
      timeZone,
      month,
      value: series[series.length - 1]!.returningCustomers,
      series,
    };
  }

  async branches(actor: MerchantActor, q: PageQuery) {
    const { scope, timeZone } = await this.scope(actor, q);
    const limit = this.limit(q.limit);
    const rows = await this.repository.branchActivity(scope, limit + 1, this.countCursor(q.cursor));
    return {
      range: this.describe(scope, timeZone),
      ...this.page(
        rows,
        limit,
        (r) => [r.stamps, r.id],
        (r) => ({
          branchId: r.id,
          nameEn: r.name_en,
          nameAm: r.name_am,
          stamps: r.stamps,
          uniqueCustomers: r.customers,
          redemptions: r.redemptions,
        }),
      ),
    };
  }

  async staff(actor: MerchantActor, q: PageQuery) {
    const { scope, timeZone } = await this.scope(actor, q);
    const limit = this.limit(q.limit);
    const rows = await this.repository.staffActivity(scope, limit + 1, this.countCursor(q.cursor));
    return {
      range: this.describe(scope, timeZone),
      ...this.page(
        rows,
        limit,
        (r) => [r.stamps, r.id],
        (r) => ({
          staffId: r.id,
          displayName: r.display_name,
          role: r.role_key,
          status: r.status,
          stamps: r.stamps,
          stampsReversed: r.reversed,
          reversalRate: ratio(r.reversed, r.stamps + r.reversed),
          uniqueCustomers: r.customers,
          redemptions: r.redemptions,
        }),
      ),
    };
  }

  async returningCustomerList(actor: MerchantActor, q: PageQuery) {
    const { scope, timeZone } = await this.scope(actor, q);
    const limit = this.limit(q.limit);
    const rows = await this.repository.returningCustomerRows(
      scope,
      limit + 1,
      this.timeCursor(q.cursor),
    );
    return {
      range: this.describe(scope, timeZone),
      ...this.page(
        rows,
        limit,
        (r) => [r.last_visit_at.toISOString(), r.id],
        (r) => ({
          customerId: r.id,
          firstName: r.first_name,
          visitsInRange: r.visits,
          lastVisitAt: r.last_visit_at,
          previousVisitAt: r.previous_visit_at,
        }),
      ),
    };
  }

  async cohorts(actor: MerchantActor, q: { cohorts?: number; programId?: string }) {
    const timeZone = await this.merchants.timezone(actor.merchantId);
    const count = q.cohorts ?? 6;
    if (!Number.isInteger(count) || count < 1 || count > MAX_COHORTS) {
      throw bad(`cohorts must be between 1 and ${MAX_COHORTS}.`);
    }
    const current = monthOf(new Date(), timeZone);
    const first = shiftMonth(current, -(count - 1));
    const { sizes, retained } = await this.repository.cohorts({
      merchantId: actor.merchantId,
      timeZone,
      firstCohortStart: monthRange(first, timeZone).from,
      programId: q.programId,
    });
    const sizeOf = new Map(sizes.map((s) => [s.cohort, s.size]));
    const retainedOf = new Map(retained.map((r) => [`${r.cohort}:${r.k}`, r.retained]));
    const cohorts = Array.from({ length: count }, (_, i) => {
      const cohortMonth = shiftMonth(first, i);
      const size = sizeOf.get(cohortMonth) ?? 0;
      const elapsed = Math.min(monthsBetween(cohortMonth, current), MAX_COHORT_OFFSET);
      return {
        cohortMonth,
        size,
        retention: Array.from({ length: elapsed + 1 }, (_, k) => {
          const n = retainedOf.get(`${cohortMonth}:${k}`) ?? 0;
          return { monthOffset: k, retained: n, rate: ratio(n, size) };
        }),
      };
    });
    return { timeZone, programId: q.programId ?? null, cohorts };
  }

  async wallet(actor: MerchantActor, q: RangeQuery) {
    const { scope, timeZone } = await this.scope(actor, q);
    const [adoption, jobs] = await Promise.all([
      this.repository.walletAdoption(actor.merchantId, q.programId),
      this.repository.walletUpdateJobs(scope),
    ]);
    const count = (status: string) => jobs.find((j) => j.status === status)?.jobs ?? 0;
    const succeeded = count('COMPLETED');
    const failed = count('DEAD');
    const queued = count('PENDING') + count('PROCESSING') + count('FAILED');
    const providers = ['APPLE', 'GOOGLE', 'WEB'].map((provider) => {
      const memberships =
        adoption.byProvider.find((p) => p.provider === provider)?.memberships ?? 0;
      return {
        provider,
        memberships,
        adoptionRate: ratio(memberships, adoption.activeMemberships),
      };
    });
    return {
      range: this.describe(scope, timeZone),
      activeMemberships: adoption.activeMemberships,
      providers,
      passSync: adoption.sync,
      updates: {
        succeeded,
        failed,
        stillQueued: queued,
        succeededAfterRetry: jobs.find((j) => j.status === 'COMPLETED')?.retried ?? 0,
        successRate: ratio(succeeded, succeeded + failed),
      },
    };
  }

  // ───────── pagination helpers ─────────

  private limit(requested?: number): number {
    return requested ?? DEFAULT_PAGE_SIZE;
  }

  private decode(cursor: string | undefined): [unknown, unknown] | null {
    if (!cursor) return null;
    try {
      const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
      if (Array.isArray(v) && v.length === 2) return v as [unknown, unknown];
    } catch {
      /* fall through */
    }
    throw bad('Invalid cursor.');
  }

  private countCursor(cursor?: string) {
    const v = this.decode(cursor);
    if (!v) return null;
    if (!Number.isInteger(v[0]) || typeof v[1] !== 'string' || !/^[0-9a-f-]{36}$/i.test(v[1])) {
      throw bad('Invalid cursor.');
    }
    return { count: v[0] as number, id: v[1] };
  }

  private timeCursor(cursor?: string) {
    const v = this.decode(cursor);
    if (!v) return null;
    const at = typeof v[0] === 'string' ? new Date(v[0]) : null;
    if (
      !at ||
      Number.isNaN(at.getTime()) ||
      typeof v[1] !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(v[1])
    ) {
      throw bad('Invalid cursor.');
    }
    return { at, id: v[1] };
  }

  private page<R, V>(
    rows: R[],
    limit: number,
    key: (row: R) => [string | number, string],
    view: (row: R) => V,
  ): Page<V> {
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    const next =
      rows.length > limit && last
        ? Buffer.from(JSON.stringify(key(last))).toString('base64url')
        : null;
    return { items: items.map(view), nextCursor: next };
  }
}

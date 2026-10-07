import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

export interface Scope {
  merchantId: string;
  from: Date;
  to: Date;
  programId?: string;
}

export interface CountAfter {
  count: number;
  id: string;
}
export interface TimeAfter {
  at: Date;
  id: string;
}

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

/**
 * Read-only aggregate queries. Every statement filters on merchant_id first (so it can use the
 * (merchant_id, …) indexes and can never mix tenants), and "a stamp that counts" always means one with no
 * row in reversal_events. Counts are computed in PostgreSQL; nothing is loaded into memory row by row.
 */
@Injectable()
export class AnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private program(alias: string, programId?: string) {
    return programId
      ? Prisma.sql`AND ${Prisma.raw(alias)}.program_id = ${programId}::uuid`
      : Prisma.empty;
  }

  async newMembers(s: Scope): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM customer_memberships m
      WHERE m.merchant_id = ${s.merchantId}::uuid
        AND m.joined_at >= ${s.from} AND m.joined_at < ${s.to}
        ${this.program('m', s.programId)}`;
    return n(rows[0]?.n);
  }

  async visits(s: Scope): Promise<{ stamps: number; reversed: number; activeMembers: number }> {
    const rows = await this.prisma.$queryRaw<
      Array<{ stamps: bigint; reversed: bigint; active: bigint }>
    >`
      SELECT count(*) FILTER (WHERE rv.id IS NULL) AS stamps,
             count(*) FILTER (WHERE rv.id IS NOT NULL) AS reversed,
             count(DISTINCT m.customer_id) FILTER (WHERE rv.id IS NULL) AS active
      FROM stamp_events s
      JOIN customer_memberships m ON m.id = s.membership_id AND m.merchant_id = s.merchant_id
      LEFT JOIN reversal_events rv ON rv.stamp_event_id = s.id
      WHERE s.merchant_id = ${s.merchantId}::uuid
        AND s.occurred_at >= ${s.from} AND s.occurred_at < ${s.to}
        ${this.program('s', s.programId)}`;
    const r = rows[0];
    return { stamps: n(r?.stamps), reversed: n(r?.reversed), activeMembers: n(r?.active) };
  }

  /** Customers with a qualifying visit in the range AND an earlier one (the building block of the north-star). */
  async returningCustomers(s: Scope): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM (
        SELECT DISTINCT m.customer_id
        FROM stamp_events s
        JOIN customer_memberships m ON m.id = s.membership_id AND m.merchant_id = s.merchant_id
        LEFT JOIN reversal_events rv ON rv.stamp_event_id = s.id
        WHERE s.merchant_id = ${s.merchantId}::uuid
          AND s.occurred_at >= ${s.from} AND s.occurred_at < ${s.to}
          AND rv.id IS NULL
          ${this.program('s', s.programId)}
      ) a
      WHERE EXISTS (
        SELECT 1 FROM customer_memberships m2
        JOIN stamp_events s2 ON s2.membership_id = m2.id AND s2.merchant_id = m2.merchant_id
        WHERE m2.merchant_id = ${s.merchantId}::uuid AND m2.customer_id = a.customer_id
          AND s2.occurred_at < ${s.from}
          AND NOT EXISTS (SELECT 1 FROM reversal_events r2 WHERE r2.stamp_event_id = s2.id)
          ${this.program('s2', s.programId)}
      )`;
    return n(rows[0]?.n);
  }

  async rewardsUnlocked(s: Scope): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM reward_unlocks ru
      LEFT JOIN reversal_events rv ON rv.stamp_event_id = ru.triggering_stamp_id
      WHERE ru.merchant_id = ${s.merchantId}::uuid
        AND ru.unlocked_at >= ${s.from} AND ru.unlocked_at < ${s.to}
        AND rv.id IS NULL
        ${this.program('ru', s.programId)}`;
    return n(rows[0]?.n);
  }

  async rewardsRedeemed(s: Scope): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM redemption_events re
      JOIN reward_unlocks ru ON ru.id = re.reward_unlock_id AND ru.merchant_id = re.merchant_id
      LEFT JOIN reversal_events rv ON rv.redemption_event_id = re.id
      WHERE re.merchant_id = ${s.merchantId}::uuid
        AND re.occurred_at >= ${s.from} AND re.occurred_at < ${s.to}
        AND rv.id IS NULL
        ${this.program('ru', s.programId)}`;
    return n(rows[0]?.n);
  }

  /** Hours between consecutive qualifying visits on one card, for visits that happened in the range. */
  async visitGaps(s: Scope): Promise<{
    intervals: number;
    averageHours: number | null;
    medianHours: number | null;
    p90Hours: number | null;
  }> {
    const rows = await this.prisma.$queryRaw<
      Array<{ n: bigint; avg: number | null; med: number | null; p90: number | null }>
    >`
      WITH v AS (
        SELECT s.occurred_at,
               lag(s.occurred_at) OVER (PARTITION BY s.membership_id ORDER BY s.occurred_at, s.id) AS prev
        FROM stamp_events s
        LEFT JOIN reversal_events rv ON rv.stamp_event_id = s.id
        WHERE s.merchant_id = ${s.merchantId}::uuid
          AND s.occurred_at < ${s.to}
          AND rv.id IS NULL
          ${this.program('s', s.programId)}
          AND s.membership_id IN (
            SELECT s3.membership_id FROM stamp_events s3
            WHERE s3.merchant_id = ${s.merchantId}::uuid
              AND s3.occurred_at >= ${s.from} AND s3.occurred_at < ${s.to})
      ), gaps AS (
        SELECT extract(epoch FROM occurred_at - prev) / 3600.0 AS hours
        FROM v WHERE occurred_at >= ${s.from} AND prev IS NOT NULL
      )
      SELECT count(*) AS n, avg(hours)::float8 AS avg,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY hours)::float8 AS med,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY hours)::float8 AS p90
      FROM gaps`;
    const r = rows[0];
    const round = (v: number | null | undefined) => (v == null ? null : Math.round(v * 100) / 100);
    return {
      intervals: n(r?.n),
      averageHours: round(r?.avg),
      medianHours: round(r?.med),
      p90Hours: round(r?.p90),
    };
  }

  async branchActivity(s: Scope, limit: number, after: CountAfter | null) {
    const cursor = after
      ? Prisma.sql`WHERE (x.stamps < ${after.count} OR (x.stamps = ${after.count} AND x.id < ${after.id}::uuid))`
      : Prisma.empty;
    return this.prisma.$queryRaw<
      Array<{
        id: string;
        name_en: string;
        name_am: string | null;
        stamps: number;
        customers: number;
        redemptions: number;
      }>
    >`
      SELECT * FROM (
        SELECT b.id, b.name_en, b.name_am,
               coalesce(st.stamps, 0)::int AS stamps,
               coalesce(st.customers, 0)::int AS customers,
               coalesce(rd.redemptions, 0)::int AS redemptions
        FROM branches b
        LEFT JOIN (
          SELECT s.branch_id, count(*) AS stamps, count(DISTINCT m.customer_id) AS customers
          FROM stamp_events s
          JOIN customer_memberships m ON m.id = s.membership_id AND m.merchant_id = s.merchant_id
          LEFT JOIN reversal_events rv ON rv.stamp_event_id = s.id
          WHERE s.merchant_id = ${s.merchantId}::uuid
            AND s.occurred_at >= ${s.from} AND s.occurred_at < ${s.to}
            AND rv.id IS NULL ${this.program('s', s.programId)}
          GROUP BY s.branch_id) st ON st.branch_id = b.id
        LEFT JOIN (
          SELECT re.branch_id, count(*) AS redemptions
          FROM redemption_events re
          JOIN reward_unlocks ru ON ru.id = re.reward_unlock_id AND ru.merchant_id = re.merchant_id
          LEFT JOIN reversal_events rv ON rv.redemption_event_id = re.id
          WHERE re.merchant_id = ${s.merchantId}::uuid
            AND re.occurred_at >= ${s.from} AND re.occurred_at < ${s.to}
            AND rv.id IS NULL ${this.program('ru', s.programId)}
          GROUP BY re.branch_id) rd ON rd.branch_id = b.id
        WHERE b.merchant_id = ${s.merchantId}::uuid
      ) x
      ${cursor}
      ORDER BY x.stamps DESC, x.id DESC
      LIMIT ${limit}`;
  }

  async staffActivity(s: Scope, limit: number, after: CountAfter | null) {
    const cursor = after
      ? Prisma.sql`WHERE (x.stamps < ${after.count} OR (x.stamps = ${after.count} AND x.id < ${after.id}::uuid))`
      : Prisma.empty;
    return this.prisma.$queryRaw<
      Array<{
        id: string;
        display_name: string;
        role_key: string;
        status: string;
        stamps: number;
        reversed: number;
        customers: number;
        redemptions: number;
      }>
    >`
      SELECT * FROM (
        SELECT sm.id, u.display_name, r.key AS role_key, sm.status::text AS status,
               coalesce(st.stamps, 0)::int AS stamps,
               coalesce(st.reversed, 0)::int AS reversed,
               coalesce(st.customers, 0)::int AS customers,
               coalesce(rd.redemptions, 0)::int AS redemptions
        FROM staff_memberships sm
        JOIN platform_users u ON u.id = sm.user_id
        JOIN roles r ON r.id = sm.role_id
        LEFT JOIN (
          SELECT s.staff_membership_id,
                 count(*) FILTER (WHERE rv.id IS NULL) AS stamps,
                 count(*) FILTER (WHERE rv.id IS NOT NULL) AS reversed,
                 count(DISTINCT m.customer_id) FILTER (WHERE rv.id IS NULL) AS customers
          FROM stamp_events s
          JOIN customer_memberships m ON m.id = s.membership_id AND m.merchant_id = s.merchant_id
          LEFT JOIN reversal_events rv ON rv.stamp_event_id = s.id
          WHERE s.merchant_id = ${s.merchantId}::uuid
            AND s.occurred_at >= ${s.from} AND s.occurred_at < ${s.to}
            ${this.program('s', s.programId)}
          GROUP BY s.staff_membership_id) st ON st.staff_membership_id = sm.id
        LEFT JOIN (
          SELECT re.staff_membership_id, count(*) AS redemptions
          FROM redemption_events re
          JOIN reward_unlocks ru ON ru.id = re.reward_unlock_id AND ru.merchant_id = re.merchant_id
          LEFT JOIN reversal_events rv ON rv.redemption_event_id = re.id
          WHERE re.merchant_id = ${s.merchantId}::uuid
            AND re.occurred_at >= ${s.from} AND re.occurred_at < ${s.to}
            AND rv.id IS NULL ${this.program('ru', s.programId)}
          GROUP BY re.staff_membership_id) rd ON rd.staff_membership_id = sm.id
        WHERE sm.merchant_id = ${s.merchantId}::uuid
      ) x
      ${cursor}
      ORDER BY x.stamps DESC, x.id DESC
      LIMIT ${limit}`;
  }

  /** The customers behind "returning": who they are (first name only), how often they came and when last. */
  async returningCustomerRows(s: Scope, limit: number, after: TimeAfter | null) {
    const cursor = after
      ? Prisma.sql`AND (x.last_visit_at < ${after.at} OR (x.last_visit_at = ${after.at} AND x.id < ${after.id}::uuid))`
      : Prisma.empty;
    return this.prisma.$queryRaw<
      Array<{
        id: string;
        first_name: string | null;
        visits: number;
        last_visit_at: Date;
        previous_visit_at: Date;
      }>
    >`
      SELECT * FROM (
        SELECT c.id, c.first_name, count(*)::int AS visits, max(s.occurred_at) AS last_visit_at,
               (SELECT max(s2.occurred_at)
                  FROM customer_memberships m2
                  JOIN stamp_events s2 ON s2.membership_id = m2.id AND s2.merchant_id = m2.merchant_id
                 WHERE m2.merchant_id = ${s.merchantId}::uuid AND m2.customer_id = c.id
                   AND s2.occurred_at < ${s.from}
                   AND NOT EXISTS (SELECT 1 FROM reversal_events r2 WHERE r2.stamp_event_id = s2.id)
                   ${this.program('s2', s.programId)}) AS previous_visit_at
        FROM stamp_events s
        JOIN customer_memberships m ON m.id = s.membership_id AND m.merchant_id = s.merchant_id
        JOIN customers c ON c.id = m.customer_id AND c.merchant_id = m.merchant_id
        LEFT JOIN reversal_events rv ON rv.stamp_event_id = s.id
        WHERE s.merchant_id = ${s.merchantId}::uuid
          AND s.occurred_at >= ${s.from} AND s.occurred_at < ${s.to}
          AND rv.id IS NULL
          ${this.program('s', s.programId)}
        GROUP BY c.id, c.first_name
      ) x
      WHERE x.previous_visit_at IS NOT NULL
      ${cursor}
      ORDER BY x.last_visit_at DESC, x.id DESC
      LIMIT ${limit}`;
  }

  /** Members per join month and how many of them visited in each later month. */
  async cohorts(input: {
    merchantId: string;
    timeZone: string;
    firstCohortStart: Date;
    programId?: string;
  }) {
    const { merchantId, timeZone, firstCohortStart } = input;
    const sizes = await this.prisma.$queryRaw<Array<{ cohort: string; size: number }>>`
      SELECT to_char(date_trunc('month', m.joined_at AT TIME ZONE ${timeZone}), 'YYYY-MM') AS cohort,
             count(*)::int AS size
      FROM customer_memberships m
      WHERE m.merchant_id = ${merchantId}::uuid AND m.joined_at >= ${firstCohortStart}
        ${this.program('m', input.programId)}
      GROUP BY 1`;
    const retained = await this.prisma.$queryRaw<
      Array<{ cohort: string; k: number; retained: number }>
    >`
      WITH cohort AS (
        SELECT m.id AS membership_id,
               date_trunc('month', m.joined_at AT TIME ZONE ${timeZone}) AS cohort_month
        FROM customer_memberships m
        WHERE m.merchant_id = ${merchantId}::uuid AND m.joined_at >= ${firstCohortStart}
          ${this.program('m', input.programId)}
      ), activity AS (
        SELECT DISTINCT s.membership_id,
               date_trunc('month', s.occurred_at AT TIME ZONE ${timeZone}) AS active_month
        FROM stamp_events s
        LEFT JOIN reversal_events rv ON rv.stamp_event_id = s.id
        WHERE s.merchant_id = ${merchantId}::uuid AND s.occurred_at >= ${firstCohortStart}
          AND rv.id IS NULL
          AND s.membership_id IN (SELECT membership_id FROM cohort)
      )
      SELECT to_char(c.cohort_month, 'YYYY-MM') AS cohort,
             ((date_part('year', a.active_month) * 12 + date_part('month', a.active_month))
              - (date_part('year', c.cohort_month) * 12 + date_part('month', c.cohort_month)))::int AS k,
             count(DISTINCT c.membership_id)::int AS retained
      FROM cohort c
      JOIN activity a ON a.membership_id = c.membership_id AND a.active_month >= c.cohort_month
      GROUP BY 1, 2`;
    return { sizes, retained };
  }

  async walletAdoption(merchantId: string, programId?: string) {
    const total = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM customer_memberships m
      WHERE m.merchant_id = ${merchantId}::uuid AND m.status = 'ACTIVE' ${this.program('m', programId)}`;
    const byProvider = await this.prisma.$queryRaw<
      Array<{ provider: string; memberships: bigint }>
    >`
      SELECT p.provider::text AS provider, count(DISTINCT p.membership_id) AS memberships
      FROM wallet_passes p
      JOIN customer_memberships m ON m.id = p.membership_id AND m.merchant_id = p.merchant_id
      WHERE p.merchant_id = ${merchantId}::uuid AND m.status = 'ACTIVE' AND p.status = 'ACTIVE'
        ${this.program('m', programId)}
      GROUP BY p.provider`;
    const sync = await this.prisma.$queryRaw<Array<{ sync_status: string; passes: bigint }>>`
      SELECT p.sync_status::text AS sync_status, count(*) AS passes
      FROM wallet_passes p
      JOIN customer_memberships m ON m.id = p.membership_id AND m.merchant_id = p.merchant_id
      WHERE p.merchant_id = ${merchantId}::uuid AND p.status <> 'INVALIDATED' AND p.provider <> 'WEB'
        ${this.program('m', programId)}
      GROUP BY p.sync_status`;
    return {
      activeMemberships: n(total[0]?.n),
      byProvider: byProvider.map((r) => ({ provider: r.provider, memberships: n(r.memberships) })),
      sync: sync.map((r) => ({ status: r.sync_status, passes: n(r.passes) })),
    };
  }

  async walletUpdateJobs(s: Pick<Scope, 'merchantId' | 'from' | 'to'>) {
    const rows = await this.prisma.$queryRaw<
      Array<{ status: string; jobs: bigint; retried: bigint }>
    >`
      SELECT status::text AS status, count(*) AS jobs,
             count(*) FILTER (WHERE attempts > 1) AS retried
      FROM outbox_jobs
      WHERE merchant_id = ${s.merchantId}::uuid AND type = 'wallet.pass_update'
        AND created_at >= ${s.from} AND created_at < ${s.to}
      GROUP BY status`;
    return rows.map((r) => ({ status: r.status, jobs: n(r.jobs), retried: n(r.retried) }));
  }
}

import { Injectable } from '@nestjs/common';
import { MerchantDirectory } from '../../merchants';
import { FraudThresholds, mergeThresholds } from '../domain/fraud-thresholds';
import {
  Bucket,
  branchSpike,
  dayWindow,
  exceedsReversalRate,
  recentBuckets,
  reversalRate,
} from '../domain/fraud-rules';
import { FraudRepository, NewFlag } from '../infrastructure/fraud.repository';

export interface EvaluationSummary {
  evaluatedAt: Date;
  created: number;
  updated: number;
  byIndicator: Record<string, number>;
}

const DAY = 86_400_000;

/**
 * Looks for the six fraud indicators in a merchant's ledgers and records a flag for each hit. This is the
 * ONLY thing it does: it never blocks a scan, suspends a customer, reverses anything or contacts anyone.
 * A person decides what a flag means (see FraudFlagsService.review).
 */
@Injectable()
export class FraudEvaluationService {
  constructor(
    private readonly repository: FraudRepository,
    private readonly merchants: MerchantDirectory,
  ) {}

  async thresholdsFor(merchantId: string): Promise<FraudThresholds> {
    return mergeThresholds(await this.merchants.fraudThresholds(merchantId));
  }

  async evaluate(merchantId: string, now: Date = new Date()): Promise<EvaluationSummary> {
    const t = await this.thresholdsFor(merchantId);
    const flags: NewFlag[] = [];
    const add = (f: Omit<NewFlag, 'merchantId'>) => flags.push({ merchantId, ...f });

    // 1. Excessive stamps by one staff member
    if (t.excessiveStampsPerStaff.enabled) {
      const { windowMinutes, maxStamps } = t.excessiveStampsPerStaff;
      for (const b of recentBuckets(now, windowMinutes)) {
        for (const r of await this.repository.stampsByStaff(
          merchantId,
          b.start,
          b.end,
          maxStamps,
        )) {
          add({
            indicator: 'EXCESSIVE_STAMPS_BY_STAFF',
            subjectType: 'STAFF',
            subjectId: r.id,
            ...span(b),
            observed: r.count,
            threshold: maxStamps,
            details: { stamps: r.count, windowMinutes },
          });
        }
      }
    }

    // 2. Repeated scans of one card
    if (t.repeatedScansPerMembership.enabled) {
      const { windowMinutes, maxAttempts } = t.repeatedScansPerMembership;
      for (const b of recentBuckets(now, windowMinutes)) {
        for (const r of await this.repository.scanAttemptsByMembership(
          merchantId,
          b.start,
          b.end,
          maxAttempts,
        )) {
          add({
            indicator: 'REPEATED_SCANS_FOR_MEMBERSHIP',
            subjectType: 'MEMBERSHIP',
            subjectId: r.id,
            ...span(b),
            observed: r.count,
            threshold: maxAttempts,
            details: { attempts: r.count, stamps: r.stamps, rejected: r.rejected, windowMinutes },
          });
        }
      }
    }

    // 3. Unusual branch activity (against the branch's own recent normal)
    if (t.unusualBranchActivity.enabled) {
      const { windowMinutes, baselineDays, multiplier, minStamps } = t.unusualBranchActivity;
      for (const b of recentBuckets(now, windowMinutes)) {
        const current = await this.repository.stampsByBranch(merchantId, b.start, b.end, minStamps);
        if (current.length === 0) continue;
        const baselineStart = new Date(b.start.getTime() - baselineDays * DAY);
        const baseline = new Map(
          (await this.repository.stampsByBranch(merchantId, baselineStart, b.start, 1)).map((r) => [
            r.id,
            r.count,
          ]),
        );
        for (const r of current) {
          const verdict = branchSpike({
            count: r.count,
            baselineTotal: baseline.get(r.id) ?? 0,
            baselineDays,
            windowMinutes,
            multiplier,
            minStamps,
          });
          if (verdict.flagged) {
            add({
              indicator: 'UNUSUAL_BRANCH_ACTIVITY',
              subjectType: 'BRANCH',
              subjectId: r.id,
              ...span(b),
              observed: r.count,
              threshold: Math.max(minStamps, Math.ceil(multiplier * verdict.baselineAverage)),
              details: {
                stamps: r.count,
                baselineAveragePerWindow: verdict.baselineAverage,
                multiplier,
                windowMinutes,
                baselineDays,
              },
            });
          }
        }
      }
    }

    // 4. High reversal rate (share of a staff member's stamps that were reversed)
    if (t.highReversalRate.enabled) {
      const { windowDays, minStamps, maxRatio } = t.highReversalRate;
      const w = dayWindow(now, windowDays);
      for (const r of await this.repository.reversalsByStaff(
        merchantId,
        w.start,
        w.end,
        minStamps,
      )) {
        if (exceedsReversalRate(r.total, r.reversed, minStamps, maxRatio)) {
          const rate = Math.round(reversalRate(r.total, r.reversed) * 1000) / 1000;
          add({
            indicator: 'HIGH_REVERSAL_RATE',
            subjectType: 'STAFF',
            subjectId: r.id,
            ...span(w),
            observed: rate,
            threshold: maxRatio,
            details: { stamps: r.total, reversed: r.reversed, windowDays },
          });
        }
      }
    }

    // 5. Repeated cooldown rejections
    if (t.repeatedCooldownRejections.enabled) {
      const { windowMinutes, maxRejections } = t.repeatedCooldownRejections;
      for (const b of recentBuckets(now, windowMinutes)) {
        for (const r of await this.repository.cooldownRejectionsByMembership(
          merchantId,
          b.start,
          b.end,
          maxRejections,
        )) {
          add({
            indicator: 'REPEATED_COOLDOWN_REJECTIONS',
            subjectType: 'MEMBERSHIP',
            subjectId: r.id,
            ...span(b),
            observed: r.count,
            threshold: maxRejections,
            details: { rejections: r.count, windowMinutes },
          });
        }
      }
    }

    // 6. Excessive reward redemptions by one staff member
    if (t.excessiveRedemptions.enabled) {
      const { windowMinutes, maxRedemptions } = t.excessiveRedemptions;
      for (const b of recentBuckets(now, windowMinutes)) {
        for (const r of await this.repository.redemptionsByStaff(
          merchantId,
          b.start,
          b.end,
          maxRedemptions,
        )) {
          add({
            indicator: 'EXCESSIVE_REDEMPTIONS',
            subjectType: 'STAFF',
            subjectId: r.id,
            ...span(b),
            observed: r.count,
            threshold: maxRedemptions,
            details: { redemptions: r.count, windowMinutes },
          });
        }
      }
    }

    const summary: EvaluationSummary = {
      evaluatedAt: now,
      created: 0,
      updated: 0,
      byIndicator: {},
    };
    for (const flag of flags) {
      const isNew = await this.repository.upsertFlag(flag);
      if (isNew) summary.created++;
      else summary.updated++;
      summary.byIndicator[flag.indicator] = (summary.byIndicator[flag.indicator] ?? 0) + 1;
    }
    return summary;
  }
}

const span = (b: Bucket) => ({ windowStart: b.start, windowEnd: b.end });

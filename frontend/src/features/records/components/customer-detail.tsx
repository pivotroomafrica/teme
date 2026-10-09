"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Badge,
  Button,
  Drawer,
  EmptyState,
  ErrorState,
  ProgressBar,
  Skeleton,
  SkeletonGroup,
  useToast,
} from "@/components/ui";
import type { Tone } from "@/components/ui";
import { pickLocalized } from "@/features/enrollment/localized";
import { getBrowserApi } from "@/lib/api/browser";
import type { Customer, LedgerEntry, MembershipSummary, WalletPass } from "@/lib/api/contract";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translator";
import { CustomerTools } from "@/features/privacy/components/customer-tools";
import { displayPhone } from "../records-rules";
import { ReverseDialog } from "./reverse-dialog";

const REWARD_LABEL: Record<MembershipSummary["rewards"][number]["state"], MessageKey> = {
  AVAILABLE: "records.rewardAvailable",
  REDEEMED: "records.rewardRedeemed",
  EXPIRED: "records.rewardExpired",
  REVERSED: "records.rewardReversed",
};
const REWARD_TONE: Record<MembershipSummary["rewards"][number]["state"], Tone> = {
  AVAILABLE: "warning",
  REDEEMED: "success",
  EXPIRED: "neutral",
  REVERSED: "neutral",
};
const PROVIDER_LABEL: Record<WalletPass["provider"], MessageKey> = {
  APPLE: "records.providerApple",
  GOOGLE: "records.providerGoogle",
  WEB: "records.providerWeb",
};
const PASS_LABEL: Record<WalletPass["status"], MessageKey> = {
  ACTIVE: "records.passActive",
  PENDING: "records.passPending",
  SUSPENDED: "records.passSuspended",
  INVALIDATED: "records.passInvalidated",
};
const SYNC_LABEL: Record<WalletPass["syncStatus"], MessageKey> = {
  SYNCED: "records.syncSynced",
  PENDING: "records.syncPending",
  FAILED: "records.syncFailed",
};

/**
 * One customer: progress, rewards, wallet cards, consent and (for people who may reverse entries) the visit history
 * with the reversal controls. The visit history is a separate request that only owners and managers are allowed to
 * make, so it is only asked for when the person can reverse entries; otherwise a note says why it is missing.
 */
export function CustomerDetail({
  customer,
  canManage,
  canReverse,
  canPrivacy = false,
  onCustomerChanged,
  onClose,
}: {
  customer: Customer;
  canManage: boolean;
  canReverse: boolean;
  canPrivacy?: boolean;
  /** The customer as the backend now has it, after an action that changed it. */
  onCustomerChanged?: (customer: Customer) => void;
  onClose: () => void;
}) {
  const { t, locale, format } = useI18n();
  const client = useQueryClient();
  const membership = customer.memberships[0] ?? null;
  const membershipId = membership?.id ?? null;
  const [reversing, setReversing] = useState<LedgerEntry | null>(null);
  const [newCorrection, setNewCorrection] = useState<string | null>(null);

  const summary = useQuery({
    queryKey: ["membership", membershipId, "summary"],
    queryFn: ({ signal }) => getBrowserApi().memberships.summary(membershipId!, signal),
    enabled: membershipId !== null,
  });
  const passes = useQuery({
    queryKey: ["membership", membershipId, "passes"],
    queryFn: ({ signal }) => getBrowserApi().memberships.walletPasses(membershipId!, signal),
    enabled: membershipId !== null,
  });
  const ledger = useQuery({
    queryKey: ["membership", membershipId, "ledger"],
    queryFn: ({ signal }) => getBrowserApi().memberships.ledger(membershipId!, signal),
    enabled: membershipId !== null && canReverse,
  });
  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: ({ signal }) => getBrowserApi().branches.list(signal),
    retry: false,
  });
  const branchName = (id: string | null | undefined) => {
    if (!id) return null;
    const b = branches.data?.find((x) => x.id === id);
    return b ? pickLocalized(locale, b.nameEn, b.nameAm).text : null;
  };

  const toast = useToast();
  async function resync(passId: string) {
    try {
      await getBrowserApi().memberships.resyncPass(passId);
      toast.show({ tone: "success", title: t("privacy.resynced") });
      void client.invalidateQueries({ queryKey: ["membership", membershipId, "passes"] });
    } catch (failure) {
      toast.show({ tone: "danger", title: describeApiError(toApiError(failure), t).description });
    }
  }

  const name = customer.firstName ?? t("records.noName");
  const phone = displayPhone(customer, canManage);

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={name}
        description={t("records.detailTitle")}
        footer={
          <Button variant="secondary" onClick={onClose}>
            {t("ui.close")}
          </Button>
        }
      >
        <div className="flex flex-col gap-6" data-testid="customer-detail">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">{t("records.colPhone")}</dt>
            <dd dir="ltr" className="text-start">
              {phone ?? "—"}
            </dd>
            <dt className="text-muted">{t("records.colJoined")}</dt>
            <dd>{format.date(customer.joinedAt)}</dd>
            <dt className="text-muted">{t("records.consentTitle")}</dt>
            <dd>
              {t("records.consentLine", {
                value: customer.marketingConsent
                  ? t("records.consentValueYes")
                  : t("records.consentValueNo"),
              })}
            </dd>
          </dl>

          {membershipId === null ? (
            <EmptyState title={t("records.noMembership")} headingLevel="h3" />
          ) : summary.isPending ? (
            <SkeletonGroup className="flex flex-col gap-3">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-20 w-full" />
            </SkeletonGroup>
          ) : summary.isError ? (
            <ErrorState
              title={t("records.detailLoadError")}
              description={describeApiError(toApiError(summary.error), t).description}
              requestId={toApiError(summary.error).requestId}
              onRetry={() => void summary.refetch()}
              retrying={summary.isFetching}
            />
          ) : (
            <>
              <section aria-labelledby="progress-h" className="flex flex-col gap-2">
                <h3 id="progress-h" className="font-semibold text-green-900">
                  {t("records.progressTitle")}
                </h3>
                <ProgressBar
                  value={summary.data.progress.current}
                  max={summary.data.progress.required}
                  label={t("records.progressOf", {
                    current: summary.data.progress.current,
                    required: summary.data.progress.required,
                  })}
                />
                <p className="text-sm text-muted">
                  {t("records.cardsCompleted", { count: summary.data.progress.completedCards })}
                </p>
                {summary.data.status === "INACTIVE" ? (
                  <Badge tone="warning">{t("records.membershipInactive")}</Badge>
                ) : null}
              </section>

              <section aria-labelledby="rewards-h" className="flex flex-col gap-2">
                <h3 id="rewards-h" className="font-semibold text-green-900">
                  {t("records.rewardsTitle")}
                </h3>
                {summary.data.rewards.length === 0 ? (
                  <p className="text-sm text-muted">{t("records.noRewards")}</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {summary.data.rewards.map((reward) => {
                      const label = pickLocalized(locale, reward.nameEn, reward.nameAm);
                      return (
                        <li
                          key={reward.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-border p-3"
                        >
                          <span>
                            <span lang={label.lang} className="font-medium">
                              {label.text}
                            </span>
                            <span className="block text-sm text-muted">
                              {reward.redemption
                                ? t("records.rewardGivenOn", {
                                    date: format.date(reward.redemption.occurredAt),
                                  })
                                : t("records.rewardUnlockedOn", {
                                    date: format.date(reward.unlockedAt),
                                  })}
                            </span>
                          </span>
                          <Badge tone={REWARD_TONE[reward.state]}>
                            {t(REWARD_LABEL[reward.state])}
                          </Badge>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          )}

          {membershipId !== null ? (
            <section aria-labelledby="wallet-h" className="flex flex-col gap-2">
              <h3 id="wallet-h" className="font-semibold text-green-900">
                {t("records.walletTitle")}
              </h3>
              {passes.isPending ? (
                <Skeleton className="h-10 w-full" />
              ) : passes.isError ? (
                <p className="text-sm text-muted">
                  {describeApiError(toApiError(passes.error), t).description}
                </p>
              ) : passes.data.length === 0 ? (
                <p className="text-sm text-muted">{t("records.walletNone")}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {passes.data.map((pass) => (
                    <li
                      key={pass.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-border p-3 text-sm"
                    >
                      <span className="font-medium">{t(PROVIDER_LABEL[pass.provider])}</span>
                      <span className="flex flex-wrap gap-2">
                        <Badge tone={pass.status === "ACTIVE" ? "success" : "neutral"}>
                          {t(PASS_LABEL[pass.status])}
                        </Badge>
                        <Badge
                          tone={
                            pass.syncStatus === "FAILED"
                              ? "danger"
                              : pass.syncStatus === "PENDING"
                                ? "warning"
                                : "success"
                          }
                        >
                          {t(SYNC_LABEL[pass.syncStatus])}
                        </Badge>
                        {canManage && pass.provider !== "WEB" && pass.status !== "INVALIDATED" ? (
                          <Button variant="secondary" onClick={() => void resync(pass.id)}>
                            {t("privacy.resyncPass")}
                            <span className="sr-only"> — {t(PROVIDER_LABEL[pass.provider])}</span>
                          </Button>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {membershipId !== null ? (
            <section aria-labelledby="visits-h" className="flex flex-col gap-2">
              <h3 id="visits-h" className="font-semibold text-green-900">
                {t("records.visitsTitle")}
              </h3>
              {!canReverse ? (
                <p className="text-sm text-muted">{t("records.visitsRestricted")}</p>
              ) : ledger.isPending ? (
                <Skeleton className="h-24 w-full" />
              ) : ledger.isError ? (
                <ErrorState
                  title={t("records.detailLoadError")}
                  description={describeApiError(toApiError(ledger.error), t).description}
                  requestId={toApiError(ledger.error).requestId}
                  onRetry={() => void ledger.refetch()}
                  retrying={ledger.isFetching}
                />
              ) : ledger.data.entries.length === 0 ? (
                <p className="text-sm text-muted">{t("records.visitsEmpty")}</p>
              ) : (
                <>
                  <p className="text-sm text-muted">{t("records.historyKept")}</p>
                  <ol aria-label={t("records.visitsTitle")} className="flex flex-col gap-2">
                    {ledger.data.entries.map((entry) => (
                      <LedgerRow
                        key={entry.id}
                        entry={entry}
                        highlighted={entry.id === newCorrection}
                        branch={branchName(entry.branchId)}
                        onReverse={() => setReversing(entry)}
                      />
                    ))}
                  </ol>
                </>
              )}
            </section>
          ) : null}

          {canManage || canPrivacy ? (
            <CustomerTools
              customer={customer}
              membershipId={membershipId}
              membershipActive={summary.data?.status !== "INACTIVE"}
              canManage={canManage}
              canPrivacy={canPrivacy}
              onCustomerChanged={(next) => onCustomerChanged?.(next)}
              onClosed={onClose}
            />
          ) : null}
        </div>
      </Drawer>

      {reversing ? (
        <ReverseDialog
          key={reversing.id}
          entry={reversing}
          branchName={branchName(reversing.branchId)}
          onClose={() => setReversing(null)}
          onDone={(result) => {
            setNewCorrection(result.reversalId);
            void client.invalidateQueries({ queryKey: ["membership", membershipId] });
            void client.invalidateQueries({ queryKey: ["audit"] });
            void client.invalidateQueries({ queryKey: ["reward-feed"] });
          }}
        />
      ) : null}
    </>
  );
}

function LedgerRow({
  entry,
  branch,
  highlighted,
  onReverse,
}: {
  entry: LedgerEntry;
  branch: string | null;
  highlighted: boolean;
  onReverse: () => void;
}) {
  const { t, format } = useI18n();
  const label =
    entry.type === "STAMP"
      ? t("records.entryStamp")
      : entry.type === "REDEMPTION"
        ? t("records.entryRedemption")
        : t("records.entryReversal");
  return (
    <li
      data-entry-type={entry.type}
      data-reversed={entry.reversed ? "true" : undefined}
      data-new={highlighted ? "true" : undefined}
      className={`flex flex-wrap items-start justify-between gap-2 rounded-control border p-3 ${
        highlighted ? "border-green-700 bg-green-50" : "border-border"
      }`}
    >
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{label}</span>
          {entry.reversed ? <Badge tone="neutral">{t("records.reversedBadge")}</Badge> : null}
          {highlighted ? <Badge tone="info">{t("records.correctionEvent")}</Badge> : null}
        </span>
        <span className="block text-sm text-muted">
          {format.dateTime(entry.occurredAt)}
          {branch ? ` · ${t("records.atBranch", { branch })}` : null}
        </span>
        {entry.reversal ? (
          <span className="mt-1 block text-sm">
            {entry.reversal.targetType === "STAMP"
              ? t("records.reversalOfStamp")
              : t("records.reversalOfRedemption")}
            {" · "}
            {t("records.reasonLine", { reason: entry.reversal.reason })}
          </span>
        ) : null}
      </span>
      {entry.type !== "REVERSAL" && !entry.reversed ? (
        <Button variant="secondary" onClick={onReverse}>
          {t("records.reverse")}
          <span className="sr-only">
            {" "}
            — {label}, {format.dateTime(entry.occurredAt)}
          </span>
        </Button>
      ) : null}
    </li>
  );
}

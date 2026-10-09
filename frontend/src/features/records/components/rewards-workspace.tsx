"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  EmptyState,
  ErrorState,
  FormField,
  Pagination,
  Select,
  Skeleton,
  SkeletonGroup,
  Tabs,
} from "@/components/ui";
import { pickLocalized } from "@/features/enrollment/localized";
import { getBrowserApi } from "@/lib/api/browser";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";
import { useCursorPages } from "../use-cursor-pages";
import { AuditTable } from "./audit-table";
import { CustomersWorkspace } from "./customers-workspace";

const PAGE_SIZE = 10;

/**
 * Rewards and redemptions. The backend has no merchant-wide list of redemptions, so recent rewards given and
 * reversed events come from the audit history (read-only, no money values anywhere), and what a particular
 * customer can claim comes from the customer lookup. Branch and team-member filters narrow the activity.
 */
export function RewardsWorkspace({
  canManage,
  canReverse,
  canPrivacy = false,
  canSeeAudit,
}: {
  canManage: boolean;
  canReverse: boolean;
  canPrivacy?: boolean;
  /** The activity comes from the audit history, which needs `audit:read`. */
  canSeeAudit: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="lookup-h" className="flex flex-col gap-3">
        <div>
          <h2 id="lookup-h" className="text-xl font-bold text-green-900">
            {t("records.lookupTitle")}
          </h2>
          <p className="text-muted">{t("records.lookupHint")}</p>
        </div>
        <CustomersWorkspace
          canManage={canManage}
          canReverse={canReverse}
          canPrivacy={canPrivacy}
          intro={t("records.lookupHint")}
        />
      </section>

      {canSeeAudit ? (
        <Tabs
          label={t("records.tabsLabel")}
          tabs={[
            {
              id: "given",
              label: t("records.tabRedemptions"),
              content: <Feed kind="given" />,
            },
            {
              id: "reversed",
              label: t("records.tabReversed"),
              content: <Feed kind="reversed" />,
            },
          ]}
        />
      ) : null}
    </div>
  );
}

type FeedKind = "given" | "reversed";

function Feed({ kind }: { kind: FeedKind }) {
  const { t, locale } = useI18n();
  const paging = useCursorPages(PAGE_SIZE);
  const [branchId, setBranchId] = useState("");
  const [actorUserId, setActorUserId] = useState("");
  const [reversedKind, setReversedKind] = useState<"stamp.reversed" | "redemption.reversed">(
    "redemption.reversed",
  );
  const action = kind === "given" ? "reward.redeemed" : reversedKind;

  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: ({ signal }) => getBrowserApi().branches.list(signal),
    retry: false,
  });
  const actors = useQuery({
    queryKey: ["audit", "actors"],
    queryFn: ({ signal }) => getBrowserApi().audit.list({ limit: 100 }, signal),
    staleTime: 5 * 60_000,
  });
  const people = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of actors.data?.items ?? []) {
      if (item.actor.type === "USER" && item.actor.userId && item.actor.displayName) {
        seen.set(item.actor.userId, item.actor.displayName);
      }
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [actors.data]);

  const query = {
    limit: PAGE_SIZE,
    cursor: paging.cursor,
    action,
    branchId: branchId || undefined,
    actorUserId: actorUserId || undefined,
  };
  const list = useQuery({
    queryKey: ["reward-feed", query],
    queryFn: ({ signal }) => getBrowserApi().audit.list(query, signal),
    placeholderData: keepPreviousData,
  });
  const items = list.data?.items ?? [];
  const filtering = Boolean(branchId || actorUserId);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {kind === "reversed" ? (
          <FormField label={t("records.colWhat")}>
            <Select
              value={reversedKind}
              onChange={(e) => {
                paging.reset();
                setReversedKind(e.target.value as typeof reversedKind);
              }}
            >
              <option value="redemption.reversed">{t("records.actionRedemptionReversed")}</option>
              <option value="stamp.reversed">{t("records.actionStampReversed")}</option>
            </Select>
          </FormField>
        ) : null}
        {branches.data ? (
          <FormField label={t("records.filterBranch")}>
            <Select
              value={branchId}
              onChange={(e) => {
                paging.reset();
                setBranchId(e.target.value);
              }}
            >
              <option value="">{t("records.filterAnyBranch")}</option>
              {branches.data.map((b) => (
                <option key={b.id} value={b.id}>
                  {pickLocalized(locale, b.nameEn, b.nameAm).text}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}
        <FormField label={t("records.filterStaff")}>
          <Select
            value={actorUserId}
            onChange={(e) => {
              paging.reset();
              setActorUserId(e.target.value);
            }}
          >
            <option value="">{t("records.filterAnyStaff")}</option>
            {people.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <p className="text-sm text-muted">{t("records.feedNote")}</p>

      {list.isPending ? (
        <SkeletonGroup className="flex flex-col gap-3">
          <Skeleton className="h-40 w-full" />
        </SkeletonGroup>
      ) : list.isError ? (
        <ErrorState
          title={t("records.feedLoadError")}
          description={describeApiError(toApiError(list.error), t).description}
          requestId={toApiError(list.error).requestId}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : items.length === 0 ? (
        filtering ? (
          <EmptyState title={t("records.rewardsNoMatch")} />
        ) : kind === "given" ? (
          <EmptyState
            title={t("records.redemptionsEmpty")}
            description={t("records.redemptionsEmptyHint")}
          />
        ) : (
          <EmptyState
            title={t("records.reversedEmpty")}
            description={t("records.reversedEmptyHint")}
          />
        )
      ) : (
        <>
          <AuditTable
            label={t("records.feedTableLabel")}
            items={items}
            branches={branches.data ?? []}
          />
          <Pagination
            hasPrevious={paging.hasPrevious}
            hasNext={Boolean(list.data?.nextCursor)}
            onPrevious={paging.previous}
            onNext={() => list.data?.nextCursor && paging.next(list.data.nextCursor)}
            from={paging.from}
            to={paging.from + items.length - 1}
            loading={list.isFetching}
          />
        </>
      )}
    </div>
  );
}

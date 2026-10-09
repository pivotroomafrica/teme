"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Pagination,
  SearchField,
  Skeleton,
  SkeletonGroup,
} from "@/components/ui";
import { ResponsiveTable } from "@/features/org/responsive-table";
import { getBrowserApi } from "@/lib/api/browser";
import type { Customer } from "@/lib/api/contract";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";
import { displayPhone } from "../records-rules";
import { useCursorPages } from "../use-cursor-pages";
import { CustomerDetail } from "./customer-detail";

const PAGE_SIZE = 10;

/**
 * Customers: search by first name or phone number, 10 per page, with a detail panel for each person.
 *
 * What the screen offers follows the person's permissions (`customer:manage` sees whole numbers and may search by
 * name or part of a number; everyone else sees masked numbers and must give a complete number; only people who can
 * reverse entries are offered the visit history). That is a convenience: the backend decides what is returned and
 * allowed, and phone numbers are masked again here if one ever arrives unmasked for someone who may not see it.
 */
export function CustomersWorkspace({
  canManage,
  canReverse,
  canPrivacy = false,
  intro,
}: {
  canManage: boolean;
  canReverse: boolean;
  canPrivacy?: boolean;
  /** Replaces the default hint (used when the workspace is embedded as a rewards lookup). */
  intro?: string;
}) {
  const { t, format } = useI18n();
  const paging = useCursorPages(PAGE_SIZE);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Customer | null>(null);

  const list = useQuery({
    queryKey: ["customers", query, paging.cursor ?? null],
    queryFn: ({ signal }) =>
      getBrowserApi().customers.list(
        { q: query || undefined, limit: PAGE_SIZE, cursor: paging.cursor },
        signal,
      ),
    placeholderData: keepPreviousData,
  });

  const items = list.data?.items ?? [];
  const phoneOf = (c: Customer) => displayPhone(c, canManage);
  const nameOf = (c: Customer) => c.firstName ?? t("records.noName");
  const membershipLabel = (c: Customer) => {
    const m = c.memberships[0];
    if (!m) return <Badge tone="neutral">{t("records.noMembership")}</Badge>;
    return m.status === "ACTIVE" ? (
      <Badge tone="success">{t("records.membershipActive")}</Badge>
    ) : (
      <Badge tone="neutral">{t("records.membershipInactive")}</Badge>
    );
  };
  const consentLabel = (c: Customer) =>
    c.marketingConsent ? t("records.consentYes") : t("records.consentNo");
  const viewButton = (c: Customer) => (
    <Button variant="secondary" onClick={() => setSelected(c)}>
      {t("records.view")}
      <span className="sr-only"> — {nameOf(c)}</span>
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <SearchField
          label={t("records.searchLabel")}
          placeholder={t("records.searchPlaceholder")}
          onSearch={(value) => {
            paging.reset();
            setQuery(value);
          }}
        />
        <p className="text-sm text-muted">
          {intro ?? (canManage ? t("records.searchHintManager") : t("records.searchHintFull"))}
        </p>
      </div>

      {list.isPending ? (
        <SkeletonGroup className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-40 w-full" />
        </SkeletonGroup>
      ) : list.isError ? (
        <ErrorState
          title={t("records.customersLoadError")}
          description={describeApiError(toApiError(list.error), t).description}
          requestId={toApiError(list.error).requestId}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : items.length === 0 ? (
        query ? (
          <EmptyState title={t("records.customersNoMatch")} />
        ) : (
          <EmptyState
            title={t("records.customersEmpty")}
            description={t("records.customersEmptyHint")}
          />
        )
      ) : (
        <>
          {!canManage ? <Alert tone="info">{t("records.maskedNote")}</Alert> : null}
          <ResponsiveTable
            label={t("records.customersTableLabel")}
            items={items}
            rowKey={(c) => c.id}
            columns={[
              { id: "name", header: t("records.colName"), rowHeader: true, cell: nameOf },
              {
                id: "phone",
                header: t("records.colPhone"),
                cell: (c) => <span dir="ltr">{phoneOf(c) ?? "—"}</span>,
              },
              { id: "status", header: t("records.colStatus"), cell: membershipLabel },
              { id: "consent", header: t("records.colConsent"), cell: consentLabel },
              {
                id: "joined",
                header: t("records.colJoined"),
                cell: (c) => format.date(c.joinedAt),
              },
              { id: "actions", header: t("records.colActions"), cell: viewButton },
            ]}
            card={(c) => (
              <div className="flex flex-col gap-2">
                <p className="text-lg font-semibold text-green-900">{nameOf(c)}</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted">{t("records.colPhone")}</dt>
                  <dd dir="ltr" className="text-start">
                    {phoneOf(c) ?? "—"}
                  </dd>
                  <dt className="text-muted">{t("records.colStatus")}</dt>
                  <dd>{membershipLabel(c)}</dd>
                  <dt className="text-muted">{t("records.colConsent")}</dt>
                  <dd>{consentLabel(c)}</dd>
                  <dt className="text-muted">{t("records.colJoined")}</dt>
                  <dd>{format.date(c.joinedAt)}</dd>
                </dl>
                {viewButton(c)}
              </div>
            )}
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

      {selected ? (
        <CustomerDetail
          key={selected.id}
          customer={selected}
          canManage={canManage}
          canReverse={canReverse}
          canPrivacy={canPrivacy}
          onCustomerChanged={(next) => setSelected(next)}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

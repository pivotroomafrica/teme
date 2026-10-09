"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Badge,
  EmptyState,
  ErrorState,
  FormField,
  Pagination,
  SearchField,
  Select,
  Skeleton,
  SkeletonGroup,
} from "@/components/ui";
import { pickLocalized } from "@/features/enrollment/localized";
import { ResponsiveTable } from "@/features/org/responsive-table";
import { usePaged } from "@/features/org/use-paged";
import { getBrowserApi } from "@/lib/api/browser";
import type { PlatformMerchant } from "@/lib/api/contract";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";
import { MERCHANT_STATUS_LABEL, MERCHANT_STATUS_TONE, filterMerchants } from "../ops-rules";

/** The merchant list. The backend returns it whole (no paging), so it is searched, filtered and paged here. */
export function MerchantsWorkspace() {
  const { t, locale } = useI18n();
  const list = useQuery({
    queryKey: ["ops", "merchants"],
    queryFn: ({ signal }) => getBrowserApi().operations.merchants(signal),
  });
  const [filter, setFilter] = useState({ search: "", status: "" });
  const shown = useMemo(() => filterMerchants(list.data ?? [], filter), [list.data, filter]);
  const paged = usePaged(shown);

  if (list.isPending) {
    return (
      <SkeletonGroup className="flex flex-col gap-3">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-48 w-full" />
      </SkeletonGroup>
    );
  }
  if (list.isError) {
    const failure = toApiError(list.error);
    return (
      <ErrorState
        title={t("ops.merchantsLoadError")}
        description={describeApiError(failure, t).description}
        requestId={failure.requestId}
        onRetry={() => void list.refetch()}
        retrying={list.isFetching}
      />
    );
  }

  const nameOf = (m: PlatformMerchant) => pickLocalized(locale, m.nameEn, m.nameAm);
  const status = (m: PlatformMerchant) => (
    <Badge tone={MERCHANT_STATUS_TONE[m.status]}>{t(MERCHANT_STATUS_LABEL[m.status])}</Badge>
  );
  const open = (m: PlatformMerchant) => (
    <Link
      className="touch-target inline-flex items-center rounded-control border border-green-700 px-4 font-semibold text-green-800 hover:bg-green-50"
      href={`/${locale}/operations/merchants/${m.id}`}
    >
      {t("ops.view")}
      <span className="sr-only"> — {nameOf(m).text}</span>
    </Link>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_16rem]">
        <SearchField
          label={t("ops.searchLabel")}
          placeholder={t("ops.searchPlaceholder")}
          onSearch={(search) => {
            setFilter((f) => ({ ...f, search }));
            paged.reset();
          }}
        />
        <FormField label={t("ops.filterStatus")}>
          <Select
            value={filter.status}
            onChange={(event) => {
              setFilter((f) => ({ ...f, status: event.target.value }));
              paged.reset();
            }}
          >
            <option value="">{t("ops.anyStatus")}</option>
            <option value="ACTIVE">{t("ops.statusActive")}</option>
            <option value="SUSPENDED">{t("ops.statusSuspended")}</option>
            <option value="DEACTIVATED">{t("ops.statusDeactivated")}</option>
          </Select>
        </FormField>
      </div>

      {(list.data ?? []).length === 0 ? (
        <EmptyState title={t("ops.merchantsEmpty")} />
      ) : shown.length === 0 ? (
        <EmptyState title={t("ops.merchantsNoMatch")} />
      ) : (
        <>
          <ResponsiveTable
            label={t("ops.merchantsTableLabel")}
            items={paged.slice}
            rowKey={(m) => m.id}
            columns={[
              {
                id: "name",
                header: t("ops.colName"),
                rowHeader: true,
                cell: (m) => <span lang={nameOf(m).lang}>{nameOf(m).text}</span>,
              },
              { id: "slug", header: t("ops.colSlug"), cell: (m) => m.slug },
              { id: "status", header: t("ops.colStatus"), cell: status },
              { id: "actions", header: t("ops.colActions"), cell: open },
            ]}
            card={(m) => (
              <div className="flex flex-col gap-2">
                <p className="text-lg font-semibold text-green-900" lang={nameOf(m).lang}>
                  {nameOf(m).text}
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted">{t("ops.colSlug")}</dt>
                  <dd>{m.slug}</dd>
                  <dt className="text-muted">{t("ops.colStatus")}</dt>
                  <dd>{status(m)}</dd>
                </dl>
                {open(m)}
              </div>
            )}
          />
          <Pagination
            hasPrevious={paged.hasPrevious}
            hasNext={paged.hasNext}
            onPrevious={paged.previous}
            onNext={paged.next}
            from={paged.from}
            to={paged.to}
            total={paged.total}
          />
        </>
      )}
    </div>
  );
}

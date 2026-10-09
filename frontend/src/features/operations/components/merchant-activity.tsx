"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Alert,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Pagination,
  Skeleton,
  SkeletonGroup,
} from "@/components/ui";
import { AuditTable } from "@/features/records/components/audit-table";
import { useCursorPages } from "@/features/records/use-cursor-pages";
import { pickLocalized } from "@/features/enrollment/localized";
import { getBrowserApi } from "@/lib/api/browser";
import type { PlatformMerchant } from "@/lib/api/contract";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";
import type { PlatformAuditQuery } from "../api";

const PAGE_SIZE = 10;

/**
 * One merchant's recorded activity, read through the platform audit. The backend records every time a platform
 * administrator names a merchant (`audit.platform_accessed`, in that merchant's own history), so nothing is requested
 * until the person has confirmed that, and the request is made only after the confirmation.
 */
export function MerchantActivity({
  merchant,
  filters = {},
  emptyText,
  buttonLabel,
}: {
  merchant: PlatformMerchant;
  filters?: Omit<PlatformAuditQuery, "merchantId" | "limit" | "cursor">;
  emptyText: string;
  buttonLabel?: string;
}) {
  const { t, locale } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const paging = useCursorPages(PAGE_SIZE);
  const name = pickLocalized(locale, merchant.nameEn, merchant.nameAm).text;

  const query: PlatformAuditQuery = {
    ...filters,
    merchantId: merchant.id,
    limit: PAGE_SIZE,
    cursor: paging.cursor,
  };
  const list = useQuery({
    queryKey: ["ops", "audit", query],
    queryFn: ({ signal }) => getBrowserApi().operations.audit(query, signal),
    enabled: confirmed,
    placeholderData: keepPreviousData,
    // Every request is recorded in the merchant's history, so never repeat one on focus or reconnect.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  if (!confirmed) {
    return (
      <>
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          {buttonLabel ?? t("ops.detailActivityButton")}
        </Button>
        <ConfirmDialog
          open={confirming}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirmed(true);
            setConfirming(false);
          }}
          title={t("ops.detailConfirmTitle")}
          description={t("ops.detailConfirmBody")}
          confirmLabel={t("ops.detailConfirmAction")}
        />
      </>
    );
  }

  const items = list.data?.items ?? [];
  return (
    <div className="flex flex-col gap-3" data-testid="merchant-activity">
      <Alert tone="info">{t("ops.auditNamed", { name })}</Alert>
      {list.isPending ? (
        <SkeletonGroup>
          <Skeleton className="h-32 w-full" />
        </SkeletonGroup>
      ) : list.isError ? (
        <ErrorState
          title={t("records.auditLoadError")}
          description={describeApiError(toApiError(list.error), t).description}
          requestId={toApiError(list.error).requestId}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : items.length === 0 ? (
        <EmptyState title={emptyText} />
      ) : (
        <>
          <AuditTable label={t("records.auditTableLabel")} items={items} branches={[]} />
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

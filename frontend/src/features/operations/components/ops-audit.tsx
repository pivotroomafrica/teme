"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Button,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  Pagination,
  Select,
  Skeleton,
  SkeletonGroup,
} from "@/components/ui";
import { AuditTable } from "@/features/records/components/audit-table";
import {
  AUDIT_ACTION_LABEL,
  FILTERABLE_ACTIONS,
  rangeProblem,
} from "@/features/records/records-rules";
import { useCursorPages } from "@/features/records/use-cursor-pages";
import { getBrowserApi } from "@/lib/api/browser";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";
import type { PlatformAuditQuery } from "../api";
import { MerchantActivity } from "./merchant-activity";
import { MerchantPicker, useMerchants } from "./merchant-picker";

const PAGE_SIZE = 10;
const EMPTY = { from: "", to: "", action: "", targetType: "" };
const PLATFORM_ACTIONS = [
  "platform.admin_bootstrapped",
  "platform.merchant_bootstrapped",
  "user.deactivated",
  "outbox.job_requeued",
  "audit.platform_accessed",
] as const;

/**
 * The platform audit. By default it shows platform-level events only (what administrators did). Choosing a merchant
 * switches to that merchant's activity, which the backend records in the merchant's own history, so that view starts
 * only after a confirmation. This page only reads; nothing here can change or remove an entry.
 */
export function OpsAudit() {
  const { t } = useI18n();
  const merchants = useMerchants();
  const paging = useCursorPages(PAGE_SIZE);
  const [draft, setDraft] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [merchantId, setMerchantId] = useState("");
  const invalid = rangeProblem(draft.from, draft.to);
  const merchant = merchants.data?.find((m) => m.id === merchantId) ?? null;

  const filters: PlatformAuditQuery = {
    from: applied.from || undefined,
    to: applied.to || undefined,
    action: applied.action || undefined,
    targetType: applied.targetType || undefined,
  };
  const query: PlatformAuditQuery = { ...filters, limit: PAGE_SIZE, cursor: paging.cursor };
  const list = useQuery({
    queryKey: ["ops", "audit", "platform", query],
    queryFn: ({ signal }) => getBrowserApi().operations.audit(query, signal),
    enabled: !merchant,
    placeholderData: keepPreviousData,
  });
  const items = list.data?.items ?? [];
  const set = (key: keyof typeof EMPTY) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="flex flex-col gap-4">
      <form
        aria-label={t("records.filtersTitle")}
        className="grid gap-3 rounded-card border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (invalid) return;
          paging.reset();
          setApplied(draft);
        }}
      >
        <FormField label={t("records.dateFrom")}>
          <Input type="date" value={draft.from} onChange={(e) => set("from")(e.target.value)} />
        </FormField>
        <FormField
          label={t("records.dateTo")}
          error={invalid ? t("records.invalidRange") : undefined}
        >
          <Input type="date" value={draft.to} onChange={(e) => set("to")(e.target.value)} />
        </FormField>
        <FormField label={t("records.filterAction")}>
          <Select value={draft.action} onChange={(e) => set("action")(e.target.value)}>
            <option value="">{t("records.anyAction")}</option>
            {[...PLATFORM_ACTIONS, ...FILTERABLE_ACTIONS].map((code) => (
              <option key={code} value={code}>
                {AUDIT_ACTION_LABEL[code] ? t(AUDIT_ACTION_LABEL[code]) : code}
              </option>
            ))}
          </Select>
        </FormField>
        {merchants.data ? (
          <MerchantPicker
            label={t("ops.auditMerchantFilter")}
            placeholder={t("ops.auditPlatformOnly")}
            value={merchantId}
            merchants={merchants.data}
            onChange={(m) => {
              setMerchantId(m?.id ?? "");
              paging.reset();
            }}
          />
        ) : null}
        <div className="flex items-end gap-2">
          <Button type="submit" disabled={invalid}>
            {t("records.applyFilters")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setDraft(EMPTY);
              setApplied(EMPTY);
              setMerchantId("");
              paging.reset();
            }}
          >
            {t("records.clearFilters")}
          </Button>
        </div>
      </form>

      {merchant ? (
        <MerchantActivity
          key={`${merchant.id}-${JSON.stringify(applied)}`}
          merchant={merchant}
          filters={filters}
          emptyText={t("records.auditNoMatch")}
          buttonLabel={t("ops.detailActivityButton")}
        />
      ) : list.isPending ? (
        <SkeletonGroup className="flex flex-col gap-3">
          <Skeleton className="h-48 w-full" />
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
        <EmptyState title={t("records.auditNoMatch")} />
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

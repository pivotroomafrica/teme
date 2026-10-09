"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Alert,
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
import { pickLocalized } from "@/features/enrollment/localized";
import type { AuditQuery } from "@/features/audit/api";
import { getBrowserApi } from "@/lib/api/browser";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";
import {
  AUDIT_ACTION_LABEL,
  FILTERABLE_ACTIONS,
  TARGET_LABEL,
  rangeProblem,
} from "../records-rules";
import { useCursorPages } from "../use-cursor-pages";
import { AuditTable } from "./audit-table";

const PAGE_SIZE = 10;
const EMPTY = {
  from: "",
  to: "",
  actorUserId: "",
  branchId: "",
  action: "",
  targetType: "",
  targetId: "",
};
type Filters = typeof EMPTY;

/**
 * The business audit history: newest first, filtered by date, team member, branch, action and target. Entries are
 * only ever read; nothing here can change or remove one. Filters are applied together with the button so the
 * list does not reload on every keystroke, and any change returns to the first page.
 */
export function AuditWorkspace() {
  const { t, locale } = useI18n();
  const paging = useCursorPages(PAGE_SIZE);
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const invalid = rangeProblem(draft.from, draft.to);

  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: ({ signal }) => getBrowserApi().branches.list(signal),
    retry: false,
  });
  // The staff list has no user ids, so the team filter offers the people who appear in the recent history.
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

  const query: AuditQuery = {
    limit: PAGE_SIZE,
    cursor: paging.cursor,
    from: applied.from || undefined,
    to: applied.to || undefined,
    actorUserId: applied.actorUserId || undefined,
    branchId: applied.branchId || undefined,
    action: applied.action || undefined,
    targetType: applied.targetType || undefined,
    targetId: applied.targetId.trim() || undefined,
  };
  const list = useQuery({
    queryKey: ["audit", "page", query],
    queryFn: ({ signal }) => getBrowserApi().audit.list(query, signal),
    placeholderData: keepPreviousData,
  });

  const filtering = JSON.stringify(applied) !== JSON.stringify(EMPTY);
  const set = (key: keyof Filters) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const items = list.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <form
        aria-label={t("records.filtersTitle")}
        className="grid gap-3 rounded-card border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4"
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
        <FormField label={t("records.filterStaff")}>
          <Select value={draft.actorUserId} onChange={(e) => set("actorUserId")(e.target.value)}>
            <option value="">{t("records.filterAnyStaff")}</option>
            {people.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </FormField>
        {branches.data ? (
          <FormField label={t("records.filterBranch")}>
            <Select value={draft.branchId} onChange={(e) => set("branchId")(e.target.value)}>
              <option value="">{t("records.filterAnyBranch")}</option>
              {branches.data.map((b) => (
                <option key={b.id} value={b.id}>
                  {pickLocalized(locale, b.nameEn, b.nameAm).text}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}
        <FormField label={t("records.filterAction")}>
          <Select value={draft.action} onChange={(e) => set("action")(e.target.value)}>
            <option value="">{t("records.anyAction")}</option>
            {FILTERABLE_ACTIONS.map((code) => (
              <option key={code} value={code}>
                {AUDIT_ACTION_LABEL[code] ? t(AUDIT_ACTION_LABEL[code]) : code}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("records.filterTarget")}>
          <Select value={draft.targetType} onChange={(e) => set("targetType")(e.target.value)}>
            <option value="">{t("records.anyTarget")}</option>
            {Object.entries(TARGET_LABEL).map(([code, key]) => (
              <option key={code} value={code}>
                {t(key)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("records.filterTargetId")}>
          <Input
            value={draft.targetId}
            autoComplete="off"
            onChange={(e) => set("targetId")(e.target.value)}
          />
        </FormField>
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
              paging.reset();
            }}
          >
            {t("records.clearFilters")}
          </Button>
        </div>
      </form>

      <Alert tone="info">{t("records.detailsNote")}</Alert>

      {list.isPending ? (
        <SkeletonGroup className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full" />
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
        filtering ? (
          <EmptyState title={t("records.auditNoMatch")} />
        ) : (
          <EmptyState title={t("records.auditEmpty")} description={t("records.auditEmptyHint")} />
        )
      ) : (
        <>
          <AuditTable
            label={t("records.auditTableLabel")}
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

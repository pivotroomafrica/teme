"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { ResponsiveTable } from "@/features/org/responsive-table";
import { pickLocalized } from "@/features/enrollment/localized";
import type { AuditPage, Branch } from "@/lib/api/contract";
import { useI18n } from "@/lib/i18n/client";
import { AUDIT_ACTION_LABEL, TARGET_LABEL, safeMetadata } from "../records-rules";

export type AuditItem = AuditPage["items"][number];

/**
 * A list of audit entries with human-readable actions and expandable, filtered details. Used by the audit page and
 * by the reward activity tabs. Only flat, non-sensitive metadata is ever shown (see `safeMetadata`), and the
 * network details owners receive from the backend are not part of what this client reads.
 */
export function AuditTable({
  label,
  items,
  branches,
}: {
  label: string;
  items: readonly AuditItem[];
  branches: readonly Branch[];
}) {
  const { t, locale, format } = useI18n();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const actionText = (item: AuditItem) => {
    const key = AUDIT_ACTION_LABEL[item.action];
    return key ? t(key) : t("dashboard.actionOther", { code: item.action });
  };
  const who = (item: AuditItem) =>
    item.actor.type === "SYSTEM" ? t("records.actorSystem") : (item.actor.displayName ?? "—");
  const branchOf = (item: AuditItem) => {
    if (!item.branchId) return t("records.noBranch");
    const b = branches.find((x) => x.id === item.branchId);
    return b ? pickLocalized(locale, b.nameEn, b.nameAm).text : item.branchId.slice(0, 8);
  };
  const targetOf = (item: AuditItem) => {
    if (!item.targetType) return t("records.noBranch");
    const key = TARGET_LABEL[item.targetType];
    return key ? t(key) : item.targetType;
  };
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const what = (item: AuditItem, scope: "table" | "card") => {
    const expanded = open.has(item.id);
    const rows = safeMetadata(item.metadata);
    const panelId = `audit-details-${scope}-${item.id}`;
    return (
      <div className="flex flex-col gap-2">
        <span className="font-medium">{actionText(item)}</span>
        <Button
          variant="secondary"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => toggle(item.id)}
        >
          {expanded ? t("records.hideDetails") : t("records.showDetails")}
          <span className="sr-only"> — {t("records.detailsOf", { action: actionText(item) })}</span>
        </Button>
        {expanded ? (
          <div
            id={panelId}
            className="rounded-control border border-border bg-cream-100 p-3 text-sm"
          >
            {rows.length === 0 ? (
              <p className="text-muted">{t("records.detailsEmpty")}</p>
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                {rows.map((row) => (
                  <div key={row.key} className="contents">
                    <dt className="text-muted">{row.label}</dt>
                    <dd className="break-words">{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {item.requestId ? (
              <p className="mt-2 text-muted">{t("records.requestRef", { id: item.requestId })}</p>
            ) : null}
            <p className="mt-2 text-muted">{t("records.detailsNote")}</p>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <ResponsiveTable
      label={label}
      items={items}
      rowKey={(item) => item.id}
      columns={[
        { id: "when", header: t("records.colWhen"), cell: (i) => format.dateTime(i.occurredAt) },
        { id: "who", header: t("records.colWho"), cell: who },
        { id: "what", header: t("records.colWhat"), cell: (i) => what(i, "table") },
        { id: "branch", header: t("records.colBranch"), cell: branchOf },
        { id: "target", header: t("records.colTarget"), cell: targetOf },
      ]}
      card={(item) => (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">{format.dateTime(item.occurredAt)}</p>
          {what(item, "card")}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted">{t("records.colWho")}</dt>
            <dd>{who(item)}</dd>
            <dt className="text-muted">{t("records.colBranch")}</dt>
            <dd>{branchOf(item)}</dd>
            <dt className="text-muted">{t("records.colTarget")}</dt>
            <dd>{targetOf(item)}</dd>
          </dl>
        </div>
      )}
    />
  );
}

"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  Pagination,
  Select,
  Skeleton,
  SkeletonGroup,
  Textarea,
  useToast,
} from "@/components/ui";
import type { Tone } from "@/components/ui";
import { ResponsiveTable } from "@/features/org/responsive-table";
import { useCursorPages } from "@/features/records/use-cursor-pages";
import { getBrowserApi } from "@/lib/api/browser";
import { newIdempotencyKey } from "@/lib/api/idempotency";
import { CAMPAIGN_AUDIENCES, type Campaign } from "@/lib/api/contract";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translator";

const PAGE_SIZE = 10;
const MESSAGE_MAX = 300;
const STATUS_TONE: Record<Campaign["status"], Tone> = {
  DRAFT: "warning",
  SENT: "success",
  CANCELLED: "neutral",
};

/**
 * Campaigns: messages to customers who agreed to offers and news. This is a PREVIEW. The backend has no campaign
 * operations, so the screen runs against the mock backend and says so at the top; in a production build the service
 * answers 404 and the screen shows "not available yet" instead of an error. Nothing is ever delivered.
 *
 * What it already gets right: only customers who agreed are included, the audience size is shown before sending,
 * sending needs a confirmation and an idempotency key (a retry after a lost answer cannot send twice), and a sent
 * campaign cannot be changed.
 */
export function CampaignsWorkspace() {
  const { t, format } = useI18n();
  const client = useQueryClient();
  const toast = useToast();
  const paging = useCursorPages(PAGE_SIZE);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState<Campaign | null>(null);
  const [cancelling, setCancelling] = useState<Campaign | null>(null);
  const attempt = useRef<{ id: string; key: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["campaigns", paging.cursor ?? null],
    queryFn: ({ signal }) =>
      getBrowserApi().campaigns.list({ cursor: paging.cursor, limit: PAGE_SIZE }, signal),
    placeholderData: keepPreviousData,
  });
  const refresh = () => void client.invalidateQueries({ queryKey: ["campaigns"] });
  const explain = (failure: unknown) => {
    const e = toApiError(failure);
    return e.kind === "forbidden"
      ? t("campaigns.errForbidden")
      : e.kind === "conflict"
        ? t("campaigns.errConflict")
        : describeApiError(e, t).description;
  };

  const send = useMutation({
    mutationFn: (campaign: Campaign) => {
      if (attempt.current?.id !== campaign.id)
        attempt.current = { id: campaign.id, key: newIdempotencyKey() };
      return getBrowserApi().campaigns.send(campaign.id, attempt.current.key);
    },
  });
  async function confirmSend() {
    if (!sending) return;
    setProblem(null);
    try {
      const result = await send.mutateAsync(sending);
      toast.show({
        tone: "success",
        title: result.replayed ? t("campaigns.sentReplayed") : t("campaigns.sent"),
      });
      attempt.current = null;
      setSending(null);
      refresh();
    } catch (failure) {
      setProblem(explain(failure));
    }
  }
  async function confirmCancel() {
    if (!cancelling) return;
    setProblem(null);
    try {
      await getBrowserApi().campaigns.cancel(cancelling.id);
      toast.show({ tone: "success", title: t("campaigns.cancelled") });
      setCancelling(null);
      refresh();
    } catch (failure) {
      setProblem(explain(failure));
    }
  }

  const preview = (
    <Alert tone="warning" title={t("campaigns.previewTitle")}>
      {t("campaigns.previewBody")} {t("campaigns.consentNote")}
    </Alert>
  );

  if (list.isPending) {
    return (
      <div className="flex flex-col gap-4">
        {preview}
        <SkeletonGroup>
          <Skeleton className="h-40 w-full" />
        </SkeletonGroup>
      </div>
    );
  }
  if (list.isError) {
    const failure = toApiError(list.error);
    return (
      <div className="flex flex-col gap-4">
        {preview}
        {failure.kind === "not_found" ? (
          <EmptyState
            title={t("campaigns.unavailableTitle")}
            description={t("campaigns.unavailableBody")}
          />
        ) : (
          <ErrorState
            title={t("campaigns.loadError")}
            description={describeApiError(failure, t).description}
            requestId={failure.requestId}
            onRetry={() => void list.refetch()}
            retrying={list.isFetching}
          />
        )}
      </div>
    );
  }

  const items = list.data.items;
  const audience = (c: Campaign) => t(`campaigns.audience${c.audience}` as MessageKey);
  const status = (c: Campaign) => (
    <Badge tone={STATUS_TONE[c.status]}>{t(`campaigns.status${c.status}` as MessageKey)}</Badge>
  );
  const reach = (c: Campaign) => t("campaigns.reach", { count: format.integer(c.audienceSize) });
  const actions = (c: Campaign) =>
    c.status === "DRAFT" ? (
      <span className="flex flex-wrap gap-2">
        <Button onClick={() => setSending(c)}>
          {t("campaigns.send")}
          <span className="sr-only"> — {c.name}</span>
        </Button>
        <Button variant="secondary" onClick={() => setCancelling(c)}>
          {t("campaigns.cancel")}
          <span className="sr-only"> — {c.name}</span>
        </Button>
      </span>
    ) : c.sentAt ? (
      <span className="text-sm text-muted">
        {t("campaigns.sentOn", { date: format.date(c.sentAt) })}
      </span>
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      {preview}
      <div>
        <Button onClick={() => setCreating(true)}>{t("campaigns.newCampaign")}</Button>
      </div>

      {items.length === 0 ? (
        <EmptyState title={t("campaigns.empty")} description={t("campaigns.emptyHint")} />
      ) : (
        <>
          <ResponsiveTable
            label={t("campaigns.listLabel")}
            items={items}
            rowKey={(c) => c.id}
            columns={[
              { id: "name", header: t("campaigns.colName"), rowHeader: true, cell: (c) => c.name },
              { id: "audience", header: t("campaigns.colAudience"), cell: audience },
              { id: "reach", header: t("campaigns.colReach"), cell: reach },
              { id: "status", header: t("campaigns.colStatus"), cell: status },
              {
                id: "created",
                header: t("campaigns.colCreated"),
                cell: (c) => format.date(c.createdAt),
              },
              { id: "actions", header: t("campaigns.colActions"), cell: actions },
            ]}
            card={(c) => (
              <div className="flex flex-col gap-2">
                <p className="font-semibold text-green-900">{c.name}</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted">{t("campaigns.colAudience")}</dt>
                  <dd>{audience(c)}</dd>
                  <dt className="text-muted">{t("campaigns.colReach")}</dt>
                  <dd>{reach(c)}</dd>
                  <dt className="text-muted">{t("campaigns.colStatus")}</dt>
                  <dd>{status(c)}</dd>
                </dl>
                {actions(c)}
              </div>
            )}
          />
          <Pagination
            hasPrevious={paging.hasPrevious}
            hasNext={Boolean(list.data.nextCursor)}
            onPrevious={paging.previous}
            onNext={() => list.data.nextCursor && paging.next(list.data.nextCursor)}
            from={paging.from}
            to={paging.from + items.length - 1}
            loading={list.isFetching}
          />
        </>
      )}

      {creating ? (
        <CampaignForm
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            toast.show({ tone: "success", title: t("campaigns.created") });
            paging.reset();
            refresh();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={sending !== null}
        onCancel={() => {
          setSending(null);
          setProblem(null);
        }}
        onConfirm={confirmSend}
        title={t("campaigns.sendTitle")}
        description={
          sending
            ? t("campaigns.sendBody", { count: format.integer(sending.audienceSize) })
            : undefined
        }
        confirmLabel={t("campaigns.sendConfirm")}
      >
        {problem ? <Alert tone="danger">{problem}</Alert> : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={cancelling !== null}
        onCancel={() => {
          setCancelling(null);
          setProblem(null);
        }}
        onConfirm={confirmCancel}
        title={t("campaigns.cancelTitle")}
        description={t("campaigns.cancelBody")}
        confirmLabel={t("campaigns.cancelConfirm")}
        tone="danger"
      >
        {problem ? <Alert tone="danger">{problem}</Alert> : null}
      </ConfirmDialog>
    </div>
  );
}

function CampaignForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [messageEn, setMessageEn] = useState("");
  const [messageAm, setMessageAm] = useState("");
  const [audience, setAudience] = useState<Campaign["audience"]>("ALL_OPTED_IN");
  const [touched, setTouched] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      getBrowserApi().campaigns.create({
        name: name.trim(),
        messageEn: messageEn.trim(),
        messageAm: messageAm.trim() || undefined,
        audience,
      }),
  });
  const errors = {
    name: !name.trim()
      ? t("campaigns.nameRequired")
      : name.length > 80
        ? t("campaigns.tooLong")
        : undefined,
    messageEn: !messageEn.trim()
      ? t("campaigns.messageRequired")
      : messageEn.length > MESSAGE_MAX
        ? t("campaigns.tooLong")
        : undefined,
    messageAm: messageAm.length > MESSAGE_MAX ? t("campaigns.tooLong") : undefined,
  };
  const invalid = Boolean(errors.name || errors.messageEn || errors.messageAm);

  async function submit() {
    setTouched(true);
    setProblem(null);
    if (invalid) return;
    try {
      await create.mutateAsync();
      onCreated();
    } catch (failure) {
      const e = toApiError(failure);
      setProblem(
        e.kind === "validation"
          ? t("campaigns.errInvalid")
          : e.kind === "forbidden"
            ? t("campaigns.errForbidden")
            : describeApiError(e, t).description,
      );
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!create.isPending}
      title={t("campaigns.formTitle")}
      description={t("campaigns.consentNote")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            {t("ui.cancel")}
          </Button>
          <Button onClick={() => void submit()} loading={create.isPending}>
            {t("campaigns.create")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {problem ? <Alert tone="danger">{problem}</Alert> : null}
        <FormField
          label={t("campaigns.fieldName")}
          error={touched ? errors.name : undefined}
          required
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField
          label={t("campaigns.fieldMessageEn")}
          hint={t("campaigns.countHint", { count: messageEn.length })}
          error={touched ? errors.messageEn : undefined}
          required
        >
          <Textarea rows={3} value={messageEn} onChange={(e) => setMessageEn(e.target.value)} />
        </FormField>
        <FormField
          label={t("campaigns.fieldMessageAm")}
          hint={t("campaigns.countHint", { count: messageAm.length })}
          error={touched ? errors.messageAm : undefined}
          optional
        >
          <Textarea
            lang="am"
            rows={3}
            value={messageAm}
            onChange={(e) => setMessageAm(e.target.value)}
          />
        </FormField>
        <FormField label={t("campaigns.fieldAudience")}>
          <Select
            value={audience}
            onChange={(e) => setAudience(e.target.value as Campaign["audience"])}
          >
            {CAMPAIGN_AUDIENCES.map((a) => (
              <option key={a} value={a}>
                {t(`campaigns.audience${a}` as MessageKey)}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
    </Dialog>
  );
}

"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  Pagination,
  Select,
  Skeleton,
  SkeletonGroup,
  Tabs,
  Textarea,
  useToast,
} from "@/components/ui";
import type { Tone } from "@/components/ui";
import { ResponsiveTable } from "@/features/org/responsive-table";
import { useCursorPages } from "@/features/records/use-cursor-pages";
import { getBrowserApi } from "@/lib/api/browser";
import { FLAG_STATUSES, FRAUD_INDICATORS, type FraudFlag } from "@/lib/api/contract";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translator";
import { INDICATORS, draftFrom, fieldProblem, thresholdPatch, type Draft } from "../thresholds";

const PAGE_SIZE = 10;
const STATUS_LABEL: Record<FraudFlag["status"], MessageKey> = {
  OPEN: "fraud.statusOpen",
  DISMISSED: "fraud.statusDismissed",
  CONFIRMED: "fraud.statusConfirmed",
};
const STATUS_TONE: Record<FraudFlag["status"], Tone> = {
  OPEN: "warning",
  DISMISSED: "neutral",
  CONFIRMED: "danger",
};
const SUBJECT_LABEL: Record<FraudFlag["subjectType"], MessageKey> = {
  STAFF: "fraud.subjectStaff",
  MEMBERSHIP: "fraud.subjectMembership",
  BRANCH: "fraud.subjectBranch",
};

/**
 * Fraud monitoring: the flags the backend raised, a one-time owner review of each, the limits that raise them, and a
 * button to run the checks now. Indicators only point things out: nothing here blocks, suspends or penalises anyone,
 * and the screen says so. Reviewing, changing limits and running the checks are for owners; the backend decides, and
 * its refusals are shown in words.
 */
export function FraudWorkspace({ canManage }: { canManage: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="info">{t("fraud.intro")}</Alert>
      <Tabs
        label={t("fraud.tabsLabel")}
        tabs={[
          { id: "flags", label: t("fraud.tabFlags"), content: <FlagsTab canManage={canManage} /> },
          {
            id: "limits",
            label: t("fraud.tabThresholds"),
            content: <ThresholdsTab canManage={canManage} />,
          },
        ]}
      />
    </div>
  );
}

function FlagsTab({ canManage }: { canManage: boolean }) {
  const { t, format } = useI18n();
  const client = useQueryClient();
  const toast = useToast();
  const paging = useCursorPages(PAGE_SIZE);
  const [status, setStatus] = useState("");
  const [indicator, setIndicator] = useState("");
  const [reviewing, setReviewing] = useState<FraudFlag | null>(null);

  const query = {
    limit: PAGE_SIZE,
    cursor: paging.cursor,
    status: (status || undefined) as FraudFlag["status"] | undefined,
    indicator: indicator || undefined,
  };
  const list = useQuery({
    queryKey: ["fraud", "flags", query],
    queryFn: ({ signal }) => getBrowserApi().fraud.flags(query, signal),
    placeholderData: keepPreviousData,
  });

  const check = useMutation({ mutationFn: () => getBrowserApi().fraud.evaluate() });
  async function runChecks() {
    try {
      const result = await check.mutateAsync();
      const raised = typeof result.flagsRaised === "number" ? result.flagsRaised : 0;
      toast.show({
        tone: "success",
        title: raised > 0 ? t("fraud.checkedSome", { count: raised }) : t("fraud.checkedNone"),
      });
      paging.reset();
      void client.invalidateQueries({ queryKey: ["fraud", "flags"] });
    } catch (failure) {
      const error = toApiError(failure);
      toast.show({
        tone: "danger",
        title: error.kind === "forbidden" ? t("fraud.errForbidden") : t("fraud.checkFailed"),
      });
    }
  }

  const items = list.data?.items ?? [];
  const nameOf = (f: FraudFlag) => f.subjectLabel ?? t(SUBJECT_LABEL[f.subjectType]);
  const measured = (f: FraudFlag) => {
    const fmt = (n: number) =>
      f.indicator === "HIGH_REVERSAL_RATE"
        ? format.percent(n)
        : format.number(n, { maximumFractionDigits: 2 });
    return t("fraud.measured", { observed: fmt(f.observed), threshold: fmt(f.threshold) });
  };
  const when = (f: FraudFlag) =>
    `${format.dateTime(f.windowStart)} – ${format.dateTime(f.windowEnd)}`;
  const badge = (f: FraudFlag) => (
    <Badge tone={STATUS_TONE[f.status]}>{t(STATUS_LABEL[f.status])}</Badge>
  );
  const reviewButton = (f: FraudFlag) =>
    canManage && f.status === "OPEN" ? (
      <Button variant="secondary" onClick={() => setReviewing(f)}>
        {t("fraud.review")}
        <span className="sr-only"> — {t(`fraud.ind_${f.indicator}` as MessageKey)}</span>
      </Button>
    ) : f.reviewedAt ? (
      <span className="text-sm text-muted">
        {t("fraud.reviewedOn", { date: format.date(f.reviewedAt) })}
      </span>
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label={t("fraud.filterStatus")}>
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              paging.reset();
            }}
          >
            <option value="">{t("fraud.anyStatus")}</option>
            {FLAG_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(STATUS_LABEL[s])}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("fraud.filterIndicator")}>
          <Select
            value={indicator}
            onChange={(e) => {
              setIndicator(e.target.value);
              paging.reset();
            }}
          >
            <option value="">{t("fraud.anyIndicator")}</option>
            {FRAUD_INDICATORS.map((i) => (
              <option key={i} value={i}>
                {t(`fraud.ind_${i}` as MessageKey)}
              </option>
            ))}
          </Select>
        </FormField>
        {canManage ? (
          <div className="flex items-end">
            <Button
              variant="secondary"
              onClick={() => void runChecks()}
              loading={check.isPending}
              loadingLabel={t("fraud.checking")}
            >
              {t("fraud.checkNow")}
            </Button>
          </div>
        ) : null}
      </div>

      {list.isPending ? (
        <SkeletonGroup className="flex flex-col gap-3">
          <Skeleton className="h-40 w-full" />
        </SkeletonGroup>
      ) : list.isError ? (
        <ErrorState
          title={t("fraud.flagsLoadError")}
          description={describeApiError(toApiError(list.error), t).description}
          requestId={toApiError(list.error).requestId}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : items.length === 0 ? (
        status || indicator ? (
          <EmptyState title={t("fraud.flagsNoMatch")} />
        ) : (
          <EmptyState title={t("fraud.flagsEmpty")} description={t("fraud.flagsEmptyHint")} />
        )
      ) : (
        <>
          <ResponsiveTable
            label={t("fraud.flagsTableLabel")}
            items={items}
            rowKey={(f) => f.id}
            columns={[
              {
                id: "what",
                header: t("fraud.colIndicator"),
                rowHeader: true,
                cell: (f) => (
                  <span>
                    {t(`fraud.ind_${f.indicator}` as MessageKey)}
                    <span className="block text-sm font-normal text-muted">
                      {t(`fraud.meaning_${f.indicator}` as MessageKey)}
                    </span>
                  </span>
                ),
              },
              {
                id: "about",
                header: t("fraud.colSubject"),
                cell: (f) => `${t(SUBJECT_LABEL[f.subjectType])}: ${nameOf(f)}`,
              },
              { id: "when", header: t("fraud.colWindow"), cell: when },
              { id: "measured", header: t("fraud.colMeasured"), cell: measured },
              { id: "status", header: t("fraud.colStatus"), cell: badge },
              { id: "actions", header: t("fraud.colActions"), cell: reviewButton },
            ]}
            card={(f) => (
              <div className="flex flex-col gap-2">
                <p className="font-semibold text-green-900">
                  {t(`fraud.ind_${f.indicator}` as MessageKey)}
                </p>
                <p className="text-sm text-muted">
                  {t(`fraud.meaning_${f.indicator}` as MessageKey)}
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted">{t("fraud.colSubject")}</dt>
                  <dd>{`${t(SUBJECT_LABEL[f.subjectType])}: ${nameOf(f)}`}</dd>
                  <dt className="text-muted">{t("fraud.colWindow")}</dt>
                  <dd>{when(f)}</dd>
                  <dt className="text-muted">{t("fraud.colMeasured")}</dt>
                  <dd>{measured(f)}</dd>
                  <dt className="text-muted">{t("fraud.colStatus")}</dt>
                  <dd>{badge(f)}</dd>
                </dl>
                {f.reviewNote ? (
                  <p className="text-sm">{t("fraud.noteLine", { note: f.reviewNote })}</p>
                ) : null}
                {reviewButton(f)}
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

      {reviewing ? (
        <ReviewDialog
          key={reviewing.id}
          flag={reviewing}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null);
            toast.show({ tone: "success", title: t("fraud.reviewSaved") });
            void client.invalidateQueries({ queryKey: ["fraud", "flags"] });
          }}
        />
      ) : null}
    </div>
  );
}

function ReviewDialog({
  flag,
  onClose,
  onDone,
}: {
  flag: FraudFlag;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [verdict, setVerdict] = useState<"DISMISSED" | "CONFIRMED">("DISMISSED");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      getBrowserApi().fraud.review(flag.id, { status: verdict, note: note.trim() || undefined }),
  });
  const tooLong = note.length > 500;

  async function submit() {
    if (tooLong) return;
    setProblem(null);
    try {
      await save.mutateAsync();
      onDone();
    } catch (failure) {
      const error = toApiError(failure);
      setProblem(
        error.code === "ALREADY_REVIEWED"
          ? t("fraud.errAlreadyReviewed")
          : error.kind === "forbidden"
            ? t("fraud.errForbidden")
            : describeApiError(error, t).description,
      );
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!save.isPending}
      title={t("fraud.reviewTitle")}
      description={t("fraud.reviewIntro")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            {t("ui.cancel")}
          </Button>
          <Button onClick={() => void submit()} loading={save.isPending} disabled={tooLong}>
            {t("fraud.reviewSave")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="font-medium">{t(`fraud.ind_${flag.indicator}` as MessageKey)}</p>
        <FormField label={t("fraud.verdict")}>
          <Select value={verdict} onChange={(e) => setVerdict(e.target.value as typeof verdict)}>
            <option value="DISMISSED">{t("fraud.verdictDismiss")}</option>
            <option value="CONFIRMED">{t("fraud.verdictConfirm")}</option>
          </Select>
        </FormField>
        <FormField
          label={t("fraud.noteLabel")}
          hint={t("fraud.noteHint")}
          error={tooLong ? t("fraud.noteTooLong") : undefined}
        >
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>
        {problem ? <Alert tone="danger">{problem}</Alert> : null}
      </div>
    </Dialog>
  );
}

function ThresholdsTab({ canManage }: { canManage: boolean }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["fraud", "thresholds"],
    queryFn: ({ signal }) => getBrowserApi().fraud.thresholds(signal),
  });

  if (query.isPending) return <Skeleton className="h-48 w-full" />;
  if (query.isError) {
    return (
      <ErrorState
        title={t("fraud.thresholdsLoadError")}
        description={describeApiError(toApiError(query.error), t).description}
        requestId={toApiError(query.error).requestId}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  return (
    <ThresholdsForm
      key={JSON.stringify(query.data)}
      saved={draftFrom(query.data as Record<string, Record<string, boolean | number>>)}
      canManage={canManage}
      onSaved={(next) => client.setQueryData(["fraud", "thresholds"], next)}
    />
  );
}

function ThresholdsForm({
  saved,
  canManage,
  onSaved,
}: {
  saved: Draft;
  canManage: boolean;
  onSaved: (next: Record<string, Record<string, boolean | number>>) => void;
}) {
  const { t, format } = useI18n();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(saved);
  const [problem, setProblem] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const patch = thresholdPatch(saved, draft);
  const changed = Object.keys(patch).length > 0;
  const save = useMutation({ mutationFn: () => getBrowserApi().fraud.updateThresholds(patch) });

  const invalid = (key: string, field: (typeof INDICATORS)[number]["fields"][number]) =>
    fieldProblem(field, String(draft[key]![field.name]));
  const anyInvalid = INDICATORS.some((i) => i.fields.some((f) => invalid(i.key, f)));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setChecked(true);
    setProblem(null);
    if (anyInvalid || !changed) return;
    try {
      onSaved((await save.mutateAsync()) as Record<string, Record<string, boolean | number>>);
      toast.show({ tone: "success", title: t("fraud.thresholdsSaved") });
    } catch (failure) {
      const error = toApiError(failure);
      setProblem(
        error.kind === "validation"
          ? t("fraud.thresholdsInvalid")
          : error.kind === "forbidden"
            ? t("fraud.errForbidden")
            : describeApiError(error, t).description,
      );
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <p className="text-muted">{t("fraud.thresholdsIntro")}</p>
      {!canManage ? <Alert tone="info">{t("fraud.thresholdsReadOnly")}</Alert> : null}
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      {INDICATORS.map((indicator) => (
        <fieldset
          key={indicator.key}
          disabled={!canManage || save.isPending}
          className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
        >
          <legend className="px-1 font-semibold text-green-900">
            {t(`fraud.ind_${indicator.flag}` as MessageKey)}
          </legend>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={draft[indicator.key]!.enabled as boolean}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  [indicator.key]: { ...d[indicator.key]!, enabled: e.target.checked },
                }))
              }
            />
            <span>
              {t("fraud.enabled")}
              <span className="sr-only"> — {t(`fraud.ind_${indicator.flag}` as MessageKey)}</span>
            </span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            {indicator.fields.map((field) => (
              <FormField
                key={field.name}
                label={t(field.label)}
                hint={t("fraud.range", {
                  min: format.number(field.min, { maximumFractionDigits: 2 }),
                  max: format.number(field.max, { maximumFractionDigits: 2 }),
                })}
                error={
                  checked && invalid(indicator.key, field)
                    ? t("fraud.thresholdsInvalid")
                    : undefined
                }
              >
                <Input
                  inputMode="decimal"
                  value={String(draft[indicator.key]![field.name])}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      [indicator.key]: { ...d[indicator.key]!, [field.name]: e.target.value },
                    }))
                  }
                />
              </FormField>
            ))}
          </div>
        </fieldset>
      ))}
      {canManage ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={save.isPending} disabled={!changed}>
            {t("fraud.thresholdsSave")}
          </Button>
          <Button
            variant="secondary"
            disabled={!changed || save.isPending}
            onClick={() => {
              setDraft(saved);
              setChecked(false);
              setProblem(null);
            }}
          >
            {t("fraud.thresholdsUndo")}
          </Button>
          {!changed ? (
            <span className="text-sm text-muted">{t("fraud.thresholdsNothing")}</span>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

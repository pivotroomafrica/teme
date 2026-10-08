"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  FormField,
  Input,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";
import type { Tone } from "@/components/ui";
import { getBrowserApi } from "@/lib/api/browser";
import type { Program } from "@/lib/api/contract";
import { STAMP_ICONS } from "@/lib/api/contract";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useHydrated } from "@/hooks/use-hydrated";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes";
import { useFormat, useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translator";
import {
  BACKEND_CODE_MESSAGE,
  BLANK_PROGRAM,
  FIELD_FOR_PATH,
  createProgramSchema,
  hasChanges,
  memberVisibleFields,
  toCreateInput,
  toFormValues,
  toPatch,
  type ProgramFormValues,
} from "../program-form";
import { ProgramPreviews } from "./program-previews";

const STATUS_TONE: Record<Program["status"], Tone> = {
  DRAFT: "neutral",
  ACTIVE: "success",
  PAUSED: "warning",
  ARCHIVED: "neutral",
};
const STATUS_LABEL: Record<Program["status"], MessageKey> = {
  DRAFT: "loyalty.statusDraft",
  ACTIVE: "loyalty.statusActive",
  PAUSED: "loyalty.statusPaused",
  ARCHIVED: "loyalty.statusArchived",
};
const STATUS_EXPLAIN: Record<Program["status"], MessageKey> = {
  DRAFT: "program.statusExplainDraft",
  ACTIVE: "program.statusExplainActive",
  PAUSED: "program.statusExplainPaused",
  ARCHIVED: "program.statusExplainArchived",
};
const ICON_LABEL: Record<(typeof STAMP_ICONS)[number], MessageKey> = {
  coffee: "program.iconCoffee",
  star: "program.iconStar",
  heart: "program.iconHeart",
  check: "program.iconCheck",
  gift: "program.iconGift",
};

type Action = "publish" | "pause" | "archive";

/**
 * Creates a draft or edits one program. What this screen guarantees:
 *  - it only ever sends what the person changed, and the backend decides whether it is allowed (a refusal is
 *    shown in words, never assumed away);
 *  - the stamp requirement is shown locked once customers have joined, with the reason;
 *  - saving a change that members will see (names, reward, terms, colour, card look, waiting time) asks first;
 *  - Publish, Pause and Archive each ask first (Archive is final and needs a typed word);
 *  - leaving with unsaved changes asks first;
 *  - without `program:manage`, and for an archived program, every field is read-only.
 */
export function ProgramEditor({
  program,
  canManage,
  merchant,
  otherActive,
  onChanged,
}: {
  /** The program to edit, or null to create a new draft. */
  program: Program | null;
  canManage: boolean;
  merchant: { nameEn: string; nameAm: string | null };
  /** Another program is the active default, so publishing this one will be refused. */
  otherActive: boolean;
  onChanged: (program: Program) => void;
}) {
  const { t } = useI18n();
  const format = useFormat();
  const toast = useToast();
  const hydrated = useHydrated();
  const schema = useMemo(() => createProgramSchema(t), [t]);
  const saved = useMemo(() => (program ? toFormValues(program) : BLANK_PROGRAM), [program]);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    control,
    getValues,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<ProgramFormValues>({ resolver: zodResolver(schema), defaultValues: saved });
  // Another program, or fresh data from the server: the form starts again from it.
  const loaded = useRef(program?.id ?? "new");
  useEffect(() => {
    const key = program?.id ?? "new";
    if (loaded.current !== key || !isDirty) reset(saved);
    loaded.current = key;
  }, [program, saved, reset, isDirty]);

  const values = useWatch({ control }) as ProgramFormValues;
  const [problem, setProblem] = useState<string | null>(null);
  const [warnPatch, setWarnPatch] = useState<ReturnType<typeof toPatch> | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);

  useUnsavedChangesWarning(isDirty, t("program.unsavedLeave"));

  const archived = program?.status === "ARCHIVED";
  const readOnly = !canManage || archived;
  const locked = program?.stampsRequiredLocked ?? false;

  function explain(error: unknown, formFields = true): string {
    const e = toApiError(error);
    if (formFields) {
      for (const [path, message] of Object.entries(e.fieldErrors)) {
        const field = FIELD_FOR_PATH[path];
        if (field) setError(field, { message });
      }
    }
    const key = BACKEND_CODE_MESSAGE[e.code];
    if (key) return t(key);
    if (e.kind === "validation") return t("errors.validation");
    return describeApiError(e, t).description;
  }

  async function persist(patch: ReturnType<typeof toPatch>) {
    if (!program) return;
    setProblem(null);
    try {
      const updated = await getBrowserApi().programs.update(program.id, patch);
      onChanged(updated);
      reset(toFormValues(updated));
      toast.show({ tone: "success", title: t("program.saved") });
    } catch (error) {
      setProblem(explain(error));
    }
  }

  const submit = handleSubmit(async (formValues) => {
    setProblem(null);
    if (!program) {
      try {
        const created = await getBrowserApi().programs.create(toCreateInput(formValues));
        onChanged(created);
        toast.show({ tone: "success", title: t("program.created") });
      } catch (error) {
        setProblem(explain(error));
      }
      return;
    }
    const patch = toPatch(formValues, program);
    if (!hasChanges(patch)) return;
    if (program.memberCount > 0 && memberVisibleFields(patch).length > 0) {
      setWarnPatch(patch); // members will see this: ask first
      return;
    }
    await persist(patch);
  });

  async function runAction(kind: Action) {
    if (!program) return;
    setBusy(true);
    setProblem(null);
    try {
      const api = getBrowserApi().programs;
      const updated =
        kind === "publish"
          ? await api.activate(program.id)
          : kind === "pause"
            ? await api.pause(program.id)
            : await api.archive(program.id);
      onChanged(updated);
      setAction(null);
    } catch (error) {
      setAction(null);
      setProblem(explain(error, false));
    } finally {
      setBusy(false);
    }
  }

  const memberText = program
    ? program.memberCount === 0
      ? t("program.membersNone")
      : program.memberCount === 1
        ? t("program.membersOne")
        : t("program.membersCount", { count: format.integer(program.memberCount) })
    : null;

  const field = (name: keyof ProgramFormValues) => errors[name]?.message as string | undefined;
  const publishLabel = program?.status === "PAUSED" ? t("program.resume") : t("program.publish");
  const changedFields = warnPatch ? memberVisibleFields(warnPatch).map((key) => t(key)) : [];

  return (
    <div
      className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]"
      data-hydrated={hydrated}
    >
      <form
        onSubmit={submit}
        noValidate
        className="flex min-w-0 flex-col gap-6"
        data-testid="program-form"
      >
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-green-900">
            {program ? program.nameEn : t("program.createTitle")}
          </h2>
          {program ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[program.status]}>{t(STATUS_LABEL[program.status])}</Badge>
              {program.isDefault ? <Badge tone="info">{t("program.defaultBadge")}</Badge> : null}
              <span className="text-sm text-muted">{memberText}</span>
            </div>
          ) : null}
        </header>

        {program ? (
          <p className="-mt-3 text-charcoal-700">{t(STATUS_EXPLAIN[program.status])}</p>
        ) : null}
        {!canManage ? <Alert tone="info">{t("program.readOnlyNote")}</Alert> : null}
        {canManage && archived ? <Alert tone="info">{t("program.archivedNote")}</Alert> : null}
        {problem ? <Alert tone="danger">{problem}</Alert> : null}
        {isDirty && !readOnly ? (
          <Alert tone="warning" data-testid="unsaved">
            {t("program.unsavedBanner")}
          </Alert>
        ) : null}

        <fieldset disabled={readOnly || isSubmitting} className="contents">
          <Section title={t("program.secNames")}>
            <FormField label={t("program.nameEn")} error={field("nameEn")} required>
              <Input {...register("nameEn")} />
            </FormField>
            <FormField label={t("program.nameAm")} error={field("nameAm")}>
              <Input lang="am" {...register("nameAm")} />
            </FormField>
          </Section>

          <Section title={t("program.secReward")}>
            <FormField label={t("program.rewardNameEn")} error={field("rewardNameEn")} required>
              <Input {...register("rewardNameEn")} />
            </FormField>
            <FormField label={t("program.rewardNameAm")} error={field("rewardNameAm")}>
              <Input lang="am" {...register("rewardNameAm")} />
            </FormField>
            <FormField label={t("program.rewardDescEn")} error={field("rewardDescriptionEn")}>
              <Textarea rows={2} {...register("rewardDescriptionEn")} />
            </FormField>
            <FormField label={t("program.rewardDescAm")} error={field("rewardDescriptionAm")}>
              <Textarea rows={2} lang="am" {...register("rewardDescriptionAm")} />
            </FormField>
            <FormField
              label={t("program.validForDays")}
              hint={t("program.validForDaysHint")}
              error={field("validForDays")}
            >
              <Input inputMode="numeric" className="max-w-40" {...register("validForDays")} />
            </FormField>
          </Section>

          <Section title={t("program.secStamps")}>
            <FormField
              label={t("program.stampsRequired")}
              hint={
                locked
                  ? t("program.stampsLocked", { count: format.integer(program?.memberCount ?? 0) })
                  : undefined
              }
              error={field("stampsRequired")}
              required
            >
              <Input
                inputMode="numeric"
                className="max-w-40"
                disabled={locked}
                {...register("stampsRequired")}
              />
            </FormField>
            <FormField
              label={t("program.cooldown")}
              hint={t("program.cooldownHint")}
              error={field("cooldownMinutes")}
              required
            >
              <Input inputMode="numeric" className="max-w-40" {...register("cooldownMinutes")} />
            </FormField>
          </Section>

          <Section title={t("program.secTerms")}>
            <FormField label={t("program.termsEn")} error={field("termsEn")}>
              <Textarea rows={4} {...register("termsEn")} />
            </FormField>
            <FormField label={t("program.termsAm")} error={field("termsAm")}>
              <Textarea rows={4} lang="am" {...register("termsAm")} />
            </FormField>
          </Section>

          <Section title={t("program.secLook")}>
            <FormField
              label={t("program.brandColor")}
              hint={t("program.brandColorHint")}
              error={field("brandColor")}
            >
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  aria-label={t("program.brandColor")}
                  value={
                    /^#[0-9A-Fa-f]{6}$/.test(values.brandColor ?? "")
                      ? values.brandColor
                      : "#1b5e3a"
                  }
                  onChange={(event) =>
                    setValue("brandColor", event.target.value.toUpperCase(), {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                  className="h-11 w-14 cursor-pointer rounded-control border border-charcoal-500 bg-surface p-1"
                />
                <Input className="max-w-40 font-mono" maxLength={7} {...register("brandColor")} />
              </div>
            </FormField>
            <FormField label={t("program.cardTitle")} error={field("cardTitle")}>
              <Input {...register("cardTitle")} />
            </FormField>
            <FormField label={t("program.cardSubtitle")} error={field("cardSubtitle")}>
              <Input {...register("cardSubtitle")} />
            </FormField>
            <FormField label={t("program.stampIcon")}>
              <Select className="max-w-60" {...register("stampIcon")}>
                {STAMP_ICONS.map((icon) => (
                  <option key={icon} value={icon}>
                    {t(ICON_LABEL[icon])}
                  </option>
                ))}
              </Select>
            </FormField>
            <Checkbox label={t("program.showProgressText")} {...register("showProgressText")} />
          </Section>
        </fieldset>

        {!readOnly ? (
          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              size="lg"
              loading={isSubmitting}
              loadingLabel={t("program.saving")}
              disabled={!hydrated || (Boolean(program) && !isDirty)}
            >
              {!program
                ? t("program.createDraft")
                : program.status === "DRAFT"
                  ? t("program.saveDraft")
                  : t("program.saveChanges")}
            </Button>
            {program && isDirty ? (
              <Button variant="ghost" onClick={() => reset(saved)}>
                {t("program.discard")}
              </Button>
            ) : null}
          </div>
        ) : null}

        {program && canManage && program.status !== "ARCHIVED" ? (
          <section
            aria-labelledby="status-title"
            className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
          >
            <h3 id="status-title" className="font-bold text-green-900">
              {t(STATUS_LABEL[program.status])}
            </h3>
            {otherActive && program.status !== "ACTIVE" ? (
              <Alert tone="warning">{t("program.otherActive")}</Alert>
            ) : null}
            {isDirty && program.status !== "ACTIVE" ? (
              <p className="text-sm text-muted">{t("program.saveBeforePublish")}</p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              {program.status === "DRAFT" || program.status === "PAUSED" ? (
                <Button disabled={isDirty || busy} onClick={() => setAction("publish")}>
                  {publishLabel}
                </Button>
              ) : null}
              {program.status === "ACTIVE" ? (
                <Button variant="secondary" disabled={busy} onClick={() => setAction("pause")}>
                  {t("program.pause")}
                </Button>
              ) : null}
              <Button variant="danger" disabled={busy} onClick={() => setAction("archive")}>
                {t("program.archive")}
              </Button>
            </div>
          </section>
        ) : null}
      </form>

      <aside className="min-w-0 lg:sticky lg:top-4 lg:self-start">
        <ProgramPreviews
          values={values?.nameEn === undefined ? getValues() : values}
          merchant={merchant}
          dirty={isDirty}
        />
      </aside>

      <ConfirmDialog
        open={warnPatch !== null}
        title={t("program.warnTitle", { count: format.integer(program?.memberCount ?? 0) })}
        description={t("program.warnBody", { fields: format.list(changedFields) })}
        confirmLabel={t("program.warnConfirm")}
        cancelLabel={t("ui.cancel")}
        onCancel={() => setWarnPatch(null)}
        onConfirm={async () => {
          const patch = warnPatch;
          setWarnPatch(null);
          if (patch) await persist(patch);
        }}
      />
      <ConfirmDialog
        open={action === "publish"}
        title={program?.status === "PAUSED" ? t("program.resumeTitle") : t("program.publishTitle")}
        description={
          program?.status === "PAUSED" ? t("program.resumeBody") : t("program.publishBody")
        }
        confirmLabel={publishLabel}
        cancelLabel={t("ui.cancel")}
        onCancel={() => setAction(null)}
        onConfirm={() => runAction("publish")}
      />
      <ConfirmDialog
        open={action === "pause"}
        title={t("program.pauseTitle")}
        description={t("program.pauseBody")}
        confirmLabel={t("program.pause")}
        cancelLabel={t("ui.cancel")}
        onCancel={() => setAction(null)}
        onConfirm={() => runAction("pause")}
      />
      <ConfirmDialog
        open={action === "archive"}
        tone="danger"
        requirePhrase={t("program.archivePhrase")}
        title={t("program.archiveTitle")}
        description={t("program.archiveBody")}
        confirmLabel={t("program.archive")}
        cancelLabel={t("ui.cancel")}
        onCancel={() => setAction(null)}
        onConfirm={() => runAction("archive")}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4">
      <h3 className="text-lg font-bold text-green-900">{title}</h3>
      {children}
    </section>
  );
}

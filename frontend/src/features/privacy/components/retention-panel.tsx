"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Alert,
  Button,
  ConfirmDialog,
  ErrorState,
  FormField,
  Input,
  Skeleton,
  useToast,
} from "@/components/ui";
import { getBrowserApi } from "@/lib/api/browser";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";

/** 0 turns the clean-up off, otherwise 6 to 120 whole months. */
export function validRetention(text: string): boolean {
  if (!/^\d+$/.test(text.trim())) return false;
  const n = Number(text);
  return n === 0 || (n >= 6 && n <= 120);
}

/**
 * The automatic clean-up of inactive customers. Owners set the period (0 = off) and may apply it now; applying it
 * anonymises customers for good, so it asks first and says how many were affected. What is kept after anonymising is
 * stated plainly. The backend decides who may do this and skips customers who still hold an unclaimed reward.
 */
export function RetentionPanel() {
  const { t } = useI18n();
  const client = useQueryClient();
  const toast = useToast();
  const query = useQuery({
    queryKey: ["privacy", "retention"],
    queryFn: ({ signal }) => getBrowserApi().privacy.getRetention(signal),
  });

  if (query.isPending) return <Skeleton className="h-32 w-full max-w-xl" />;
  if (query.isError) {
    return (
      <ErrorState
        title={t("privacy.retentionLoadError")}
        description={describeApiError(toApiError(query.error), t).description}
        requestId={toApiError(query.error).requestId}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  return (
    <Panel
      key={query.data.inactiveCustomerMonths}
      saved={query.data.inactiveCustomerMonths}
      onSaved={(months) => {
        client.setQueryData(["privacy", "retention"], { inactiveCustomerMonths: months });
        toast.show({ tone: "success", title: t("privacy.retentionSaved") });
      }}
    />
  );
}

function Panel({ saved, onSaved }: { saved: number; onSaved: (months: number) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [text, setText] = useState(String(saved));
  const [touched, setTouched] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const valid = validRetention(text);
  const changed = text.trim() !== String(saved);

  const save = useMutation({
    mutationFn: () => getBrowserApi().privacy.setRetention(Number(text)),
  });
  const explain = (failure: unknown) => {
    const error = toApiError(failure);
    return error.kind === "forbidden"
      ? t("privacy.errForbidden")
      : error.kind === "validation" || error.status === 422
        ? t("privacy.retentionInvalid")
        : describeApiError(error, t).description;
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    setProblem(null);
    if (!valid || !changed) return;
    try {
      const result = await save.mutateAsync();
      onSaved(result.inactiveCustomerMonths);
    } catch (failure) {
      setProblem(explain(failure));
    }
  }

  async function runNow() {
    setProblem(null);
    try {
      const result = await getBrowserApi().privacy.runRetention();
      toast.show({
        tone: "success",
        title:
          result.anonymized > 0
            ? t("privacy.runDone", { count: result.anonymized }) +
              (result.more ? ` ${t("privacy.runMore")}` : "")
            : t("privacy.runNone"),
      });
    } catch (failure) {
      setProblem(explain(failure));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <section aria-labelledby="ret-h" className="flex flex-col gap-4">
        <h2 id="ret-h" className="text-lg font-bold text-green-900">
          {t("privacy.retentionTitle")}
        </h2>
        <p className="text-muted">{t("privacy.retentionIntro")}</p>
        {problem ? <Alert tone="danger">{problem}</Alert> : null}
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <FormField
            label={t("privacy.retentionMonths")}
            hint={t("privacy.retentionHint")}
            error={touched && !valid ? t("privacy.retentionInvalid") : undefined}
          >
            <Input
              inputMode="numeric"
              value={text}
              disabled={save.isPending}
              onChange={(e) => setText(e.target.value)}
            />
          </FormField>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={save.isPending} disabled={!changed}>
              {t("privacy.retentionSave")}
            </Button>
            {!changed ? (
              <span className="text-sm text-muted">{t("privacy.retentionNothing")}</span>
            ) : null}
            <Button
              variant="danger"
              disabled={saved === 0 || changed}
              onClick={() => setRunning(true)}
            >
              {t("privacy.runNow")}
            </Button>
          </div>
          {saved === 0 ? <p className="text-sm text-muted">{t("privacy.runOff")}</p> : null}
        </form>
      </section>

      <section aria-labelledby="kept-h" className="flex flex-col gap-2 border-t border-border pt-6">
        <h2 id="kept-h" className="text-lg font-bold text-green-900">
          {t("privacy.keptTitle")}
        </h2>
        <p className="text-muted">{t("privacy.keptBody")}</p>
      </section>

      <ConfirmDialog
        open={running}
        onCancel={() => setRunning(false)}
        onConfirm={runNow}
        title={t("privacy.runTitle")}
        description={t("privacy.runBody")}
        confirmLabel={t("privacy.runConfirm")}
        tone="danger"
        requirePhrase="ANONYMISE"
      />
    </div>
  );
}

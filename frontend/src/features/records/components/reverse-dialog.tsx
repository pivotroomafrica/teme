"use client";

import { useRef, useState } from "react";
import { Alert, Badge, Button, Dialog, FormField, Input, Textarea } from "@/components/ui";
import { getBrowserApi } from "@/lib/api/browser";
import { newIdempotencyKey } from "@/lib/api/idempotency";
import type { LedgerEntry, ReversalResult } from "@/lib/api/contract";
import { useI18n } from "@/lib/i18n/client";
import { REASON_MAX, REVERSE_PHRASE, explainReversalError, reasonProblem } from "../records-rules";

/**
 * Reverses one stamp or one given reward. Three steps in one dialog: the reason, a review that shows the original
 * entry and asks for a typed word, and the result with the new correction.
 *
 * Nothing here deletes anything: the backend appends a compensating entry that points at the original, and the
 * original stays in the history marked as reversed. The result says so in words.
 *
 * The request is sent once per tap with one idempotency key. If the answer is lost and the person taps again with
 * the same reason, the same key is reused, so the backend can answer "already recorded" instead of reversing
 * twice. Changing the reason starts a new attempt with a new key.
 */
export function ReverseDialog({
  entry,
  branchName,
  onClose,
  onDone,
}: {
  entry: LedgerEntry;
  branchName: string | null;
  onClose: () => void;
  /** Called after a successful reversal so the caller can refresh what it shows. */
  onDone: (result: ReversalResult) => void;
}) {
  const { t, format } = useI18n();
  const [step, setStep] = useState<"reason" | "review" | "done">("reason");
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReversalResult | null>(null);
  const attempt = useRef<{ key: string; reason: string } | null>(null);

  const isStamp = entry.type === "STAMP";
  const problem = reasonProblem(reason);

  async function submit() {
    const cleaned = reason.trim();
    if (!attempt.current || attempt.current.reason !== cleaned) {
      attempt.current = { key: newIdempotencyKey(), reason: cleaned };
    }
    setPending(true);
    setError(null);
    try {
      const api = getBrowserApi().memberships;
      const done = isStamp
        ? await api.reverseStamp(entry.id, cleaned, attempt.current.key)
        : await api.reverseRedemption(entry.id, cleaned, attempt.current.key);
      setResult(done);
      setStep("done");
      onDone(done);
    } catch (failure) {
      setError(explainReversalError(failure, t));
    } finally {
      setPending(false);
    }
  }

  const title = isStamp ? t("records.reverseStampTitle") : t("records.reverseRedemptionTitle");
  const original = (
    <dl className="rounded-control border border-border bg-cream-100 p-3 text-sm">
      <dt className="font-medium text-green-900">{t("records.originalEvent")}</dt>
      <dd className="mt-1">
        <span className="font-medium">
          {isStamp ? t("records.entryStamp") : t("records.entryRedemption")}
        </span>
        {" · "}
        {format.dateTime(entry.occurredAt)}
        {branchName ? ` · ${t("records.atBranch", { branch: branchName })}` : null}
      </dd>
    </dl>
  );

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!pending}
      title={step === "done" ? t("records.reverseDone") : title}
      description={step === "done" ? t("records.reverseDoneBody") : t("records.reverseIntro")}
      footer={
        step === "done" ? (
          <Button onClick={onClose}>{t("records.done")}</Button>
        ) : step === "reason" ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t("ui.cancel")}
            </Button>
            <Button
              onClick={() => {
                setTouched(true);
                if (!problem) setStep("review");
              }}
            >
              {t("records.reverseReview")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setStep("reason")} disabled={pending}>
              {t("ui.previous")}
            </Button>
            <Button
              variant="danger"
              onClick={() => void submit()}
              loading={pending}
              disabled={typed.trim() !== REVERSE_PHRASE}
            >
              {t("records.reverseConfirmAction")}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {original}

        {step === "reason" ? (
          <FormField
            label={t("records.reasonField")}
            hint={t("records.reasonHint")}
            required
            error={
              touched && problem
                ? problem === "short"
                  ? t("records.reasonTooShort")
                  : t("records.reasonTooLong")
                : undefined
            }
          >
            <Textarea
              value={reason}
              rows={3}
              maxLength={REASON_MAX + 100}
              onChange={(event) => setReason(event.target.value)}
              onBlur={() => setTouched(true)}
            />
          </FormField>
        ) : null}

        {step === "review" ? (
          <>
            <Alert tone="warning" title={t("records.reverseConfirmTitle")}>
              {t("records.reverseConfirmBody")}
            </Alert>
            <p className="text-sm">
              <span className="font-medium">{t("records.reasonField")}:</span> {reason.trim()}
            </p>
            <FormField label={t("ui.typeToConfirm", { phrase: REVERSE_PHRASE })}>
              <Input
                value={typed}
                autoComplete="off"
                autoCapitalize="characters"
                onChange={(event) => setTyped(event.target.value)}
              />
            </FormField>
            {error ? (
              <Alert tone="danger" title={t("errors.genericTitle")}>
                {error}
              </Alert>
            ) : null}
          </>
        ) : null}

        {step === "done" && result ? (
          <div className="flex flex-col gap-3" data-testid="reversal-result">
            {result.replayed ? <Alert tone="info">{t("records.replayed")}</Alert> : null}
            <p className="flex flex-wrap items-center gap-2">
              <Badge tone="info">{t("records.correctionEvent")}</Badge>
              <span>{format.dateTime(result.occurredAt)}</span>
            </p>
            <p className="text-sm">{t("records.historyKept")}</p>
            <ProgressLines result={result} />
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

function ProgressLines({ result }: { result: ReversalResult }) {
  const { t } = useI18n();
  const current = result.progress.current;
  const required = result.progress.required;
  const rewards = result.progress.rewardsAvailable;
  return (
    <ul className="text-sm">
      {typeof current === "number" && typeof required === "number" ? (
        <li>{t("records.progressNow", { current, required })}</li>
      ) : null}
      {typeof rewards === "number" ? <li>{t("records.rewardsNow", { count: rewards })}</li> : null}
    </ul>
  );
}

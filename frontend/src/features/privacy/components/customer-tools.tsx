"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  FormField,
  Select,
  useToast,
} from "@/components/ui";
import { getBrowserApi } from "@/lib/api/browser";
import { ANONYMIZATION_REASONS, type Customer, type CustomerData } from "@/lib/api/contract";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translator";
import type { AnonymizeReason } from "../api";

type Dialogs = "none" | "withdraw" | "pause" | "resume" | "reissue" | "lost" | "data" | "anonymize";

/** The portable copy as a file the browser saves. The data is held in memory only for the download. */
export function downloadJson(data: unknown, name: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * What an owner or manager can do for one customer: stop marketing messages, pause or resume the card, replace it,
 * remove wallet cards after a lost phone (customer:manage), and for owners (privacy:manage) view the stored data,
 * download a copy and anonymise the customer. Every action asks first, is sent once, and says in words what happened.
 * The backend decides who may do what and records the privacy actions in the audit log without the customer's details.
 */
export function CustomerTools({
  customer,
  membershipId,
  membershipActive,
  canManage,
  canPrivacy,
  onCustomerChanged,
  onClosed,
}: {
  customer: Customer;
  membershipId: string | null;
  membershipActive: boolean;
  canManage: boolean;
  canPrivacy: boolean;
  /** The customer as the backend now has it (for example after consent was withdrawn). */
  onCustomerChanged: (customer: Customer) => void;
  /** The customer can no longer be shown (anonymised): close the panel. */
  onClosed: () => void;
}) {
  const { t, format } = useI18n();
  const client = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState<Dialogs>("none");
  const [data, setData] = useState<CustomerData | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [reason, setReason] = useState<AnonymizeReason>("CUSTOMER_REQUEST");
  const [needsAck, setNeedsAck] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const close = () => {
    setOpen("none");
    setProblem(null);
    setNeedsAck(false);
    setAcknowledged(false);
  };
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["membership", membershipId] });
    void client.invalidateQueries({ queryKey: ["customers"] });
  };
  const explain = (failure: unknown) => {
    const error = toApiError(failure);
    return error.kind === "forbidden"
      ? t("privacy.errForbidden")
      : describeApiError(error, t).description;
  };

  /** Runs one action, closes its dialog on success and reports in words. A failure keeps the dialog open. */
  async function act(run: () => Promise<void>) {
    setProblem(null);
    try {
      await run();
    } catch (failure) {
      setProblem(explain(failure));
      throw failure;
    }
  }

  const api = () => getBrowserApi();
  const id = membershipId;

  const withdraw = () =>
    act(async () => {
      onCustomerChanged(await api().customers.withdrawMarketing(customer.id));
      toast.show({ tone: "success", title: t("privacy.withdrawn") });
      close();
    });
  const setActive = (active: boolean) =>
    act(async () => {
      if (!id) return;
      await (active ? api().memberships.reactivate(id) : api().memberships.deactivate(id));
      toast.show({ tone: "success", title: t(active ? "privacy.resumed" : "privacy.paused") });
      refresh();
      close();
    });
  const reissue = () =>
    act(async () => {
      if (!id) return;
      const result = await api().memberships.reissueCard(id);
      setNewCode(result.token);
      refresh();
      close();
    });
  const lostPhone = () =>
    act(async () => {
      if (!id) return;
      const result = await api().memberships.invalidatePasses(id);
      toast.show({ tone: "success", title: t("privacy.lostDone", { count: result.invalidated }) });
      refresh();
      close();
    });
  const viewData = async () => {
    setOpen("data");
    setData(null);
    try {
      await act(async () => setData(await api().privacy.customerData(customer.id)));
    } catch {
      /* the failure is shown inside the dialog */
    }
  };
  const exportData = () =>
    act(async () => {
      downloadJson(await api().privacy.exportCustomer(customer.id), `customer-${customer.id}.json`);
      toast.show({ tone: "success", title: t("privacy.exported") });
    });
  const anonymize = async () => {
    setProblem(null);
    try {
      await api().privacy.anonymize(customer.id, {
        reason,
        acknowledgeOutstandingRewards: acknowledged || undefined,
      });
      toast.show({ tone: "success", title: t("privacy.anonDone") });
      close();
      refresh();
      onClosed();
    } catch (failure) {
      const error = toApiError(failure);
      if (error.code === "REWARDS_OUTSTANDING") setNeedsAck(true);
      else setProblem(explain(failure));
    }
  };

  const ignore = () => undefined;

  return (
    <section aria-labelledby="tools-h" className="flex flex-col gap-3">
      <h3 id="tools-h" className="font-semibold text-green-900">
        {t("privacy.toolsTitle")}
      </h3>
      <p className="text-sm text-muted">{t("privacy.toolsIntro")}</p>
      <div className="flex flex-wrap gap-2">
        {canManage && customer.marketingConsent ? (
          <Button variant="secondary" onClick={() => setOpen("withdraw")}>
            {t("privacy.withdrawConsent")}
          </Button>
        ) : null}
        {canManage && id ? (
          <>
            <Button
              variant="secondary"
              onClick={() => setOpen(membershipActive ? "pause" : "resume")}
            >
              {membershipActive ? t("privacy.cardPause") : t("privacy.cardResume")}
            </Button>
            <Button variant="secondary" onClick={() => setOpen("reissue")}>
              {t("privacy.reissue")}
            </Button>
            <Button variant="secondary" onClick={() => setOpen("lost")}>
              {t("privacy.lostPhone")}
            </Button>
          </>
        ) : null}
        {canPrivacy ? (
          <>
            <Button variant="secondary" onClick={() => void viewData()}>
              {t("privacy.viewData")}
            </Button>
            <Button variant="secondary" onClick={() => void exportData().catch(ignore)}>
              {t("privacy.exportData")}
            </Button>
            <Button variant="danger" onClick={() => setOpen("anonymize")}>
              {t("privacy.anonymize")}
            </Button>
          </>
        ) : null}
      </div>
      {problem && open === "none" ? <Alert tone="danger">{problem}</Alert> : null}

      <ConfirmDialog
        open={open === "withdraw"}
        onCancel={close}
        onConfirm={() => withdraw().catch(ignore)}
        title={t("privacy.withdrawTitle")}
        description={t("privacy.withdrawBody")}
      >
        {problem ? <Alert tone="danger">{problem}</Alert> : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={open === "pause"}
        onCancel={close}
        onConfirm={() => setActive(false).catch(ignore)}
        title={t("privacy.pauseTitle")}
        description={t("privacy.pauseBody")}
      >
        {problem ? <Alert tone="danger">{problem}</Alert> : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={open === "resume"}
        onCancel={close}
        onConfirm={() => setActive(true).catch(ignore)}
        title={t("privacy.resumeTitle")}
        description={t("privacy.resumeBody")}
      >
        {problem ? <Alert tone="danger">{problem}</Alert> : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={open === "reissue"}
        onCancel={close}
        onConfirm={() => reissue().catch(ignore)}
        title={t("privacy.reissueTitle")}
        description={t("privacy.reissueBody")}
        confirmLabel={t("privacy.reissueConfirm")}
      >
        {problem ? <Alert tone="danger">{problem}</Alert> : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={open === "lost"}
        onCancel={close}
        onConfirm={() => lostPhone().catch(ignore)}
        title={t("privacy.lostTitle")}
        description={t("privacy.lostBody")}
        confirmLabel={t("privacy.lostConfirm")}
        tone="danger"
      >
        {problem ? <Alert tone="danger">{problem}</Alert> : null}
      </ConfirmDialog>

      <Dialog
        open={newCode !== null}
        onClose={() => setNewCode(null)}
        title={t("privacy.reissued")}
        description={t("privacy.reissuedBody")}
        footer={<Button onClick={() => setNewCode(null)}>{t("ui.close")}</Button>}
      >
        <FormField label={t("privacy.newCode")}>
          <output
            dir="ltr"
            className="block rounded-control border border-border bg-cream-100 p-3 text-start font-mono break-all"
            data-testid="new-card-code"
          >
            {newCode}
          </output>
        </FormField>
      </Dialog>

      <Dialog
        open={open === "data"}
        onClose={close}
        title={t("privacy.dataTitle")}
        description={t("privacy.dataIntro")}
        footer={<Button onClick={close}>{t("ui.close")}</Button>}
      >
        {problem ? (
          <Alert tone="danger">{problem}</Alert>
        ) : data ? (
          <div className="flex flex-col gap-4 text-sm" data-testid="stored-data">
            {data.customer.anonymizedAt ? (
              <Alert tone="info">{t("privacy.dataAnonymized")}</Alert>
            ) : null}
            <section aria-labelledby="d-profile">
              <h4 id="d-profile" className="font-semibold">
                {t("privacy.dataProfile")}
              </h4>
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted">{t("records.colName")}</dt>
                <dd>{data.customer.firstName ?? "—"}</dd>
                <dt className="text-muted">{t("records.colPhone")}</dt>
                <dd dir="ltr" className="text-start">
                  {data.customer.phone ?? "—"}
                </dd>
                <dt className="text-muted">{t("records.colJoined")}</dt>
                <dd>{data.customer.createdAt ? format.date(data.customer.createdAt) : "—"}</dd>
              </dl>
            </section>
            <section aria-labelledby="d-consent">
              <h4 id="d-consent" className="font-semibold">
                {t("privacy.dataConsents")}
              </h4>
              <ul className="mt-1 list-disc ps-5">
                {data.consents.map((c, i) => (
                  <li key={i}>
                    {c.type} · {c.action} · {c.occurredAt ? format.date(c.occurredAt) : "—"}
                  </li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="d-cards">
              <h4 id="d-cards" className="font-semibold">
                {t("privacy.dataMemberships")}
              </h4>
              {data.memberships.map((m) => (
                <div key={m.id} className="mt-1 rounded-control border border-border p-2">
                  <p className="flex flex-wrap items-center gap-2">
                    <Badge tone={m.status === "ACTIVE" ? "success" : "neutral"}>
                      {t("privacy.dataStatus", { status: m.status })}
                    </Badge>
                    {m.joinedAt ? (
                      <span>{t("privacy.dataJoined", { date: format.date(m.joinedAt) })}</span>
                    ) : null}
                  </p>
                  <p className="mt-1">
                    {t("privacy.dataCounts", {
                      stamps: m.stamps.length,
                      redemptions: m.redemptions.length,
                      reversals: m.reversals.length,
                    })}
                  </p>
                </div>
              ))}
            </section>
          </div>
        ) : (
          <p aria-busy="true">{t("ui.loadingContent")}</p>
        )}
      </Dialog>

      <ConfirmDialog
        open={open === "anonymize"}
        onCancel={close}
        onConfirm={anonymize}
        title={t("privacy.anonTitle")}
        description={t("privacy.anonBody")}
        confirmLabel={t("privacy.anonConfirm")}
        tone="danger"
        requirePhrase="ANONYMISE"
      >
        <div className="flex flex-col gap-3">
          <FormField label={t("privacy.anonReason")}>
            <Select value={reason} onChange={(e) => setReason(e.target.value as AnonymizeReason)}>
              {ANONYMIZATION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`privacy.reason${r}` as MessageKey)}
                </option>
              ))}
            </Select>
          </FormField>
          {needsAck ? (
            <Alert tone="warning">
              <p>{t("privacy.rewardsOutstanding")}</p>
              <label className="mt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                <span>{t("privacy.acknowledge")}</span>
              </label>
            </Alert>
          ) : null}
          {problem ? <Alert tone="danger">{problem}</Alert> : null}
        </div>
      </ConfirmDialog>
    </section>
  );
}

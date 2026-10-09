"use client";

import { useState } from "react";
import { Alert, EmptyState, ErrorState, FormField, Select, Skeleton } from "@/components/ui";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";
import type { PlatformAuditQuery } from "../api";
import { MerchantActivity } from "./merchant-activity";
import { MerchantPicker, useMerchants } from "./merchant-picker";
import { Unavailable } from "./unavailable";

const KINDS = {
  anonymized: { action: "customer.anonymized", label: "ops.privacyAnonymized" },
  consent: { action: "customer.marketing_consent_withdrawn", label: "ops.privacyConsent" },
  access: { actionPrefix: "customer.data_", label: "ops.privacyAccess" },
} as const;
type Kind = keyof typeof KINDS;

/**
 * Privacy records. The service has no queue of privacy requests for the platform: export, anonymisation and consent
 * withdrawal are carried out by each business's owner. What a platform administrator can see is the audit trail of
 * those actions for one merchant, which holds customer ids but no names, phone numbers or other personal details.
 * Reading it is recorded in the merchant's history, so it starts only after a confirmation.
 */
export function PrivacyView() {
  const { t } = useI18n();
  const merchants = useMerchants();
  const [merchantId, setMerchantId] = useState("");
  const [kind, setKind] = useState<Kind>("anonymized");

  if (merchants.isPending) return <Skeleton className="h-24 w-full" />;
  if (merchants.isError) {
    const failure = toApiError(merchants.error);
    return (
      <ErrorState
        title={t("ops.merchantsLoadError")}
        description={describeApiError(failure, t).description}
        requestId={failure.requestId}
        onRetry={() => void merchants.refetch()}
        retrying={merchants.isFetching}
      />
    );
  }

  const merchant = merchants.data.find((m) => m.id === merchantId) ?? null;
  const spec = KINDS[kind];
  const filters: Omit<PlatformAuditQuery, "merchantId" | "limit" | "cursor"> =
    "action" in spec ? { action: spec.action } : { actionPrefix: spec.actionPrefix };

  return (
    <div className="flex flex-col gap-5">
      <Alert tone="info">{t("ops.privacyNote")}</Alert>
      <Unavailable items={["ops.capPrivacy"]} />
      <div className="grid gap-3 sm:grid-cols-2">
        <MerchantPicker
          label={t("ops.privacyPick")}
          placeholder={t("ops.privacyPickPlaceholder")}
          value={merchantId}
          merchants={merchants.data}
          onChange={(m) => setMerchantId(m?.id ?? "")}
        />
        <FormField label={t("ops.privacyKind")}>
          <Select value={kind} onChange={(event) => setKind(event.target.value as Kind)}>
            {(Object.keys(KINDS) as Kind[]).map((key) => (
              <option key={key} value={key}>
                {t(KINDS[key].label)}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      {merchant ? (
        // A different merchant needs its own confirmation, so the view is rebuilt when the merchant changes.
        <MerchantActivity
          key={merchant.id}
          merchant={merchant}
          filters={filters}
          emptyText={t("ops.privacyEmpty")}
        />
      ) : (
        <EmptyState title={t("ops.privacyNeedMerchant")} />
      )}
    </div>
  );
}

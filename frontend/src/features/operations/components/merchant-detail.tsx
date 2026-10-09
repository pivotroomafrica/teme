"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Badge, EmptyState, ErrorState, Skeleton, SkeletonGroup } from "@/components/ui";
import { pickLocalized } from "@/features/enrollment/localized";
import { getBrowserApi } from "@/lib/api/browser";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";
import { MERCHANT_STATUS_LABEL, MERCHANT_STATUS_TONE } from "../ops-rules";
import { MerchantActivity } from "./merchant-activity";
import { Unavailable } from "./unavailable";

/**
 * One merchant: the organisation-level data the service provides (name, short name, status) and, after a recorded
 * confirmation, its recent activity. The service has no per-merchant endpoints for programs, branches, staff or
 * support cases, so those are stated as not available rather than shown empty.
 */
export function MerchantDetail({ merchantId }: { merchantId: string }) {
  const { t, locale } = useI18n();
  const list = useQuery({
    queryKey: ["ops", "merchants"],
    queryFn: ({ signal }) => getBrowserApi().operations.merchants(signal),
  });

  const back = (
    <Link className="font-medium underline" href={`/${locale}/operations/merchants`}>
      {t("ops.detailBack")}
    </Link>
  );

  if (list.isPending) {
    return (
      <SkeletonGroup className="flex flex-col gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
      </SkeletonGroup>
    );
  }
  if (list.isError) {
    const failure = toApiError(list.error);
    return (
      <ErrorState
        title={t("ops.merchantsLoadError")}
        description={describeApiError(failure, t).description}
        requestId={failure.requestId}
        onRetry={() => void list.refetch()}
        retrying={list.isFetching}
      />
    );
  }

  const merchant = list.data.find((m) => m.id === merchantId);
  if (!merchant) {
    return <EmptyState title={t("ops.detailNotFound")} action={back} />;
  }
  const name = pickLocalized(locale, merchant.nameEn, merchant.nameAm);

  return (
    <div className="flex flex-col gap-6">
      {back}
      <section aria-labelledby="org-h" className="rounded-card border border-border bg-surface p-5">
        <h2 id="org-h" className="text-xl font-bold text-green-900" lang={name.lang}>
          {name.text}
        </h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted">{t("ops.colSlug")}</dt>
          <dd>{merchant.slug}</dd>
          <dt className="text-muted">{t("ops.colStatus")}</dt>
          <dd>
            <Badge tone={MERCHANT_STATUS_TONE[merchant.status]}>
              {t(MERCHANT_STATUS_LABEL[merchant.status])}
            </Badge>
          </dd>
        </dl>
        <p className="mt-3 text-sm text-muted">{t("ops.detailOrgOnly")}</p>
      </section>

      <section aria-labelledby="summary-h" className="flex flex-col gap-2">
        <h2 id="summary-h" className="text-lg font-bold text-green-900">
          {t("ops.detailUnavailableTitle")}
        </h2>
        <Unavailable
          items={["ops.capMerchantApproval", "ops.capMerchantSummary", "ops.capSupport"]}
        />
      </section>

      <section aria-labelledby="activity-h" className="flex flex-col gap-3">
        <h2 id="activity-h" className="text-lg font-bold text-green-900">
          {t("ops.detailActivityTitle")}
        </h2>
        <MerchantActivity merchant={merchant} emptyText={t("ops.detailActivityEmpty")} />
      </section>
    </div>
  );
}

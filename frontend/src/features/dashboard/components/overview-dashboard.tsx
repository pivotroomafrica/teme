"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import {
  Alert,
  BarChart,
  EmptyState,
  MetricCard,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  RowHeader,
} from "@/components/ui";
import { ACTION_LABEL } from "@/features/org/action-labels";
import { pickLocalized } from "@/features/enrollment/localized";
import { createFormatter } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translator";
import { paramsFor, rangeFromParams } from "../range";
import {
  useBranchActivity,
  useDefinitions,
  useMonthlyReturning,
  useOverview,
  useRecentEvents,
  useWalletHealth,
} from "../use-dashboard-data";
import { DateRangeControl } from "./date-range-control";
import { DashboardSection } from "./section";

const PROVIDER_LABEL: Record<string, MessageKey> = {
  APPLE: "dashboard.walletApple",
  GOOGLE: "dashboard.walletGoogle",
  WEB: "dashboard.walletWeb",
};

/**
 * The merchant overview. Every figure is exactly what the backend returned for the chosen days, using the
 * backend's own metric definitions: this component picks the dates, formats numbers for the language and time zone,
 * and lays things out. It adds up, averages and compares nothing, and it has no money anywhere: loyalty activity
 * only.
 */
export function OverviewDashboard({
  timeZone,
  today,
  canReadAnalytics,
  canReadAudit,
}: {
  timeZone: string;
  /** Today's date in the business time zone, decided on the server so the first render matches it. */
  today: string;
  canReadAnalytics: boolean;
  canReadAudit: boolean;
}) {
  const { t, locale } = useI18n();
  const format = useMemo(() => createFormatter(locale, timeZone), [locale, timeZone]);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { range, preset } = rangeFromParams(params, today);

  const overview = useOverview(range, canReadAnalytics);
  const monthly = useMonthlyReturning(canReadAnalytics);
  const branches = useBranchActivity(range, canReadAnalytics);
  const wallet = useWalletHealth(range, canReadAnalytics);
  const definitions = useDefinitions(canReadAnalytics);
  const events = useRecentEvents(canReadAudit);

  const go = (query: string) => router.replace(`${pathname}${query}`, { scroll: false });
  const failedSections = [overview, monthly, branches, wallet, events].filter(
    (q) => q.isError,
  ).length;

  const n = (value: number) => format.integer(value);
  const data = overview.data;
  const quiet =
    data !== undefined &&
    data.stampsIssued.count === 0 &&
    data.newMembers === 0 &&
    data.activeMembers === 0 &&
    data.rewardsUnlocked === 0 &&
    data.rewardsRedeemed === 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <DateRangeControl
          preset={preset}
          range={range}
          onPreset={(p) => go(paramsFor(p))}
          onCustom={(r) => go(paramsFor(r))}
        />
        <p className="text-sm text-muted" data-testid="range-summary">
          {t("dashboard.rangeShown", {
            from: format.calendarDate(range.from),
            to: format.calendarDate(range.to),
          })}
          {" · "}
          {t("dashboard.timezoneNote", { zone: timeZone })}
        </p>
      </div>

      {failedSections > 0 ? (
        <Alert tone="warning" title={t("dashboard.partialTitle")}>
          {t("dashboard.partialBody")}
        </Alert>
      ) : null}

      {!canReadAnalytics ? (
        <Alert tone="info">{t("dashboard.noAnalyticsAccess")}</Alert>
      ) : (
        <>
          {quiet ? <Alert tone="info">{t("dashboard.emptyPeriod")}</Alert> : null}

          <section
            aria-label={t("dashboard.thisPeriod")}
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <MetricCard
              emphasis
              className="sm:col-span-2 lg:col-span-3"
              label={t("dashboard.northStar")}
              loading={monthly.isPending}
              value={monthly.data ? n(monthly.data.value) : monthly.isError ? "—" : ""}
              hint={
                monthly.data
                  ? t("dashboard.northStarHint", { month: format.month(monthly.data.month) }) +
                    (monthly.data.series.at(-1)?.partial
                      ? " " +
                        t("dashboard.northStarPartial", { month: format.month(monthly.data.month) })
                      : "")
                  : undefined
              }
            />
            <MetricCard
              label={t("dashboard.newMembers")}
              loading={overview.isPending}
              value={data ? n(data.newMembers) : "—"}
              hint={t("dashboard.thisPeriod")}
            />
            <MetricCard
              label={t("dashboard.activeMembers")}
              loading={overview.isPending}
              value={data ? n(data.activeMembers) : "—"}
              hint={t("dashboard.thisPeriod")}
            />
            <MetricCard
              label={t("dashboard.stampsIssued")}
              loading={overview.isPending}
              value={data ? n(data.stampsIssued.count) : "—"}
              hint={
                data && data.stampsIssued.reversed > 0
                  ? t("dashboard.stampsReversed", { count: n(data.stampsIssued.reversed) })
                  : t("dashboard.thisPeriod")
              }
            />
            <MetricCard
              label={t("dashboard.rewardsUnlocked")}
              loading={overview.isPending}
              value={data ? n(data.rewardsUnlocked) : "—"}
              hint={t("dashboard.thisPeriod")}
            />
            <MetricCard
              label={t("dashboard.rewardsRedeemed")}
              loading={overview.isPending}
              value={data ? n(data.rewardsRedeemed) : "—"}
              hint={t("dashboard.thisPeriod")}
            />
            <MetricCard
              label={t("dashboard.redemptionRate")}
              loading={overview.isPending}
              // The backend's own ratio, shown as a percentage. It can exceed 100% and is null (shown as a dash,
              // never 0%) when nothing was unlocked.
              value={
                data && data.redemptionRate !== null ? format.percent(data.redemptionRate) : "—"
              }
              hint={
                data && data.redemptionRate === null
                  ? t("dashboard.redemptionRateNone")
                  : t("dashboard.thisPeriod")
              }
            />
          </section>

          {overview.isError ? (
            <DashboardSection id="overview" title={t("dashboard.thisPeriod")} query={overview}>
              {null}
            </DashboardSection>
          ) : null}

          {definitions.data && definitions.data.length > 0 ? (
            <details
              className="rounded-card border border-border bg-surface p-4"
              data-testid="definitions"
            >
              <summary className="cursor-pointer font-medium text-green-800">
                {t("dashboard.definitionsToggle")}
              </summary>
              <p className="mt-2 text-sm text-muted">{t("dashboard.definitionsNote")}</p>
              <dl className="mt-3 grid gap-3">
                {definitions.data.map((d) => (
                  <div key={d.key}>
                    <dt className="font-semibold">{d.name}</dt>
                    <dd className="text-charcoal-700">{d.definition}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ) : null}

          <DashboardSection id="trend" title={t("dashboard.trendTitle")} query={monthly}>
            {monthly.data ? (
              <BarChart
                label={t("dashboard.trendChart")}
                summary={monthly.data.series
                  .map(
                    (m) =>
                      `${m.partial ? t("dashboard.monthSoFar", { month: format.month(m.month) }) : format.month(m.month)}: ${n(m.returningCustomers)}`,
                  )
                  .join("; ")}
                data={monthly.data.series.map((m) => ({
                  id: m.month,
                  label: format.month(m.month).split(" ")[0] ?? m.month,
                  value: m.returningCustomers,
                  display: n(m.returningCustomers),
                  provisional: m.partial,
                }))}
                showTableLabel={t("dashboard.showTable")}
                hideTableLabel={t("dashboard.hideTable")}
                table={
                  <Table label={t("dashboard.trendTitle")}>
                    <THead>
                      <TR>
                        <TH>{t("dashboard.colMonth")}</TH>
                        <TH>{t("dashboard.colReturning")}</TH>
                        <TH>{t("dashboard.colActive")}</TH>
                        <TH>{t("dashboard.colShare")}</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {monthly.data.series.map((m) => (
                        <TR key={m.month}>
                          <RowHeader>
                            {m.partial
                              ? t("dashboard.monthSoFar", { month: format.month(m.month) })
                              : format.month(m.month)}
                          </RowHeader>
                          <TD>{n(m.returningCustomers)}</TD>
                          <TD>{n(m.activeMembers)}</TD>
                          <TD>
                            {m.returningShare === null ? "—" : format.percent(m.returningShare)}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                }
              />
            ) : null}
          </DashboardSection>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <DashboardSection
              id="branches"
              title={t("dashboard.branchesTitle")}
              query={branches}
              empty={
                branches.data &&
                branches.data.items.every((b) => b.stamps === 0 && b.redemptions === 0) ? (
                  <EmptyState title={t("dashboard.branchesEmpty")} />
                ) : undefined
              }
            >
              {branches.data ? (
                <Table label={t("dashboard.branchesCaption")}>
                  <THead>
                    <TR>
                      <TH>{t("dashboard.colBranch")}</TH>
                      <TH>{t("dashboard.colStamps")}</TH>
                      <TH>{t("dashboard.colCustomers")}</TH>
                      <TH>{t("dashboard.colRedemptions")}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {branches.data.items.map((b) => {
                      const name = pickLocalized(locale, b.nameEn, b.nameAm);
                      return (
                        <TR key={b.branchId}>
                          <RowHeader lang={name.lang}>{name.text}</RowHeader>
                          <TD>{n(b.stamps)}</TD>
                          <TD>{n(b.uniqueCustomers)}</TD>
                          <TD>{n(b.redemptions)}</TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              ) : null}
            </DashboardSection>

            <DashboardSection
              id="wallet"
              title={t("dashboard.walletTitle")}
              query={wallet}
              empty={
                wallet.data && wallet.data.activeMemberships === 0 ? (
                  <EmptyState title={t("dashboard.walletEmpty")} />
                ) : undefined
              }
            >
              {wallet.data ? (
                <div className="flex flex-col gap-4">
                  <div>
                    <h3 className="font-semibold">{t("dashboard.walletAdoption")}</h3>
                    <ul className="mt-1 flex flex-col gap-1">
                      {wallet.data.providers.map((p) => (
                        <li key={p.provider} className="flex flex-wrap justify-between gap-2">
                          <span>{t(PROVIDER_LABEL[p.provider] ?? "dashboard.walletWeb")}</span>
                          <span className="font-medium tabular-nums">
                            {t("dashboard.walletOf", {
                              count: n(p.memberships),
                              total: n(wallet.data.activeMemberships),
                            })}
                            {p.adoptionRate !== null ? ` (${format.percent(p.adoptionRate)})` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="font-semibold">{t("dashboard.walletUpdates")}</h3>
                    <p
                      className="mt-1 text-2xl font-bold text-green-900 tabular-nums"
                      data-testid="wallet-rate"
                    >
                      {wallet.data.updates.successRate === null
                        ? "—"
                        : format.percent(wallet.data.updates.successRate)}
                    </p>
                    <p className="text-sm text-muted">
                      {wallet.data.updates.successRate === null
                        ? t("dashboard.walletRateNone")
                        : t("dashboard.walletRate")}
                    </p>
                    <ul className="mt-2 flex flex-col gap-0.5 text-charcoal-700">
                      <li>
                        {t("dashboard.walletSucceeded", {
                          count: n(wallet.data.updates.succeeded),
                        })}
                      </li>
                      <li>
                        {t("dashboard.walletFailed", { count: n(wallet.data.updates.failed) })}
                      </li>
                      <li>
                        {t("dashboard.walletQueued", { count: n(wallet.data.updates.stillQueued) })}
                      </li>
                      {wallet.data.updates.succeededAfterRetry > 0 ? (
                        <li>
                          {t("dashboard.walletRetried", {
                            count: n(wallet.data.updates.succeededAfterRetry),
                          })}
                        </li>
                      ) : null}
                    </ul>
                    {wallet.data.updates.failed > 0 ? (
                      <Alert tone="warning" className="mt-3">
                        {t("dashboard.walletFailedNote")}
                      </Alert>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </DashboardSection>
          </div>
        </>
      )}

      {canReadAudit ? (
        <DashboardSection
          id="events"
          title={t("dashboard.eventsTitle")}
          query={events}
          empty={
            events.data && events.data.items.length === 0 ? (
              <EmptyState title={t("dashboard.eventsEmpty")} />
            ) : undefined
          }
        >
          {events.data ? (
            <ol className="flex flex-col divide-y divide-border" data-testid="events-list">
              {events.data.items.map((event) => {
                const key = ACTION_LABEL[event.action];
                return (
                  <li
                    key={event.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
                  >
                    <span className="font-medium">
                      {key ? t(key) : t("dashboard.actionOther", { code: event.action })}
                    </span>
                    <span className="text-sm text-muted">
                      {event.actor.displayName ?? t("dashboard.actorSystem")}
                      {" · "}
                      <time dateTime={event.occurredAt}>{format.dateTime(event.occurredAt)}</time>
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </DashboardSection>
      ) : (
        <Alert tone="info">{t("dashboard.noAuditAccess")}</Alert>
      )}
    </div>
  );
}

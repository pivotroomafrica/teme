"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Alert,
  BarChart,
  Button,
  EmptyState,
  FormField,
  MetricCard,
  RowHeader,
  Select,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from "@/components/ui";
import { DateRangeControl } from "@/features/dashboard/components/date-range-control";
import { DashboardSection } from "@/features/dashboard/components/section";
import { paramsFor, rangeFromParams } from "@/features/dashboard/range";
import {
  useDefinitions,
  useOverview,
  useWalletHealth,
} from "@/features/dashboard/use-dashboard-data";
import { pickLocalized } from "@/features/enrollment/localized";
import { useI18n } from "@/lib/i18n/client";
import { createFormatter } from "@/lib/i18n/format";
import type { MessageKey } from "@/lib/i18n/translator";
import {
  useBranchPages,
  useCohorts,
  useMonthlyReturningSeries,
  useStaffPages,
} from "../use-analytics-data";

const MONTH_CHOICES = [6, 12, 24] as const;
const PROVIDER_LABEL: Record<string, MessageKey> = {
  APPLE: "dashboard.walletApple",
  GOOGLE: "dashboard.walletGoogle",
  WEB: "dashboard.walletWeb",
};
const ROLE_LABEL: Record<string, MessageKey> = {
  OWNER: "analytics.roleOwner",
  MANAGER: "analytics.roleManager",
  STAFF: "analytics.roleStaff",
};

/** Background strength for a retention cell. Only a visual bucket: the percentage itself is the backend's. */
const cellTone = (rate: number | null) =>
  rate === null
    ? ""
    : rate >= 0.6
      ? "bg-green-200"
      : rate >= 0.4
        ? "bg-green-100"
        : rate >= 0.2
          ? "bg-green-50"
          : "";

/**
 * Merchant analytics: the north-star metric first, then the supporting figures, branch and staff activity, retention
 * cohorts and wallet health. Every number is exactly what the backend computed from its published definitions; this
 * component chooses the dates and months to ask for, formats for the language and time zone, and lays things out.
 * It does not add up, average, compare or derive any metric, and it has no money figures: the backend has none.
 *
 * Each section loads and fails on its own, so one slow or failing part never hides the rest.
 */
export function AnalyticsWorkspace({
  timeZone,
  today,
  canReadAnalytics,
}: {
  timeZone: string;
  /** Today's date in the business time zone, decided on the server so the first render matches it. */
  today: string;
  canReadAnalytics: boolean;
}) {
  const { t, locale } = useI18n();
  const format = useMemo(() => createFormatter(locale, timeZone), [locale, timeZone]);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { range, preset } = rangeFromParams(params, today);
  const [months, setMonths] = useState<(typeof MONTH_CHOICES)[number]>(6);

  const overview = useOverview(range, canReadAnalytics);
  const monthly = useMonthlyReturningSeries(months, canReadAnalytics);
  const branches = useBranchPages(range, canReadAnalytics);
  const staff = useStaffPages(range, canReadAnalytics);
  const cohorts = useCohorts(6, canReadAnalytics);
  const wallet = useWalletHealth(range, canReadAnalytics);
  const definitions = useDefinitions(canReadAnalytics);

  const go = (query: string) => router.replace(`${pathname}${query}`, { scroll: false });
  const failed = [overview, monthly, branches, staff, cohorts, wallet].filter(
    (q) => q.isError,
  ).length;
  const n = (value: number) => format.integer(value);
  const pct = (value: number | null) => (value === null ? "—" : format.percent(value));
  const hours = (value: number | null) =>
    value === null
      ? "—"
      : t("analytics.hoursValue", { value: format.number(value, { maximumFractionDigits: 1 }) });

  if (!canReadAnalytics) return <Alert tone="info">{t("dashboard.noAnalyticsAccess")}</Alert>;

  const data = overview.data;
  const quiet =
    data !== undefined &&
    data.stampsIssued.count === 0 &&
    data.newMembers === 0 &&
    data.activeMembers === 0 &&
    data.rewardsUnlocked === 0 &&
    data.rewardsRedeemed === 0;

  const branchItems = branches.data?.pages.flatMap((p) => p.items) ?? [];
  const staffItems = staff.data?.pages.flatMap((p) => p.items) ?? [];
  const monthLabel = (m: { month: string; partial: boolean }) =>
    m.partial ? t("dashboard.monthSoFar", { month: format.month(m.month) }) : format.month(m.month);

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

      {failed > 0 ? (
        <Alert tone="warning" title={t("dashboard.partialTitle")}>
          {t("dashboard.partialBody")}
        </Alert>
      ) : null}
      {quiet ? <Alert tone="info">{t("analytics.emptyPeriod")}</Alert> : null}

      {/* The north star: one prominent number and its trend. Everything else is supporting detail. */}
      <section aria-labelledby="north-star-h" className="flex flex-col gap-4">
        <h2 id="north-star-h" className="sr-only">
          {t("analytics.northStarTitle")}
        </h2>
        <MetricCard
          emphasis
          label={t("dashboard.northStar")}
          loading={monthly.isPending}
          value={monthly.data ? n(monthly.data.value) : "—"}
          hint={
            monthly.data
              ? `${t("dashboard.northStarHint", { month: format.month(monthly.data.month) })}${
                  monthly.data.series.at(-1)?.partial
                    ? ` ${t("dashboard.northStarPartial", { month: format.month(monthly.data.month) })}`
                    : ""
                }`
              : t("analytics.northStarWhy")
          }
        />
        <DashboardSection
          id="trend"
          title={t("dashboard.trendTitle")}
          query={monthly}
          empty={
            monthly.data && monthly.data.series.every((m) => m.returningCustomers === 0) ? (
              <EmptyState title={t("analytics.trendNone")} />
            ) : undefined
          }
        >
          <div className="mb-3 max-w-xs">
            <FormField label={t("analytics.monthsLabel")}>
              <Select
                value={String(months)}
                onChange={(event) => setMonths(Number(event.target.value) as typeof months)}
              >
                {MONTH_CHOICES.map((count) => (
                  <option key={count} value={count}>
                    {t("analytics.monthsOption", { count })}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          {monthly.data ? (
            <BarChart
              label={t("dashboard.trendChart")}
              summary={t("analytics.chartSummary", {
                label: t("dashboard.trendChart"),
                values: monthly.data.series
                  .map((m) => `${monthLabel(m)}: ${n(m.returningCustomers)}`)
                  .join("; "),
              })}
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
                        <RowHeader>{monthLabel(m)}</RowHeader>
                        <TD>{n(m.returningCustomers)}</TD>
                        <TD>{n(m.activeMembers)}</TD>
                        <TD>{pct(m.returningShare)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              }
            />
          ) : null}
        </DashboardSection>
      </section>

      <DashboardSection id="headline" title={t("analytics.headlineTitle")} query={overview}>
        {data ? (
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label={t("dashboard.newMembers")} value={n(data.newMembers)} />
              <MetricCard label={t("dashboard.activeMembers")} value={n(data.activeMembers)} />
              <MetricCard
                label={t("dashboard.stampsIssued")}
                value={n(data.stampsIssued.count)}
                hint={
                  data.stampsIssued.reversed > 0
                    ? t("dashboard.stampsReversed", { count: n(data.stampsIssued.reversed) })
                    : undefined
                }
              />
              <MetricCard label={t("dashboard.rewardsUnlocked")} value={n(data.rewardsUnlocked)} />
              <MetricCard label={t("dashboard.rewardsRedeemed")} value={n(data.rewardsRedeemed)} />
              <MetricCard
                label={t("dashboard.redemptionRate")}
                value={pct(data.redemptionRate)}
                hint={data.redemptionRate === null ? t("dashboard.redemptionRateNone") : undefined}
              />
              <MetricCard
                label={t("analytics.avgVisits")}
                value={
                  data.averageVisitsPerActiveMember === null
                    ? "—"
                    : format.number(data.averageVisitsPerActiveMember, { maximumFractionDigits: 2 })
                }
                hint={
                  data.averageVisitsPerActiveMember === null
                    ? t("analytics.avgVisitsNone")
                    : t("analytics.avgVisitsHint")
                }
              />
            </div>

            <div className="rounded-card border border-border p-4" data-testid="time-between">
              <h3 className="font-semibold text-green-900">{t("analytics.timeBetweenTitle")}</h3>
              <p className="text-sm text-muted">{t("analytics.timeBetweenIntro")}</p>
              {data.timeBetweenVisits.intervals === 0 ? (
                <p className="mt-2">{t("analytics.timeNone")}</p>
              ) : (
                <>
                  <dl className="mt-2 grid gap-2 sm:grid-cols-3">
                    <div>
                      <dt className="text-sm text-muted">{t("analytics.timeAverage")}</dt>
                      <dd className="text-xl font-bold tabular-nums">
                        {hours(data.timeBetweenVisits.averageHours)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted">{t("analytics.timeMedian")}</dt>
                      <dd className="text-xl font-bold tabular-nums">
                        {hours(data.timeBetweenVisits.medianHours)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted">{t("analytics.timeP90")}</dt>
                      <dd className="text-xl font-bold tabular-nums">
                        {hours(data.timeBetweenVisits.p90Hours)}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-sm text-muted">
                    {t("analytics.timeIntervals", { count: n(data.timeBetweenVisits.intervals) })}
                  </p>
                </>
              )}
            </div>
          </div>
        ) : null}
      </DashboardSection>

      <DashboardSection
        id="branches"
        title={t("analytics.branchTitle")}
        query={branches}
        empty={
          branches.data && branchItems.every((b) => b.stamps === 0 && b.redemptions === 0) ? (
            <EmptyState title={t("analytics.branchEmpty")} />
          ) : undefined
        }
      >
        {branches.data ? (
          <div className="flex flex-col gap-4">
            <BarChart
              label={t("analytics.branchChart")}
              summary={t("analytics.chartSummary", {
                label: t("analytics.branchChart"),
                values: branchItems
                  .map((b) => `${pickLocalized(locale, b.nameEn, b.nameAm).text}: ${n(b.stamps)}`)
                  .join("; "),
              })}
              data={branchItems.map((b) => ({
                id: b.branchId,
                label: pickLocalized(locale, b.nameEn, b.nameAm).text,
                value: b.stamps,
                display: n(b.stamps),
              }))}
              showTableLabel={t("dashboard.showTable")}
              hideTableLabel={t("dashboard.hideTable")}
              table={
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
                    {branchItems.map((b) => {
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
              }
            />
            {branches.hasNextPage ? (
              <Button
                variant="secondary"
                onClick={() => void branches.fetchNextPage()}
                loading={branches.isFetchingNextPage}
              >
                {t("analytics.showMore")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </DashboardSection>

      <DashboardSection
        id="staff"
        title={t("analytics.staffTitle")}
        query={staff}
        empty={
          staff.data && staffItems.every((s) => s.stamps === 0 && s.redemptions === 0) ? (
            <EmptyState title={t("analytics.staffEmpty")} />
          ) : undefined
        }
      >
        <p className="mb-3 text-sm text-muted">{t("analytics.staffIntro")}</p>
        <div className="flex flex-col gap-3">
          <Table label={t("analytics.staffTableLabel")}>
            <THead>
              <TR>
                <TH>{t("analytics.colStaff")}</TH>
                <TH>{t("analytics.colRole")}</TH>
                <TH>{t("dashboard.colStamps")}</TH>
                <TH>{t("analytics.colReversed")}</TH>
                <TH>{t("analytics.colReversalRate")}</TH>
                <TH>{t("dashboard.colCustomers")}</TH>
                <TH>{t("dashboard.colRedemptions")}</TH>
              </TR>
            </THead>
            <TBody>
              {staffItems.map((s) => (
                <TR key={s.staffId}>
                  <RowHeader>
                    {s.displayName}
                    {s.status === "DEACTIVATED" ? ` (${t("analytics.staffDeactivated")})` : ""}
                  </RowHeader>
                  <TD>{ROLE_LABEL[s.role] ? t(ROLE_LABEL[s.role]!) : s.role}</TD>
                  <TD>{n(s.stamps)}</TD>
                  <TD>{n(s.stampsReversed)}</TD>
                  <TD>{pct(s.reversalRate)}</TD>
                  <TD>{n(s.uniqueCustomers)}</TD>
                  <TD>{n(s.redemptions)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {staff.hasNextPage ? (
            <Button
              variant="secondary"
              onClick={() => void staff.fetchNextPage()}
              loading={staff.isFetchingNextPage}
            >
              {t("analytics.showMore")}
            </Button>
          ) : null}
        </div>
      </DashboardSection>

      <DashboardSection
        id="cohorts"
        title={t("analytics.cohortsTitle")}
        query={cohorts}
        empty={
          cohorts.data && cohorts.data.cohorts.every((c) => c.size === 0) ? (
            <EmptyState title={t("analytics.cohortsEmpty")} />
          ) : undefined
        }
      >
        {cohorts.data ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">{t("analytics.cohortsIntro")}</p>
            <Table label={t("analytics.cohortsTableLabel")}>
              <THead>
                <TR>
                  <TH>{t("analytics.colJoinedMonth")}</TH>
                  <TH>{t("analytics.colSize")}</TH>
                  {Array.from(
                    { length: Math.max(...cohorts.data.cohorts.map((c) => c.retention.length)) },
                    (_, k) => (
                      <TH key={k}>{t("analytics.monthN", { n: k })}</TH>
                    ),
                  )}
                </TR>
              </THead>
              <TBody>
                {cohorts.data.cohorts.map((c) => (
                  <TR key={c.cohortMonth}>
                    <RowHeader>{format.month(c.cohortMonth)}</RowHeader>
                    <TD>{n(c.size)}</TD>
                    {c.retention.map((cell) => (
                      <TD
                        key={cell.monthOffset}
                        className={cellTone(cell.rate)}
                        title={
                          cell.rate === null
                            ? undefined
                            : t("analytics.cohortCell", {
                                rate: pct(cell.rate),
                                size: n(c.size),
                                n: cell.monthOffset,
                              })
                        }
                      >
                        {pct(cell.rate)}
                      </TD>
                    ))}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        ) : null}
      </DashboardSection>

      <DashboardSection
        id="wallet"
        title={t("analytics.walletTitle")}
        query={wallet}
        empty={
          wallet.data && wallet.data.activeMemberships === 0 ? (
            <EmptyState title={t("analytics.walletNone")} />
          ) : undefined
        }
      >
        {wallet.data ? (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted">
                {t("analytics.walletAdoptionNote")} {t("analytics.asOfSnapshot")}
              </p>
              <BarChart
                label={t("analytics.walletChart")}
                summary={t("analytics.chartSummary", {
                  label: t("analytics.walletChart"),
                  values: wallet.data.providers
                    .map(
                      (p) =>
                        `${t(PROVIDER_LABEL[p.provider] ?? "dashboard.walletWeb")}: ${n(p.memberships)} (${pct(p.adoptionRate)})`,
                    )
                    .join("; "),
                })}
                data={wallet.data.providers.map((p) => ({
                  id: p.provider,
                  label: t(PROVIDER_LABEL[p.provider] ?? "dashboard.walletWeb"),
                  value: p.memberships,
                  display: pct(p.adoptionRate),
                }))}
                showTableLabel={t("dashboard.showTable")}
                hideTableLabel={t("dashboard.hideTable")}
                table={
                  <Table label={t("analytics.walletChart")}>
                    <THead>
                      <TR>
                        <TH>{t("dashboard.walletAdoption")}</TH>
                        <TH>{t("analytics.colCards")}</TH>
                        <TH>{t("analytics.colCardShare")}</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {wallet.data.providers.map((p) => (
                        <TR key={p.provider}>
                          <RowHeader>
                            {t(PROVIDER_LABEL[p.provider] ?? "dashboard.walletWeb")}
                          </RowHeader>
                          <TD>
                            {t("analytics.percentOfTotal", {
                              count: n(p.memberships),
                              total: n(wallet.data.activeMemberships),
                            })}
                          </TD>
                          <TD>{pct(p.adoptionRate)}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                }
              />
            </div>

            <div>
              <h3 className="font-semibold text-green-900">{t("analytics.walletUpdatesTitle")}</h3>
              <p
                className="mt-1 text-2xl font-bold text-green-900 tabular-nums"
                data-testid="wallet-rate"
              >
                {pct(wallet.data.updates.successRate)}
              </p>
              <p className="text-sm text-muted">
                {wallet.data.updates.successRate === null
                  ? t("dashboard.walletRateNone")
                  : t("dashboard.walletRate")}
              </p>
              <ul className="mt-2 flex flex-col gap-0.5 text-charcoal-700">
                <li>
                  {t("dashboard.walletSucceeded", { count: n(wallet.data.updates.succeeded) })}
                </li>
                <li>{t("dashboard.walletFailed", { count: n(wallet.data.updates.failed) })}</li>
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

      <p className="text-sm text-muted">
        {t("analytics.noMoney")} {t("analytics.noExport")}
      </p>
    </div>
  );
}

/**
 * The meaning of every number the analytics API returns. Served by GET /merchant/analytics/definitions and
 * mirrored in docs/analytics.md, so dashboards can show the same wording the API computes with.
 */
export const METRIC_DEFINITIONS = [
  {
    key: 'qualifyingVisit',
    name: 'Qualifying visit',
    definition:
      'One stamp that has not been reversed (as of now). Redemptions are not visits. A stamp reversed later stops counting in every period, including past ones.',
  },
  {
    key: 'newMembers',
    name: 'New members',
    definition:
      'Memberships (a customer joining a program) whose join time falls in the range. Deactivated and anonymized memberships still count in the period they joined.',
  },
  {
    key: 'activeMembers',
    name: 'Active members',
    definition:
      'Unique customers with at least one qualifying visit in the range. A customer in two programs counts once.',
  },
  {
    key: 'returningCustomers',
    name: 'Returning loyalty customers',
    definition:
      'Active members in the range who also had at least one qualifying visit before the range started.',
  },
  {
    key: 'monthlyReturningLoyaltyCustomers',
    name: 'Monthly Returning Loyalty Customers (north-star)',
    definition:
      'Unique loyalty customers with a qualifying visit during the selected calendar month (merchant time zone) who also had at least one qualifying visit before that month began.',
  },
  {
    key: 'stampsIssued',
    name: 'Stamps issued',
    definition:
      'Qualifying visits in the range. `reversed` counts stamps given in the range that were later reversed.',
  },
  {
    key: 'rewardsUnlocked',
    name: 'Rewards unlocked',
    definition:
      'Rewards earned in the range, not counting those whose triggering stamp was reversed.',
  },
  {
    key: 'rewardsRedeemed',
    name: 'Rewards redeemed',
    definition: 'Redemptions made in the range that were not reversed.',
  },
  {
    key: 'redemptionRate',
    name: 'Redemption rate',
    definition:
      'Rewards redeemed in the range divided by rewards unlocked in the range. A period ratio: it can exceed 1 when rewards earned earlier are redeemed now. Null when nothing was unlocked.',
  },
  {
    key: 'averageVisitsPerActiveMember',
    name: 'Average visits per active member',
    definition: 'Stamps issued divided by active members. Null when there are no active members.',
  },
  {
    key: 'timeBetweenVisits',
    name: 'Time between visits',
    definition:
      'For every qualifying visit in the range that is not the first on its card, the hours since the previous qualifying visit on the same card (the previous visit may be before the range). Reported as average, median and 90th percentile.',
  },
  {
    key: 'branchActivity',
    name: 'Branch activity',
    definition:
      'Per branch: qualifying visits, unique customers and non-reversed redemptions in the range.',
  },
  {
    key: 'staffActivity',
    name: 'Staff stamping activity',
    definition:
      'Per staff member: qualifying visits, stamps later reversed, unique customers and non-reversed redemptions handled in the range.',
  },
  {
    key: 'retentionCohorts',
    name: 'Program retention cohorts',
    definition:
      'Memberships grouped by the calendar month they joined (merchant time zone). Retention at month k is the share of the cohort with at least one qualifying visit in the calendar month k months after joining (month 0 is the joining month).',
  },
  {
    key: 'walletAdoption',
    name: 'Wallet provider adoption',
    definition:
      'A snapshot of active memberships that currently hold an active pass from each provider, divided by all active memberships. Every card has a web pass, so WEB is expected to be close to 100%.',
  },
  {
    key: 'walletUpdateSuccess',
    name: 'Wallet update success rate',
    definition:
      'Of wallet pass-update jobs created in the range that have finished, the share that succeeded (the rest exhausted their retries). Jobs still queued or retrying are reported separately and are not part of the rate.',
  },
] as const;

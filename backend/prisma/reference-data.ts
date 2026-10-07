/**
 * Reference data required in EVERY environment (roles and permissions).
 * Seeded idempotently; the authentication step extends the permission catalog.
 */
export const PERMISSIONS: Record<string, string> = {
  'platform:manage': 'Manage merchants and platform administration',
  'platform:audit:read': 'Read audit history across tenants (explicit grant)',
  'merchant:read': 'View business profile',
  'merchant:update': 'Update business profile and settings',
  'branch:read': 'View branches',
  'branch:manage': 'Create, update and deactivate branches',
  'staff:read': 'View staff and staff activity',
  'staff:manage': 'Invite, update, assign and deactivate staff',
  'program:read': 'View loyalty programs',
  'program:manage': 'Create and update loyalty programs',
  'customer:read': 'Search and view customers',
  'customer:manage': 'Update customer records and consent',
  'stamp:create': 'Validate scans and issue stamps',
  'redemption:create': 'Redeem rewards',
  'reversal:create': 'Reverse stamps and redemptions',
  'audit:read': 'View the merchant audit history',
  'analytics:read': 'View loyalty analytics',
  'privacy:manage': 'View, export and anonymize customer data; set retention periods',
  'fraud:read': 'View fraud indicators and flags',
  'fraud:manage': 'Review fraud flags and change fraud thresholds',
};

const all = Object.keys(PERMISSIONS);
const merchantPermissions = all.filter((p) => !p.startsWith('platform:'));

export const ROLES: Array<{
  key: string;
  name: string;
  scope: 'PLATFORM' | 'MERCHANT';
  description: string;
  permissions: string[];
}> = [
  {
    key: 'PLATFORM_ADMIN',
    name: 'Platform administrator',
    scope: 'PLATFORM',
    description: 'TemelashCard operator. Has no implicit access to tenant data.',
    permissions: ['platform:manage', 'platform:audit:read'],
  },
  {
    key: 'OWNER',
    name: 'Merchant owner',
    scope: 'MERCHANT',
    description: 'Full control of one merchant.',
    permissions: merchantPermissions,
  },
  {
    key: 'MANAGER',
    name: 'Merchant manager',
    scope: 'MERCHANT',
    description:
      'Runs day-to-day operations; cannot manage privacy operations or fraud thresholds.',
    permissions: merchantPermissions.filter((p) => p !== 'privacy:manage' && p !== 'fraud:manage'),
  },
  {
    key: 'STAFF',
    name: 'Branch staff',
    scope: 'MERCHANT',
    description: 'Scans cards and redeems rewards at assigned branches.',
    permissions: [
      'branch:read',
      'program:read',
      'customer:read',
      'stamp:create',
      'redemption:create',
    ],
  },
];

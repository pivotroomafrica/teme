import { buildCustomerExport, EXPORT_EVENT_CAP, RawCustomerData } from './customer-export';
import {
  DEFAULT_RETENTION,
  inactivityCutoff,
  isValidInactiveMonths,
  mergeRetention,
} from './retention-policy';

describe('retention policy', () => {
  it('defaults to 36 months and ignores bad stored values', () => {
    expect(mergeRetention(undefined)).toEqual(DEFAULT_RETENTION);
    for (const bad of [
      { inactiveCustomerMonths: 3 },
      { inactiveCustomerMonths: 121 },
      { inactiveCustomerMonths: 'x' },
      { inactiveCustomerMonths: 12.5 },
      [],
      'x',
    ]) {
      expect(mergeRetention(bad)).toEqual(DEFAULT_RETENTION);
    }
  });

  it('accepts never (0) and 6 to 120 months', () => {
    expect(mergeRetention({ inactiveCustomerMonths: 0 })).toEqual({ inactiveCustomerMonths: 0 });
    expect(mergeRetention({ inactiveCustomerMonths: 6 })).toEqual({ inactiveCustomerMonths: 6 });
    expect(mergeRetention({ inactiveCustomerMonths: 120 })).toEqual({
      inactiveCustomerMonths: 120,
    });
    expect([0, 6, 36, 120].every(isValidInactiveMonths)).toBe(true);
    expect([1, 5, 121, -1, 1.5, null, undefined].some(isValidInactiveMonths)).toBe(false);
  });

  it('computes the inactivity cutoff in whole calendar months, or none when retention is off', () => {
    const now = new Date('2026-10-09T10:00:00.000Z');
    expect(inactivityCutoff({ inactiveCustomerMonths: 36 }, now)?.toISOString()).toBe(
      '2023-10-09T10:00:00.000Z',
    );
    expect(inactivityCutoff({ inactiveCustomerMonths: 6 }, now)?.toISOString()).toBe(
      '2026-04-09T10:00:00.000Z',
    );
    expect(inactivityCutoff({ inactiveCustomerMonths: 0 }, now)).toBeNull();
  });
});

describe('buildCustomerExport', () => {
  const when = new Date('2026-05-01T12:00:00.000Z');
  const data: RawCustomerData = {
    merchantName: 'Sample Cafe',
    customer: {
      id: 'c1',
      firstName: 'Abebe',
      phoneE164: '+251911000101',
      preferredLanguage: 'AM',
      status: 'ACTIVE',
      createdAt: when,
      anonymizedAt: null,
    },
    consents: [
      {
        type: 'MARKETING',
        action: 'GRANTED',
        version: 'v1',
        source: 'JOIN_FORM',
        occurredAt: when,
      },
    ],
    memberships: [
      {
        id: 'm1',
        status: 'ACTIVE',
        joinedAt: when,
        deactivatedAt: null,
        program: { nameEn: 'Coffee Card', nameAm: 'የቡና ካርድ' },
        walletPasses: [{ provider: 'GOOGLE', status: 'ACTIVE', createdAt: when }],
        stamps: [{ id: 's1', occurredAt: when, branchName: 'Bole', reversed: true }],
        redemptions: [],
        reversals: [{ occurredAt: when, targetType: 'STAMP', reason: 'Scanned twice' }],
        rewardUnlocks: [{ unlockedAt: when, expiresAt: null }],
      },
    ],
  };

  it('contains the customer’s own data in a portable, versioned shape', () => {
    const out = buildCustomerExport(data, when);
    expect(out).toMatchObject({
      schemaVersion: 1,
      exportedAt: '2026-05-01T12:00:00.000Z',
      merchant: { name: 'Sample Cafe' },
      customer: { firstName: 'Abebe', phone: '+251911000101', preferredLanguage: 'AM' },
      consents: [{ type: 'MARKETING', action: 'GRANTED', occurredAt: '2026-05-01T12:00:00.000Z' }],
    });
    expect(out.memberships[0]).toMatchObject({
      program: { nameAm: 'የቡና ካርድ' },
      stamps: [{ id: 's1', branchName: 'Bole', reversed: true }],
      reversals: [{ reason: 'Scanned twice' }],
      truncated: false,
    });
  });

  it('never includes staff identities, secrets or tenant internals', () => {
    const text = JSON.stringify(buildCustomerExport(data, when));
    expect(text).not.toMatch(
      /staff|tokenHash|token_hash|barcode|pushToken|merchantId|passwordHash/i,
    );
  });

  it('flags a truncated history', () => {
    const big = {
      ...data,
      memberships: [
        {
          ...data.memberships[0]!,
          stamps: Array.from({ length: EXPORT_EVENT_CAP }, (_, i) => ({
            id: `s${i}`,
            occurredAt: when,
            branchName: 'B',
            reversed: false,
          })),
        },
      ],
    };
    expect(buildCustomerExport(big, when).memberships[0]?.truncated).toBe(true);
  });
});

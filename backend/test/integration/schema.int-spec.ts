import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { runSeed } from '../../prisma/seed-lib';
import { addStamp, addUnlock, createTenant, Tenant } from '../support/tenant-fixture';

describe('Database schema invariants (integration, requires PostgreSQL)', () => {
  const prisma = new PrismaClient();
  let a: Tenant;
  let b: Tenant;

  beforeAll(async () => {
    a = await createTenant(prisma);
    b = await createTenant(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('structure', () => {
    it('has the indexes the analytics queries rely on', async () => {
      const rows = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`;
      const names = rows.map((r) => r.indexname);
      expect(names).toEqual(
        expect.arrayContaining([
          'stamp_events_merchant_id_occurred_at_idx',
          'stamp_events_merchant_id_membership_id_occurred_at_idx',
          'stamp_events_merchant_id_branch_id_occurred_at_idx',
          'stamp_events_merchant_id_staff_membership_id_occurred_at_idx',
          'redemption_events_merchant_id_occurred_at_idx',
          'reversal_events_stamp_event_id_key',
          'reversal_events_redemption_event_id_key',
          'customer_memberships_merchant_id_joined_at_idx',
          'reward_unlocks_merchant_id_unlocked_at_idx',
          'outbox_jobs_merchant_id_type_created_at_idx',
        ]),
      );
    });

    it('stores every timestamp as timestamptz and every id as uuid', async () => {
      const naive = await prisma.$queryRaw<{ t: string; c: string }[]>`
        SELECT table_name AS t, column_name AS c FROM information_schema.columns
        WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'`;
      expect(naive).toEqual([]);
      const badIds = await prisma.$queryRaw<{ t: string }[]>`
        SELECT table_name AS t FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'id'
          AND data_type <> 'uuid' AND table_name <> '_prisma_migrations'`;
      expect(badIds).toEqual([]);
    });

    it('stores no payment, revenue, order-value or billing data', async () => {
      const cols = await prisma.$queryRaw<{ c: string }[]>`
        SELECT table_name || '.' || column_name AS c FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name ~* '(amount|price|revenue|payment|invoice|billing|currency|order_value|total_spent|subscription|card_number)'`;
      expect(cols).toEqual([]);
    });

    it('has merchant_id on every merchant-owned table', async () => {
      const owned = [
        'branches',
        'staff_memberships',
        'staff_branch_assignments',
        'customers',
        'customer_consents',
        'loyalty_programs',
        'reward_definitions',
        'customer_memberships',
        'wallet_passes',
        'stamp_events',
        'reward_unlocks',
        'redemption_events',
        'reversal_events',
        'idempotency_records',
        'merchant_settings',
      ];
      const rows = await prisma.$queryRaw<{ t: string }[]>`
        SELECT table_name AS t FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'merchant_id'`;
      const have = new Set(rows.map((r) => r.t));
      expect(owned.filter((t) => !have.has(t))).toEqual([]);
    });
  });

  describe('seed', () => {
    it('is idempotent and produces the documented development data', async () => {
      await runSeed(prisma, { password: 'seed-test-password-1' });
      await runSeed(prisma, { password: 'seed-test-password-1' });

      expect(
        await prisma.platformUser.count({
          where: { email: 'admin@temelashcard.test', accountType: 'PLATFORM_ADMIN' },
        }),
      ).toBe(1);
      const merchant = await prisma.merchant.findUniqueOrThrow({ where: { slug: 'sample-cafe' } });
      expect(await prisma.branch.count({ where: { merchantId: merchant.id } })).toBe(2);
      const staff = await prisma.staffMembership.findMany({
        where: { merchantId: merchant.id },
        include: { role: true },
      });
      expect(staff.map((s) => s.role.key).sort()).toEqual(['OWNER', 'STAFF', 'STAFF']);
      expect(
        await prisma.loyaltyProgram.count({ where: { merchantId: merchant.id, status: 'ACTIVE' } }),
      ).toBe(1);
      expect(await prisma.customer.count({ where: { merchantId: merchant.id } })).toBe(2);
      expect(await prisma.customerMembership.count({ where: { merchantId: merchant.id } })).toBe(2);
    });

    it('stores only password hashes and token hashes', async () => {
      const user = await prisma.platformUser.findUniqueOrThrow({
        where: { email: 'admin@temelashcard.test' },
      });
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      const m = await prisma.customerMembership.findFirstOrThrow({
        where: { customer: { phoneE164: '+251911000101' } },
      });
      expect(m.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('tenant isolation', () => {
    it("rejects a stamp that mixes tenant A's membership with tenant B's branch", async () => {
      await expect(
        prisma.stampEvent.create({
          data: {
            merchantId: a.merchantId,
            branchId: b.branchId,
            programId: a.programId,
            membershipId: a.membershipId,
            staffMembershipId: a.staffId,
            idempotencyKey: randomUUID(),
          },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it("rejects a stamp that claims tenant B's merchant id for tenant A's membership", async () => {
      await expect(
        prisma.stampEvent.create({
          data: {
            merchantId: b.merchantId,
            branchId: b.branchId,
            programId: a.programId,
            membershipId: a.membershipId,
            staffMembershipId: b.staffId,
            idempotencyKey: randomUUID(),
          },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('rejects a membership linking a customer and program from different merchants', async () => {
      await expect(
        prisma.customerMembership.create({
          data: {
            merchantId: a.merchantId,
            customerId: b.customerId,
            programId: a.programId,
            tokenHash: `h-${randomUUID()}`,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('allows the same phone number at two merchants but not twice at one', async () => {
      const other = await prisma.customer.findFirstOrThrow({ where: { merchantId: b.merchantId } });
      expect(other.phoneE164).toBe('+251911555000'); // same number as tenant A's customer
      await expect(
        prisma.customer.create({
          data: { merchantId: a.merchantId, phoneE164: '+251911555000' },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  describe('data rules', () => {
    it('enforces E.164 Ethiopian phone numbers', async () => {
      for (const phone of ['0911234567', '+254911234567', '+25191123']) {
        await expect(
          prisma.customer.create({ data: { merchantId: a.merchantId, phoneE164: phone } }),
        ).rejects.toThrow(/customers_phone_e164/);
      }
    });

    it('allows only one default ACTIVE program per merchant', async () => {
      await expect(
        prisma.loyaltyProgram.create({
          data: {
            merchantId: a.merchantId,
            nameEn: 'Second default',
            stampsRequired: 5,
            status: 'ACTIVE',
            isDefault: true,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      // A paused or non-default program is fine.
      await prisma.loyaltyProgram.create({
        data: { merchantId: a.merchantId, nameEn: 'Draft', stampsRequired: 5 },
      });
    });

    it('rejects invalid program settings', async () => {
      await expect(
        prisma.loyaltyProgram.create({
          data: { merchantId: a.merchantId, nameEn: 'Bad', stampsRequired: 0 },
        }),
      ).rejects.toThrow(/loyalty_programs_stamps_required/);
      await expect(
        prisma.loyaltyProgram.create({
          data: { merchantId: a.merchantId, nameEn: 'Bad', stampsRequired: 5, cooldownMinutes: -1 },
        }),
      ).rejects.toThrow(/loyalty_programs_cooldown/);
    });

    it('keeps one membership per customer and program', async () => {
      await expect(
        prisma.customerMembership.create({
          data: {
            merchantId: a.merchantId,
            customerId: a.customerId,
            programId: a.programId,
            tokenHash: `h-${randomUUID()}`,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('allows one wallet pass per membership and provider, including web fallback', async () => {
      for (const provider of ['APPLE', 'GOOGLE', 'WEB'] as const) {
        await prisma.walletPass.create({
          data: { merchantId: a.merchantId, membershipId: a.membershipId, provider },
        });
      }
      await expect(
        prisma.walletPass.create({
          data: { merchantId: a.merchantId, membershipId: a.membershipId, provider: 'WEB' },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('lets an invalidated pass be replaced but never keeps two live passes per provider', async () => {
      const first = await prisma.walletPass.findFirstOrThrow({
        where: { membershipId: a.membershipId, provider: 'APPLE' },
      });
      await prisma.walletPass.update({ where: { id: first.id }, data: { status: 'INVALIDATED' } });
      const replacement = await prisma.walletPass.create({
        data: { merchantId: a.merchantId, membershipId: a.membershipId, provider: 'APPLE' },
      });
      expect(replacement.id).not.toBe(first.id);
      await expect(
        prisma.walletPass.create({
          data: { merchantId: a.merchantId, membershipId: a.membershipId, provider: 'APPLE' },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      // History is preserved: the invalidated row is still there.
      expect(
        await prisma.walletPass.count({ where: { id: first.id, status: 'INVALIDATED' } }),
      ).toBe(1);
    });

    it('keeps wallet barcodes unique and tied to their own merchant graph', async () => {
      const hash = randomUUID().replace(/-/g, '').repeat(2);
      const pass = await prisma.walletPass.create({
        data: {
          merchantId: b.merchantId,
          membershipId: b.membershipId,
          provider: 'GOOGLE',
          barcodeHash: hash,
        },
      });
      await expect(
        prisma.walletPass.create({
          data: {
            merchantId: b.merchantId,
            membershipId: b.membershipId,
            provider: 'WEB',
            barcodeHash: hash,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      // A registration cannot point at another tenant's pass.
      await expect(
        prisma.appleDeviceRegistration.create({
          data: {
            merchantId: a.merchantId,
            walletPassId: pass.id,
            deviceLibraryIdentifier: 'd',
            pushToken: 't',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('does not let a platform administrator or platform role hold a staff membership', async () => {
      const admin = await prisma.platformUser.findUniqueOrThrow({
        where: { email: 'admin@temelashcard.test' },
      });
      const staffRole = await prisma.role.findUniqueOrThrow({ where: { key: 'STAFF' } });
      const platformRole = await prisma.role.findUniqueOrThrow({
        where: { key: 'PLATFORM_ADMIN' },
      });
      await expect(
        prisma.staffMembership.create({
          data: { merchantId: a.merchantId, userId: admin.id, roleId: staffRole.id },
        }),
      ).rejects.toThrow(/MERCHANT_USER/);
      const user = await prisma.platformUser.findUniqueOrThrow({ where: { id: a.userId } });
      await expect(
        prisma.staffMembership.create({
          data: { merchantId: b.merchantId, userId: user.id, roleId: platformRole.id },
        }),
      ).rejects.toThrow(/MERCHANT-scoped/);
    });

    it('preserves history: foreign keys never cascade or allow deletes of referenced rows', async () => {
      await addStamp(prisma, a);
      await expect(prisma.branch.delete({ where: { id: a.branchId } })).rejects.toThrow(
        /violates RESTRICT/,
      );
      await expect(prisma.staffMembership.delete({ where: { id: a.staffId } })).rejects.toThrow(
        /violates RESTRICT/,
      );
    });
  });

  describe('append-only ledger', () => {
    it('rejects UPDATE and DELETE on stamp events', async () => {
      const stamp = await addStamp(prisma, a);
      await expect(
        prisma.stampEvent.update({ where: { id: stamp.id }, data: { occurredAt: new Date() } }),
      ).rejects.toThrow(/append-only/);
      await expect(prisma.stampEvent.delete({ where: { id: stamp.id } })).rejects.toThrow(
        /append-only/,
      );
      await expect(prisma.$executeRaw`TRUNCATE stamp_events CASCADE`).rejects.toThrow(
        /append-only/,
      );
    });

    it('rejects mutation of audit events and consent history', async () => {
      const audit = await prisma.auditEvent.create({
        data: { merchantId: a.merchantId, actorType: 'SYSTEM', action: 'test.event' },
      });
      await expect(
        prisma.auditEvent.update({ where: { id: audit.id }, data: { action: 'tampered' } }),
      ).rejects.toThrow(/append-only/);
      await expect(prisma.auditEvent.delete({ where: { id: audit.id } })).rejects.toThrow(
        /append-only/,
      );
      const created = await prisma.customerConsent.create({
        data: {
          merchantId: a.merchantId,
          customerId: a.customerId,
          type: 'MARKETING',
          action: 'GRANTED',
          version: 'v1',
          source: 'JOIN_FORM',
        },
      });
      await expect(
        prisma.customerConsent.update({ where: { id: created.id }, data: { version: 'v2' } }),
      ).rejects.toThrow(/append-only/);
    });
  });

  describe('rewards, redemptions and reversals', () => {
    it('lets exactly one of two concurrent redemptions of the same unlock succeed', async () => {
      const stamp = await addStamp(prisma, a);
      const unlock = await addUnlock(prisma, a, stamp.id);
      const redeem = () =>
        prisma.redemptionEvent.create({
          data: {
            merchantId: a.merchantId,
            branchId: a.branchId,
            membershipId: a.membershipId,
            rewardUnlockId: unlock.id,
            staffMembershipId: a.staffId,
            attemptNumber: 1,
            idempotencyKey: randomUUID(),
          },
        });
      const results = await Promise.allSettled([redeem(), redeem()]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(failed.reason).toMatchObject({ code: 'P2002' });
    });

    it('rejects an unlock whose stamp belongs to another membership', async () => {
      const otherCustomer = await prisma.customer.create({
        data: { merchantId: a.merchantId, phoneE164: '+251911555001' },
      });
      const other = await prisma.customerMembership.create({
        data: {
          merchantId: a.merchantId,
          customerId: otherCustomer.id,
          programId: a.programId,
          tokenHash: `h-${randomUUID()}`,
        },
      });
      const stamp = await addStamp(prisma, a);
      await expect(
        prisma.rewardUnlock.create({
          data: {
            merchantId: a.merchantId,
            programId: a.programId,
            membershipId: other.id,
            rewardDefinitionId: a.rewardDefinitionId,
            triggeringStampId: stamp.id,
          },
        }),
      ).rejects.toThrow(/does not belong to the membership/);
    });

    it('requires a reason and exactly one target on reversals, and reverses each event once', async () => {
      const stamp = await addStamp(prisma, a);
      const base = {
        merchantId: a.merchantId,
        membershipId: a.membershipId,
        reversedByStaffId: a.staffId,
      };
      await expect(
        prisma.reversalEvent.create({
          data: {
            ...base,
            targetType: 'STAMP',
            stampEventId: stamp.id,
            reason: ' ',
            idempotencyKey: randomUUID(),
          },
        }),
      ).rejects.toThrow(/reversal_events_reason_required/);
      await expect(
        prisma.reversalEvent.create({
          data: { ...base, targetType: 'STAMP', reason: 'mistake', idempotencyKey: randomUUID() },
        }),
      ).rejects.toThrow(/reversal_events_one_target|does not match the reversed event/);

      await prisma.reversalEvent.create({
        data: {
          ...base,
          targetType: 'STAMP',
          stampEventId: stamp.id,
          reason: 'scanned by mistake',
          idempotencyKey: randomUUID(),
        },
      });
      await expect(
        prisma.reversalEvent.create({
          data: {
            ...base,
            targetType: 'STAMP',
            stampEventId: stamp.id,
            reason: 'again',
            idempotencyKey: randomUUID(),
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      // Original is untouched and still immutable.
      expect(await prisma.stampEvent.findUnique({ where: { id: stamp.id } })).not.toBeNull();
    });
  });

  describe('idempotency and outbox', () => {
    it('rejects a repeated idempotency key for the same staff member', async () => {
      const key = randomUUID();
      const data = {
        merchantId: a.merchantId,
        branchId: a.branchId,
        programId: a.programId,
        membershipId: a.membershipId,
        staffMembershipId: a.staffId,
        idempotencyKey: key,
      };
      await prisma.stampEvent.create({ data });
      await expect(prisma.stampEvent.create({ data })).rejects.toMatchObject({ code: 'P2002' });
    });

    it('stores idempotency records once per staff, operation and key', async () => {
      const data = {
        merchantId: a.merchantId,
        staffMembershipId: a.staffId,
        operation: 'stamp.confirm',
        key: randomUUID(),
        requestHash: 'abc',
        responseStatus: 201,
        responseBody: { ok: true },
        expiresAt: new Date(Date.now() + 86_400_000),
      };
      await prisma.idempotencyRecord.create({ data });
      await expect(prisma.idempotencyRecord.create({ data })).rejects.toMatchObject({
        code: 'P2002',
      });
    });

    it('collapses duplicate outbox jobs sharing a dedupe key', async () => {
      const dedupeKey = `wallet:${randomUUID()}`;
      const data = {
        merchantId: a.merchantId,
        type: 'wallet.update',
        aggregateType: 'membership',
        aggregateId: a.membershipId,
        dedupeKey,
      };
      await prisma.outboxJob.create({ data });
      await expect(prisma.outboxJob.create({ data })).rejects.toMatchObject({ code: 'P2002' });
    });
  });
});

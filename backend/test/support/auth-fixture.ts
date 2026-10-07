import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { seedReferenceData } from '../../prisma/seed-lib';

export const TEST_PASSWORD = 'Correct-Horse-Battery-9';
const passwordHash = hash(TEST_PASSWORD);
const tag = () => randomUUID().replace(/-/g, '').slice(0, 8);

export interface TestUser {
  userId: string;
  staffId: string;
  email: string;
  roleKey: string;
}

export interface TenantWorld {
  merchantId: string;
  joinReference: string;
  branches: [string, string];
  owner: TestUser;
  manager: TestUser;
  /** Assigned to branches[0] only. */
  staff1: TestUser;
  /** Assigned to branches[1] only. */
  staff2: TestUser;
}

export interface World {
  platformAdmin: { userId: string; email: string };
  a: TenantWorld;
  b: TenantWorld;
}

export async function createMerchantUser(
  prisma: PrismaClient,
  merchantId: string,
  roleKey: 'OWNER' | 'MANAGER' | 'STAFF',
  branchIds: string[],
): Promise<TestUser> {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  const email = `${roleKey.toLowerCase()}-${tag()}@t.test`;
  const user = await prisma.platformUser.create({
    data: {
      email,
      passwordHash: await passwordHash,
      displayName: `${roleKey} ${email}`,
      accountType: 'MERCHANT_USER',
    },
  });
  const staff = await prisma.staffMembership.create({
    data: {
      merchantId,
      userId: user.id,
      roleId: role.id,
      status: 'ACTIVE',
      activatedAt: new Date(),
    },
  });
  if (branchIds.length) {
    await prisma.staffBranchAssignment.createMany({
      data: branchIds.map((branchId) => ({ staffMembershipId: staff.id, branchId, merchantId })),
    });
  }
  return { userId: user.id, staffId: staff.id, email, roleKey };
}

async function createTenantWorld(prisma: PrismaClient): Promise<TenantWorld> {
  const t = tag();
  const merchant = await prisma.merchant.create({
    data: { slug: `w-${t}`, nameEn: `World ${t}`, joinReference: `join-${t}` },
  });
  const b1 = await prisma.branch.create({ data: { merchantId: merchant.id, nameEn: `B1 ${t}` } });
  const b2 = await prisma.branch.create({ data: { merchantId: merchant.id, nameEn: `B2 ${t}` } });
  return {
    merchantId: merchant.id,
    joinReference: merchant.joinReference,
    branches: [b1.id, b2.id],
    owner: await createMerchantUser(prisma, merchant.id, 'OWNER', [b1.id, b2.id]),
    manager: await createMerchantUser(prisma, merchant.id, 'MANAGER', [b1.id]),
    staff1: await createMerchantUser(prisma, merchant.id, 'STAFF', [b1.id]),
    staff2: await createMerchantUser(prisma, merchant.id, 'STAFF', [b2.id]),
  };
}

/** Two isolated merchants plus a platform administrator. All values are unique per call. */
export async function createWorld(prisma: PrismaClient): Promise<World> {
  await seedReferenceData(prisma);
  const email = `admin-${tag()}@t.test`;
  const admin = await prisma.platformUser.create({
    data: {
      email,
      passwordHash: await passwordHash,
      displayName: 'Platform Admin',
      accountType: 'PLATFORM_ADMIN',
    },
  });
  return {
    platformAdmin: { userId: admin.id, email },
    a: await createTenantWorld(prisma),
    b: await createTenantWorld(prisma),
  };
}

export interface Session {
  accessToken: string;
  refreshToken: string;
}

export async function login(
  app: INestApplication,
  email: string,
  password = TEST_PASSWORD,
): Promise<Session> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  return res.body as Session;
}

export const bearer = (s: Session | string) =>
  `Bearer ${typeof s === 'string' ? s : s.accessToken}`;

/** An ACTIVE default program with one reward, ready for enrollment. */
export async function createActiveProgram(
  prisma: PrismaClient,
  merchantId: string,
  over: { stampsRequired?: number; cooldownMinutes?: number; nameEn?: string } = {},
) {
  const program = await prisma.loyaltyProgram.create({
    data: {
      merchantId,
      nameEn: over.nameEn ?? 'Test Card',
      nameAm: 'የሙከራ ካርድ',
      termsEn: 'One stamp per visit.',
      stampsRequired: over.stampsRequired ?? 5,
      cooldownMinutes: over.cooldownMinutes ?? 0,
      status: 'ACTIVE',
      isDefault: true,
    },
  });
  await prisma.rewardDefinition.create({
    data: {
      merchantId,
      programId: program.id,
      nameEn: 'Free item',
      nameAm: 'ነጻ እቃ',
      descriptionEn: 'Any one item.',
    },
  });
  return program;
}

/** A unique, valid Ethiopian mobile number in national format (0911…). */
export const randomPhone = () => `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

export interface TestCard {
  token: string;
  membershipId: string;
  customerId: string;
}

/** A customer with an ACTIVE membership, a web pass, and a known raw card token. */
export async function createCard(
  prisma: PrismaClient,
  merchantId: string,
  programId: string,
  firstName = 'Card',
): Promise<TestCard> {
  const token = randomBytes(32).toString('base64url');
  const customer = await prisma.customer.create({
    data: { merchantId, phoneE164: `+251${randomPhone().slice(1)}`, firstName },
  });
  const membership = await prisma.customerMembership.create({
    data: {
      merchantId,
      customerId: customer.id,
      programId,
      tokenHash: createHash('sha256').update(token).digest('hex'),
    },
  });
  await prisma.walletPass.create({
    data: {
      merchantId,
      membershipId: membership.id,
      provider: 'WEB',
      status: 'ACTIVE',
      syncStatus: 'SYNCED',
    },
  });
  return { token, membershipId: membership.id, customerId: customer.id };
}

/**
 * Inserts history straight into the ledger (bypassing the scanner) for states the API cannot reach,
 * such as expired rewards. Stamps are dated in the past and spaced one minute apart.
 */
export async function seedLedger(
  prisma: PrismaClient,
  t: {
    merchantId: string;
    branchId: string;
    programId: string;
    membershipId: string;
    staffMembershipId: string;
    rewardDefinitionId: string;
  },
  options: { stamps: number; unlocks: Array<{ afterStamp: number; expiresInDays: number | null }> },
) {
  const base = Date.now() - 30 * 86_400_000;
  const stamps: Array<{ id: string }> = [];
  for (let i = 0; i < options.stamps; i++) {
    stamps.push(
      await prisma.stampEvent.create({
        data: {
          merchantId: t.merchantId,
          branchId: t.branchId,
          programId: t.programId,
          membershipId: t.membershipId,
          staffMembershipId: t.staffMembershipId,
          idempotencyKey: randomUUID(),
          occurredAt: new Date(base + i * 60_000),
        },
      }),
    );
  }
  const unlocks: Array<{ id: string }> = [];
  for (const u of options.unlocks) {
    const trigger = stamps[u.afterStamp - 1];
    if (!trigger) throw new Error('unlock refers to a stamp that was not created');
    unlocks.push(
      await prisma.rewardUnlock.create({
        data: {
          merchantId: t.merchantId,
          programId: t.programId,
          membershipId: t.membershipId,
          rewardDefinitionId: t.rewardDefinitionId,
          triggeringStampId: trigger.id,
          unlockedAt: new Date(base + u.afterStamp * 60_000 + 1),
          expiresAt:
            u.expiresInDays === null ? null : new Date(Date.now() + u.expiresInDays * 86_400_000),
        },
      }),
    );
  }
  return { stamps, unlocks };
}

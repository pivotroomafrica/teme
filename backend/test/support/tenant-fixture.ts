import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { seedReferenceData } from '../../prisma/seed-lib';

export interface Tenant {
  merchantId: string;
  branchId: string;
  userId: string;
  staffId: string;
  programId: string;
  rewardDefinitionId: string;
  customerId: string;
  membershipId: string;
}

const short = () => randomUUID().replace(/-/g, '').slice(0, 10);

/** Creates a complete, isolated merchant graph with unique values. */
export async function createTenant(prisma: PrismaClient): Promise<Tenant> {
  await seedReferenceData(prisma);
  const tag = short();
  const staffRole = await prisma.role.findUniqueOrThrow({ where: { key: 'STAFF' } });

  const merchant = await prisma.merchant.create({
    data: { slug: `t-${tag}`, nameEn: `Tenant ${tag}`, joinReference: `join-${tag}` },
  });
  const branch = await prisma.branch.create({
    data: { merchantId: merchant.id, nameEn: 'Main' },
  });
  const user = await prisma.platformUser.create({
    data: {
      email: `staff-${tag}@t.test`,
      passwordHash: 'not-a-real-hash',
      displayName: 'Fixture Staff',
      accountType: 'MERCHANT_USER',
    },
  });
  const staff = await prisma.staffMembership.create({
    data: { merchantId: merchant.id, userId: user.id, roleId: staffRole.id, status: 'ACTIVE' },
  });
  const program = await prisma.loyaltyProgram.create({
    data: {
      merchantId: merchant.id,
      nameEn: 'Card',
      stampsRequired: 3,
      status: 'ACTIVE',
      isDefault: true,
    },
  });
  const reward = await prisma.rewardDefinition.create({
    data: { merchantId: merchant.id, programId: program.id, nameEn: 'Free item' },
  });
  const customer = await prisma.customer.create({
    data: { merchantId: merchant.id, phoneE164: '+251911555000', firstName: 'Test' },
  });
  const membership = await prisma.customerMembership.create({
    data: {
      merchantId: merchant.id,
      customerId: customer.id,
      programId: program.id,
      tokenHash: `hash-${randomUUID()}`,
    },
  });

  return {
    merchantId: merchant.id,
    branchId: branch.id,
    userId: user.id,
    staffId: staff.id,
    programId: program.id,
    rewardDefinitionId: reward.id,
    customerId: customer.id,
    membershipId: membership.id,
  };
}

export async function addStamp(prisma: PrismaClient, t: Tenant) {
  return prisma.stampEvent.create({
    data: {
      merchantId: t.merchantId,
      branchId: t.branchId,
      programId: t.programId,
      membershipId: t.membershipId,
      staffMembershipId: t.staffId,
      idempotencyKey: randomUUID(),
    },
  });
}

export async function addUnlock(prisma: PrismaClient, t: Tenant, stampId: string) {
  return prisma.rewardUnlock.create({
    data: {
      merchantId: t.merchantId,
      programId: t.programId,
      membershipId: t.membershipId,
      rewardDefinitionId: t.rewardDefinitionId,
      triggeringStampId: stampId,
    },
  });
}

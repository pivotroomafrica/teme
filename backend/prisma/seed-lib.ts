import { createHash, randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, ROLES } from './reference-data';

export interface SeedOptions {
  /** Password for all development accounts. Generated when omitted. */
  password?: string;
  /** Skip sample merchant data (used in production: reference data only). */
  referenceOnly?: boolean;
}

export interface SeedResult {
  password: string;
  accounts: Record<string, string>;
  membershipTokens: Record<string, string>;
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export async function seedReferenceData(prisma: PrismaClient): Promise<void> {
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { key },
      update: { description },
      create: { key, description },
    });
  }
  for (const role of ROLES) {
    const row = await prisma.role.upsert({
      where: { key: role.key },
      update: { name: role.name, scope: role.scope, description: role.description },
      create: { key: role.key, name: role.name, scope: role.scope, description: role.description },
    });
    const permissions = await prisma.permission.findMany({
      where: { key: { in: role.permissions } },
      select: { id: true },
    });
    // The catalog is authoritative: drop grants no longer listed.
    await prisma.rolePermission.deleteMany({
      where: { roleId: row.id, permissionId: { notIn: permissions.map((p) => p.id) } },
    });
    await prisma.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId: row.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }
}

/** Idempotent: safe to run repeatedly. */
export async function runSeed(
  prisma: PrismaClient,
  options: SeedOptions = {},
): Promise<SeedResult> {
  await seedReferenceData(prisma);

  const password = options.password ?? randomBytes(12).toString('base64url');
  const result: SeedResult = { password, accounts: {}, membershipTokens: {} };
  if (options.referenceOnly) return result;

  const passwordHash = await hash(password);
  const roles = Object.fromEntries(
    (await prisma.role.findMany()).map((r) => [r.key, r.id]),
  ) as Record<string, string>;

  const upsertUser = async (
    email: string,
    displayName: string,
    accountType: 'PLATFORM_ADMIN' | 'MERCHANT_USER',
  ) => {
    result.accounts[displayName] = email;
    return prisma.platformUser.upsert({
      where: { email },
      update: { displayName },
      create: { email, displayName, accountType, passwordHash },
    });
  };

  await upsertUser('admin@temelashcard.test', 'Platform Admin', 'PLATFORM_ADMIN');

  const merchant = await prisma.merchant.upsert({
    where: { slug: 'sample-cafe' },
    update: {},
    create: {
      slug: 'sample-cafe',
      nameEn: 'Sample Cafe',
      nameAm: 'ናሙና ቡና ቤት',
      joinReference: 'sample-cafe-join-7f3a9c',
      defaultLanguage: 'AM',
    },
  });
  await prisma.merchantSettings.upsert({
    where: { merchantId: merchant.id },
    update: {},
    create: {
      merchantId: merchant.id,
      supportEmail: 'support@sample-cafe.test',
      defaultStampsRequired: 8,
      defaultCooldownMinutes: 60,
    },
  });

  const bole =
    (await prisma.branch.findFirst({ where: { merchantId: merchant.id, nameEn: 'Bole' } })) ??
    (await prisma.branch.create({
      data: { merchantId: merchant.id, nameEn: 'Bole', nameAm: 'ቦሌ', city: 'Addis Ababa' },
    }));
  const piassa =
    (await prisma.branch.findFirst({ where: { merchantId: merchant.id, nameEn: 'Piassa' } })) ??
    (await prisma.branch.create({
      data: { merchantId: merchant.id, nameEn: 'Piassa', nameAm: 'ፒያሳ', city: 'Addis Ababa' },
    }));

  const staffSpecs = [
    {
      email: 'owner@sample-cafe.test',
      name: 'Sample Owner',
      role: 'OWNER',
      branches: [bole, piassa],
    },
    { email: 'staff.bole@sample-cafe.test', name: 'Bole Staff', role: 'STAFF', branches: [bole] },
    {
      email: 'staff.piassa@sample-cafe.test',
      name: 'Piassa Staff',
      role: 'STAFF',
      branches: [piassa],
    },
  ];
  for (const spec of staffSpecs) {
    const user = await upsertUser(spec.email, spec.name, 'MERCHANT_USER');
    const staff = await prisma.staffMembership.upsert({
      where: { merchantId_userId: { merchantId: merchant.id, userId: user.id } },
      update: {},
      create: {
        merchantId: merchant.id,
        userId: user.id,
        roleId: roles[spec.role] as string,
        status: 'ACTIVE',
        activatedAt: new Date(),
      },
    });
    await prisma.staffBranchAssignment.createMany({
      data: spec.branches.map((b) => ({
        staffMembershipId: staff.id,
        branchId: b.id,
        merchantId: merchant.id,
      })),
      skipDuplicates: true,
    });
  }

  const program =
    (await prisma.loyaltyProgram.findFirst({
      where: { merchantId: merchant.id, nameEn: 'Coffee Stamp Card' },
    })) ??
    (await prisma.loyaltyProgram.create({
      data: {
        merchantId: merchant.id,
        nameEn: 'Coffee Stamp Card',
        nameAm: 'የቡና ስታምፕ ካርድ',
        stampsRequired: 8,
        cooldownMinutes: 60,
        status: 'ACTIVE',
        isDefault: true,
        brandColor: '#7A4B2A',
        termsEn: 'One stamp per visit. Reward has no cash value.',
        termsAm: 'በአንድ ጉብኝት አንድ ስታምፕ። ሽልማቱ የገንዘብ ዋጋ የለውም።',
      },
    }));
  const reward = await prisma.rewardDefinition.findFirst({
    where: { programId: program.id, status: 'ACTIVE' },
  });
  if (!reward) {
    await prisma.rewardDefinition.create({
      data: {
        merchantId: merchant.id,
        programId: program.id,
        nameEn: 'Free coffee',
        nameAm: 'ነጻ ቡና',
        descriptionEn: 'Enjoy one free coffee of your choice.',
        descriptionAm: 'የሚፈልጉትን አንድ ቡና በነጻ ያግኙ።',
        validForDays: 90,
      },
    });
  }

  const customers = [
    { phone: '+251911000101', firstName: 'Abebe', language: 'AM' as const },
    { phone: '+251911000102', firstName: 'Sara', language: 'EN' as const },
  ];
  for (const c of customers) {
    const customer = await prisma.customer.upsert({
      where: { merchantId_phoneE164: { merchantId: merchant.id, phoneE164: c.phone } },
      update: {},
      create: {
        merchantId: merchant.id,
        phoneE164: c.phone,
        firstName: c.firstName,
        preferredLanguage: c.language,
      },
    });
    const existingConsent = await prisma.customerConsent.count({
      where: { customerId: customer.id },
    });
    if (existingConsent === 0) {
      await prisma.customerConsent.create({
        data: {
          merchantId: merchant.id,
          customerId: customer.id,
          type: 'LOYALTY_TERMS',
          action: 'GRANTED',
          version: '2026-01',
          source: 'JOIN_FORM',
        },
      });
    }
    const existing = await prisma.customerMembership.findUnique({
      where: { customerId_programId: { customerId: customer.id, programId: program.id } },
    });
    if (!existing) {
      // The raw token is only returned here for local testing; only its hash is stored.
      const token = randomBytes(32).toString('base64url');
      await prisma.customerMembership.create({
        data: {
          merchantId: merchant.id,
          customerId: customer.id,
          programId: program.id,
          tokenHash: sha256(token),
        },
      });
      result.membershipTokens[c.firstName] = token;
    }
  }

  return result;
}

/**
 * Operator CLI for a new production environment (the development seed is never run there).
 *
 *   npm run bootstrap -- admin    <email> "<Display Name>"
 *   npm run bootstrap -- merchant <slug> "<Business Name>" <owner-email> "<Owner Name>"
 *
 * `admin` reads the password from BOOTSTRAP_PASSWORD (min 14 characters) so it never appears in shell history
 * or process listings. `merchant` creates the business, its settings and an owner account in the INVITED state
 * and prints a single-use invitation token (valid 7 days) to hand to the owner, who sets their own password via
 * POST /api/v1/auth/invitations/accept. Both commands are idempotent-safe: they refuse to overwrite anything.
 * Reference data (roles and permissions) is seeded first, so `npm run db:seed` with NODE_ENV=production is enough
 * before running this.
 */
import { createHash, randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';
import { seedReferenceData } from './seed-lib';

const INVITATION_TTL_DAYS = 7;
const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

async function createAdmin(prisma: PrismaClient, email: string, displayName: string) {
  const password = process.env.BOOTSTRAP_PASSWORD ?? '';
  if (password.length < 14) fail('Set BOOTSTRAP_PASSWORD (at least 14 characters).');
  const address = email.trim().toLowerCase();
  if (await prisma.platformUser.findUnique({ where: { email: address } })) {
    fail(`An account for ${address} already exists.`);
  }
  const user = await prisma.platformUser.create({
    data: {
      email: address,
      displayName,
      accountType: 'PLATFORM_ADMIN',
      passwordHash: await hash(password),
    },
  });
  await prisma.auditEvent.create({
    data: {
      actorType: 'SYSTEM',
      action: 'platform.admin_bootstrapped',
      targetType: 'platform_user',
      targetId: user.id,
    },
  });
  console.log(`Platform administrator created: ${address}`);
}

async function createMerchant(
  prisma: PrismaClient,
  slug: string,
  nameEn: string,
  ownerEmail: string,
  ownerName: string,
) {
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) {
    fail('slug must be 3-50 lowercase letters, digits or hyphens.');
  }
  const email = ownerEmail.trim().toLowerCase();
  if (await prisma.platformUser.findUnique({ where: { email } })) {
    fail(`An account for ${email} already exists.`);
  }
  if (await prisma.merchant.findUnique({ where: { slug } }))
    fail(`Merchant "${slug}" already exists.`);

  const ownerRole = await prisma.role.findUnique({ where: { key: 'OWNER' } });
  if (!ownerRole) return fail('Roles are missing. Run "npm run db:seed" first.');

  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const unusablePassword = await hash(randomBytes(32).toString('base64url'));

  await prisma.$transaction(async (tx) => {
    const merchant = await tx.merchant.create({
      data: { slug, nameEn, joinReference: `${slug}-${randomBytes(6).toString('hex')}` },
    });
    await tx.merchantSettings.create({ data: { merchantId: merchant.id } });
    const user = await tx.platformUser.create({
      data: {
        email,
        displayName: ownerName,
        accountType: 'MERCHANT_USER',
        passwordHash: unusablePassword,
      },
    });
    const staff = await tx.staffMembership.create({
      data: { merchantId: merchant.id, userId: user.id, roleId: ownerRole.id, status: 'INVITED' },
    });
    await tx.staffInvitation.create({
      data: {
        merchantId: merchant.id,
        staffMembershipId: staff.id,
        tokenHash,
        invitedByUserId: user.id,
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000),
      },
    });
    await tx.auditEvent.create({
      data: {
        actorType: 'SYSTEM',
        merchantId: merchant.id,
        action: 'platform.merchant_bootstrapped',
        targetType: 'merchant',
        targetId: merchant.id,
        metadata: { slug },
      },
    });
  });
  console.log(
    `Merchant "${slug}" created. Give the owner this one-time invitation token (7 days):`,
  );
  console.log(token);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const prisma = new PrismaClient();
  try {
    await seedReferenceData(prisma);
    if (command === 'admin' && args.length === 2) {
      await createAdmin(prisma, args[0]!, args[1]!);
    } else if (command === 'merchant' && args.length === 4) {
      await createMerchant(prisma, args[0]!, args[1]!, args[2]!, args[3]!);
    } else {
      fail(
        'Usage:\n  bootstrap admin <email> "<Name>"\n  bootstrap merchant <slug> "<Business>" <owner-email> "<Owner Name>"',
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { runSeed } from './seed-lib';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const production = process.env.NODE_ENV === 'production';
    const result = await runSeed(prisma, {
      password: process.env.SEED_PASSWORD,
      referenceOnly: production,
    });
    if (production) {
      console.log('Seeded reference data (roles, permissions) only.');
      return;
    }
    // Credentials go to a gitignored file, never to the console or logs.
    const out = join(__dirname, '..', '.seed-output.json');
    writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(`Development seed complete. Credentials written to ${out} (gitignored).`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});

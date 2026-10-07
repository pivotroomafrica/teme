import { PrismaService } from '../../src/database/prisma.service';

describe('Database connectivity (integration, requires PostgreSQL)', () => {
  const prisma = new PrismaService();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('connects to PostgreSQL and uses a UTC session timezone', async () => {
    const rows = await prisma.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`;
    expect(['UTC', 'Etc/UTC']).toContain(rows[0]?.tz);
  });
});

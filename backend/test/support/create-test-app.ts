import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/database/prisma.service';

/** Builds the real app. Pass a stub PrismaService to run without a database. */
export async function createTestApp(
  prismaOverride?: Partial<PrismaService>,
): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (prismaOverride) {
    builder = builder.overrideProvider(PrismaService).useValue(prismaOverride);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  // Listen once on an ephemeral port so concurrent supertest calls share one server.
  await app.listen(0);
  return app;
}

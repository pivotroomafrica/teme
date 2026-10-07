import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly indicator: HealthIndicatorService,
  ) {}

  async isHealthy(key: string) {
    const session = this.indicator.check(key);
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return session.up();
    } catch {
      return session.down({ message: 'database unreachable' });
    }
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class PlatformMerchantsRepository {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.merchant.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, slug: true, nameEn: true, nameAm: true, status: true },
    });
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaHealthIndicator {
  constructor(private readonly prisma: PrismaService) {}

  async isHealthy(): Promise<{ database: { status: string } }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { database: { status: 'up' } };
    } catch {
      return { database: { status: 'down' } };
    }
  }
}

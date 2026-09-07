import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './prisma-health.indicator';

@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
  providers: [PrismaHealthIndicator],
})
export class HealthModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { BillingController } from './billing.controller';
import { BillingExportService } from './billing-export.service';
import { BillingMappingService } from './billing-mapping.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [BillingController],
  providers: [BillingExportService, BillingMappingService],
})
export class BillingModule {}

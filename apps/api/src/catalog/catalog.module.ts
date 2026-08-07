import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { LabTenantGuard } from '../lab/lab-tenant.guard';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CatalogController],
  providers: [CatalogService, TenantGuard, LabTenantGuard],
  exports: [CatalogService],
})
export class CatalogModule {}

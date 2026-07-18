import { Module } from '@nestjs/common';
import { LabController } from './lab.controller';
import { LabService } from './lab.service';
import { LabUsersService } from './lab-users.service';
import { LabTenantGuard } from './lab-tenant.guard';
import { OrderAttentionService } from './order-attention.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { RagModule } from '../rag/rag.module';

@Module({
  imports: [PrismaModule, AuthModule, RagModule],
  controllers: [LabController],
  providers: [
    LabService,
    LabUsersService,
    LabTenantGuard,
    OrderAttentionService,
  ],
  exports: [LabTenantGuard, OrderAttentionService],
})
export class LabModule {}

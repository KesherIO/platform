import { Module } from '@nestjs/common';
import { VetVerificationController } from './vet-verification.controller';
import { VetVerificationService } from './vet-verification.service';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantGuard } from '../auth/guards/tenant.guard';

@Module({
  imports: [PrismaModule],
  controllers: [VetVerificationController],
  providers: [VetVerificationService, TenantGuard],
})
export class VetVerificationModule {}

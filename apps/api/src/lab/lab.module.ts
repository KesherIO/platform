import { Module } from '@nestjs/common';
import { LabController } from './lab.controller';
import { LabService } from './lab.service';
import { LabUsersService } from './lab-users.service';
import { LabClientsService } from './lab-clients.service';
import { LabVetVerificationService } from './lab-vet-verification.service';
import { PickupService } from './pickup.service';
import { SpecimenService } from './specimen.service';
import { ResultEntryService } from './result-entry.service';
import { ReviewService } from './review.service';
import { WorklistService } from './worklist.service';
import { ReadinessService } from './readiness.service';
import { OrderStatusService } from './order-status.service';
import { ReleaseService } from './release.service';
import { AmendmentService } from './amendment.service';
import { LabTenantGuard } from './lab-tenant.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ResultsModule } from '../results/results.module';
import { CatalogModule } from '../catalog/catalog.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    NotificationsModule,
    ResultsModule,
    CatalogModule,
    StorageModule,
  ],
  controllers: [LabController],
  providers: [
    LabService,
    LabUsersService,
    LabClientsService,
    LabVetVerificationService,
    PickupService,
    SpecimenService,
    ResultEntryService,
    ReviewService,
    WorklistService,
    ReadinessService,
    OrderStatusService,
    ReleaseService,
    AmendmentService,
    LabTenantGuard,
  ],
  exports: [PickupService, ReadinessService, OrderStatusService],
})
export class LabModule {}

import { Module } from '@nestjs/common';
import { LabController } from './lab.controller';
import { LabService } from './lab.service';
import { LabUsersService } from './lab-users.service';
import { LabClientsService } from './lab-clients.service';
import { PickupService } from './pickup.service';
import { LabTenantGuard } from './lab-tenant.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, AuthModule, NotificationsModule],
  controllers: [LabController],
  providers: [
    LabService,
    LabUsersService,
    LabClientsService,
    PickupService,
    LabTenantGuard,
  ],
  exports: [PickupService], // OrdersModule needs this to auto-create pickups
})
export class LabModule {}

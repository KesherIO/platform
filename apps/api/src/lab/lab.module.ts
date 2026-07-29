import { Module } from '@nestjs/common';
import { LabController } from './lab.controller';
import { LabService } from './lab.service';
import { LabUsersService } from './lab-users.service';
import { LabClientsService } from './lab-clients.service';
import { LabTenantGuard } from './lab-tenant.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [LabController],
  providers: [LabService, LabUsersService, LabClientsService, LabTenantGuard],
})
export class LabModule {}

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CasesModule } from '../cases/cases.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { TenantsModule } from '../tenants/tenants.module';
import { StorageModule } from '../storage/storage.module';
import { CatalogModule } from '../catalog/catalog.module';
import { OrdersModule } from '../orders/orders.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', 'apps/api/.env'],
    }),
    PrismaModule,
    StorageModule,
    AuthModule,
    CasesModule,
    OnboardingModule,
    TenantsModule,
    CatalogModule,
    OrdersModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global guards — order matters: JWT first, then roles
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // TenantGuard is NOT global — apply it per controller with @UseGuards(TenantGuard)
  ],
})
export class AppModule {}

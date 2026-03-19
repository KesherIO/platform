import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from '../auth/auth.module';
import { CasesModule } from '../cases/cases.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
  imports: [AuthModule, CasesModule, OnboardingModule, TenantsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
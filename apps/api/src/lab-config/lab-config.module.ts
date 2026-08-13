import { Module } from '@nestjs/common';
import { LabConfigController } from './lab-config.controller';
import { AnalyzerService } from './analyzer.service';
import { LabTestConfigService } from './lab-test-config.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [LabConfigController],
  providers: [AnalyzerService, LabTestConfigService],
  exports: [LabTestConfigService],
})
export class LabConfigModule {}

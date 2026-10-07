import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ResultsController } from './results.controller';
import { ResultsService } from './results.service';
import { TemplateController } from './template.controller';
import { TemplateVersionService } from './template-version.service';
import { PlatformSeedService } from './platform-seed.service';
import { RagModule } from '../rag/rag.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [ConfigModule, RagModule, AuthModule, PrismaModule, StorageModule],
  controllers: [ResultsController, TemplateController],
  providers: [ResultsService, TemplateVersionService, PlatformSeedService],
  exports: [ResultsService, TemplateVersionService],
})
export class ResultsModule {}

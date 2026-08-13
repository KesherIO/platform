import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ResultsController } from './results.controller';
import { ResultsService } from './results.service';
import { TemplateController } from './template.controller';
import { TemplateVersionService } from './template-version.service';
import { RagModule } from '../rag/rag.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ConfigModule, RagModule, AuthModule],
  controllers: [ResultsController, TemplateController],
  providers: [ResultsService, TemplateVersionService],
  exports: [ResultsService, TemplateVersionService],
})
export class ResultsModule {}

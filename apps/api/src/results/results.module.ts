import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ResultsController } from './results.controller';
import { ResultsService } from './results.service';
import { RagModule } from '../rag/rag.module';

@Module({
  imports: [ConfigModule, RagModule],
  controllers: [ResultsController],
  providers: [ResultsService],
  exports: [ResultsService],
})
export class ResultsModule {}

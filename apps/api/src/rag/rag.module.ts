import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RagService } from './rag.service';
import { KnowledgeSearchService } from './knowledge-search.service';

@Module({
  imports: [ConfigModule],
  providers: [RagService, KnowledgeSearchService],
  exports: [RagService, KnowledgeSearchService],
})
export class RagModule {}

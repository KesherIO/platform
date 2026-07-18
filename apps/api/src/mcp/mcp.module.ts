import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LabModule } from '../lab/lab.module';
import { RagModule } from '../rag/rag.module';
import { McpController } from './mcp.controller';
import { McpSessionManager } from './mcp-session.manager';

@Module({
  imports: [AuthModule, LabModule, RagModule],
  controllers: [McpController],
  providers: [McpSessionManager],
})
export class McpModule {}

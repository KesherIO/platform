import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OrderAttentionService } from '../../lab/order-attention.service';
import { KnowledgeSearchService } from '../../rag/knowledge-search.service';
import { McpToolContext } from '../mcp-tool-context';
import { registerGetOrdersNeedingAttentionTool } from './get-orders-needing-attention.tool';
import { registerSearchVeterinaryKnowledgeTool } from './search-veterinary-knowledge.tool';

export interface McpToolDeps {
  orderAttentionService: OrderAttentionService;
  knowledgeSearchService: KnowledgeSearchService;
}

export function registerTools(
  server: McpServer,
  context: McpToolContext,
  deps: McpToolDeps
): void {
  registerGetOrdersNeedingAttentionTool(
    server,
    context,
    deps.orderAttentionService
  );
  registerSearchVeterinaryKnowledgeTool(
    server,
    context,
    deps.knowledgeSearchService
  );
}

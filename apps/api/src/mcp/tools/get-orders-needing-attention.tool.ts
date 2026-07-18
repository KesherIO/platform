import { Logger } from '@nestjs/common';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OrderAttentionService } from '../../lab/order-attention.service';
import { McpToolContext } from '../mcp-tool-context';
import { toOrderAttentionDto } from '../mappers/order-attention.mapper';

const logger = new Logger('Mcp:get_orders_needing_attention');

// .strict() rejects unknown fields; only `.shape` (which drops the modifier)
// can be handed to the SDK's registerTool, so we re-parse with the full
// schema ourselves inside the handler to actually enforce it.
const inputSchema = z
  .object({
    minSeverity: z
      .enum(['HIGH', 'CRITICAL'])
      .optional()
      .describe(
        'Only return orders at or above this severity. Omit to return all matched orders.'
      ),
  })
  .strict();

export function registerGetOrdersNeedingAttentionTool(
  server: McpServer,
  context: McpToolContext,
  orderAttentionService: OrderAttentionService
) {
  server.registerTool(
    'get_orders_needing_attention',
    {
      title: 'Get orders needing attention',
      description:
        'Lists open lab orders for the authenticated lab tenant that need attention: ' +
        "STAT/URGENT priority, an SLA breach at the order's current stage, or an " +
        'unreviewed abnormal result. Rules are deterministic and explained per order ' +
        'via `reasons` — nothing here is inferred by the caller.',
      inputSchema: inputSchema.shape,
    },
    async (rawArgs) => {
      const start = Date.now();

      let args: z.infer<typeof inputSchema>;
      try {
        args = inputSchema.parse(rawArgs);
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Invalid input: ${(err as Error).message}`,
            },
          ],
        };
      }

      try {
        const orders = await orderAttentionService.getOrdersNeedingAttention(
          context.tenantId
        );
        const filtered =
          args.minSeverity === 'CRITICAL'
            ? orders.filter((o) => o.severity === 'CRITICAL')
            : orders;
        const dto = filtered.map(toOrderAttentionDto);

        logger.log(
          `tenantId=${context.tenantId} resultCount=${dto.length} durationMs=${
            Date.now() - start
          }`
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ orders: dto }, null, 2),
            },
          ],
        };
      } catch (err) {
        logger.error(
          `tenantId=${context.tenantId} durationMs=${
            Date.now() - start
          } error=${(err as Error).message}`,
          (err as Error).stack
        );
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'Failed to retrieve orders needing attention. Please try again.',
            },
          ],
        };
      }
    }
  );
}

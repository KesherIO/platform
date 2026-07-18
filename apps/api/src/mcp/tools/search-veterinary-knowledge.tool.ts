import { Logger } from '@nestjs/common';
import { PatientSpecies } from '@prisma/client';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { KnowledgeSearchService } from '../../rag/knowledge-search.service';
import { McpToolContext } from '../mcp-tool-context';
import { toKnowledgeSearchResultDto } from '../mappers/knowledge-search-result.mapper';

const logger = new Logger('Mcp:search_veterinary_knowledge');

const MAX_SYMPTOMS_LENGTH = 1000;
const MAX_ANALYTES = 50;
const MAX_TOP_K = 20;
const DEFAULT_TOP_K = 5;

// .strict() rejects unknown fields; only `.shape` (which drops the modifier)
// can be handed to the SDK's registerTool, so we re-parse with the full
// schema ourselves inside the handler to actually enforce it.
const inputSchema = z
  .object({
    species: z.nativeEnum(PatientSpecies),
    symptoms: z.string().max(MAX_SYMPTOMS_LENGTH).optional(),
    analytes: z
      .array(
        z.object({
          code: z.string().max(50),
          flag: z.enum(['H', 'L', 'N']),
        })
      )
      .max(MAX_ANALYTES)
      .optional(),
    topK: z.number().int().min(1).max(MAX_TOP_K).optional(),
  })
  .strict();

export function registerSearchVeterinaryKnowledgeTool(
  server: McpServer,
  context: McpToolContext,
  knowledgeSearchService: KnowledgeSearchService
) {
  server.registerTool(
    'search_veterinary_knowledge',
    {
      title: 'Search veterinary knowledge base',
      description:
        'Semantic search over the veterinary knowledge base for clinical interpretation ' +
        'guidance given a species, optional symptom narrative, and optional flagged ' +
        'analytes. Returns ranked chunks with source document, section, and a relevance ' +
        'score — always cite the source when using a result.',
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
        const results = await knowledgeSearchService.search({
          species: args.species,
          symptoms: args.symptoms,
          analytes: args.analytes,
          topK: args.topK ?? DEFAULT_TOP_K,
        });
        const dto = results.map(toKnowledgeSearchResultDto);

        logger.log(
          `tenantId=${context.tenantId} species=${args.species} resultCount=${
            dto.length
          } durationMs=${Date.now() - start}`
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ results: dto }, null, 2),
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
              text: 'Failed to search the knowledge base. Please try again.',
            },
          ],
        };
      }
    }
  );
}

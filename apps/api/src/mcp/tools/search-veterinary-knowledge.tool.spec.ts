import { TenantRole } from '@vet-ai/shared-types';
import { registerSearchVeterinaryKnowledgeTool } from './search-veterinary-knowledge.tool';
import { KnowledgeSearchService } from '../../rag/knowledge-search.service';
import { McpToolContext } from '../mcp-tool-context';

const CONTEXT: McpToolContext = {
  userId: 'user-1',
  tenantId: 'lab-tenant-1',
  tenantName: 'Central Lab',
  role: TenantRole.ADMIN,
};

function registerAndGetHandler(knowledgeSearchService: KnowledgeSearchService) {
  const registerTool = jest.fn();
  const server = { registerTool } as any;
  registerSearchVeterinaryKnowledgeTool(
    server,
    CONTEXT,
    knowledgeSearchService
  );
  const [name, config, handler] = registerTool.mock.calls[0];
  return { name, config, handler };
}

describe('search_veterinary_knowledge tool', () => {
  let knowledgeSearchService: { search: jest.Mock };

  beforeEach(() => {
    knowledgeSearchService = { search: jest.fn() };
  });

  it('registers under the expected tool name', () => {
    const { name } = registerAndGetHandler(knowledgeSearchService as any);
    expect(name).toBe('search_veterinary_knowledge');
  });

  it('passes validated input through to the service, defaulting topK', async () => {
    knowledgeSearchService.search.mockResolvedValue([]);
    const { handler } = registerAndGetHandler(knowledgeSearchService as any);

    await handler({ species: 'DOG', symptoms: 'lethargy' });

    expect(knowledgeSearchService.search).toHaveBeenCalledWith({
      species: 'DOG',
      symptoms: 'lethargy',
      analytes: undefined,
      topK: 5,
    });
  });

  it('returns a successful, non-error result for zero matches', async () => {
    knowledgeSearchService.search.mockResolvedValue([]);
    const { handler } = registerAndGetHandler(knowledgeSearchService as any);

    const result = await handler({ species: 'CAT' });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ results: [] });
  });

  it('maps service results through the DTO shape with source metadata', async () => {
    knowledgeSearchService.search.mockResolvedValue([
      {
        id: 'chunk-1',
        documentTitle: 'Canine Renal Panel Guide',
        section: 'Interpretation',
        content: 'Elevated BUN/creatinine...',
        species: 'DOG',
        similarity: 0.9,
      },
    ]);
    const { handler } = registerAndGetHandler(knowledgeSearchService as any);

    const result = await handler({ species: 'DOG' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.results[0]).toEqual({
      sourceId: 'chunk-1',
      documentTitle: 'Canine Renal Panel Guide',
      section: 'Interpretation',
      content: 'Elevated BUN/creatinine...',
      species: 'DOG',
      relevanceScore: 0.9,
    });
  });

  it('rejects an invalid species as a client error, not an internal failure', async () => {
    const { handler } = registerAndGetHandler(knowledgeSearchService as any);

    const result = await handler({ species: 'DRAGON' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Invalid input/);
    expect(knowledgeSearchService.search).not.toHaveBeenCalled();
  });

  it('rejects a topK above the cap', async () => {
    const { handler } = registerAndGetHandler(knowledgeSearchService as any);

    const result = await handler({ species: 'DOG', topK: 999 });

    expect(result.isError).toBe(true);
    expect(knowledgeSearchService.search).not.toHaveBeenCalled();
  });

  it('rejects unknown input fields (e.g. a smuggled tenantId)', async () => {
    const { handler } = registerAndGetHandler(knowledgeSearchService as any);

    const result = await handler({
      species: 'DOG',
      tenantId: 'attacker-supplied-tenant',
    });

    expect(result.isError).toBe(true);
    expect(knowledgeSearchService.search).not.toHaveBeenCalled();
  });

  it('returns a sanitized error result on an internal failure', async () => {
    knowledgeSearchService.search.mockRejectedValue(new Error('openai down'));
    const { handler } = registerAndGetHandler(knowledgeSearchService as any);

    const result = await handler({ species: 'DOG' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toMatch(/openai down/);
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { KnowledgeSearchService } from './knowledge-search.service';
import { RagService } from './rag.service';

describe('KnowledgeSearchService', () => {
  let service: KnowledgeSearchService;
  let ragService: { retrieveRelevantChunks: jest.Mock };
  let configGet: jest.Mock;

  beforeEach(async () => {
    ragService = { retrieveRelevantChunks: jest.fn() };
    configGet = jest.fn((_key: string, defaultValue?: number) => defaultValue);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KnowledgeSearchService,
        { provide: RagService, useValue: ragService },
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();

    service = module.get(KnowledgeSearchService);
  });

  it('creates without error', () => {
    expect(service).toBeDefined();
  });

  it('delegates to RagService and maps the result shape', async () => {
    ragService.retrieveRelevantChunks.mockResolvedValue([
      {
        id: 'chunk-1',
        section: 'Interpretation',
        content: 'Elevated BUN/creatinine suggests...',
        documentTitle: 'Canine Renal Panel Guide',
        species: 'DOG',
        similarity: 0.87654,
      },
    ]);

    const result = await service.search({
      species: 'DOG',
      symptoms: 'lethargy',
    });

    expect(ragService.retrieveRelevantChunks).toHaveBeenCalledWith(
      expect.objectContaining({ species: 'DOG', symptoms: 'lethargy' })
    );
    expect(result).toEqual([
      {
        id: 'chunk-1',
        documentTitle: 'Canine Renal Panel Guide',
        section: 'Interpretation',
        content: 'Elevated BUN/creatinine suggests...',
        species: 'DOG',
        similarity: 0.877,
      },
    ]);
  });

  it('returns an empty array as a successful result when nothing matches', async () => {
    ragService.retrieveRelevantChunks.mockResolvedValue([]);

    const result = await service.search({ species: 'CAT' });

    expect(result).toEqual([]);
  });

  it('rejects if the underlying call exceeds the configured timeout', async () => {
    configGet.mockImplementation((key: string, defaultValue?: number) =>
      key === 'KNOWLEDGE_SEARCH_TIMEOUT_MS' ? 10 : defaultValue
    );
    ragService.retrieveRelevantChunks.mockReturnValue(
      new Promise(() => {
        /* never resolves */
      })
    );

    await expect(service.search({ species: 'DOG' })).rejects.toThrow(
      /timed out/
    );
  });
});

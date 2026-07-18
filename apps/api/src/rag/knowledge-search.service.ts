import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RagService } from './rag.service';

export interface KnowledgeSearchQuery {
  species: string;
  symptoms?: string | null;
  analytes?: Array<{ code: string; flag: string }>;
  topK?: number;
}

export interface KnowledgeSearchResult {
  id: string;
  documentTitle: string;
  section: string;
  content: string;
  species: string | null;
  similarity: number;
}

/**
 * Application-level entry point into the knowledge base. Delegates the actual
 * embedding + pgvector similarity search to RagService, adding the timeout and
 * output shape external callers (e.g. the MCP tool) should depend on instead
 * of RagService's internals.
 */
@Injectable()
export class KnowledgeSearchService {
  private readonly logger = new Logger(KnowledgeSearchService.name);

  constructor(
    private readonly ragService: RagService,
    private readonly config: ConfigService
  ) {}

  async search(query: KnowledgeSearchQuery): Promise<KnowledgeSearchResult[]> {
    const timeoutMs = this.config.get<number>(
      'KNOWLEDGE_SEARCH_TIMEOUT_MS',
      10_000
    );

    const chunks = await this.withTimeout(
      this.ragService.retrieveRelevantChunks(query),
      timeoutMs
    );

    this.logger.debug(
      `species=${query.species} topK=${query.topK ?? 5} resultCount=${
        chunks.length
      }`
    );

    return chunks.map((chunk) => ({
      id: chunk.id,
      documentTitle: chunk.documentTitle,
      section: chunk.section,
      content: chunk.content,
      species: chunk.species,
      similarity: Math.round(chunk.similarity * 1000) / 1000,
    }));
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(new Error(`Knowledge search timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
    });

    return Promise.race([promise, timeout]).finally(() =>
      clearTimeout(timer)
    ) as Promise<T>;
  }
}

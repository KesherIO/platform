import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';

export interface RetrievedChunk {
  id: string;
  section: string;
  content: string;
  documentTitle: string;
  species: string | null;
  similarity: number;
}

interface ChunkRow {
  id: string;
  section: string;
  content: string;
  document_title: string;
  species: string | null;
  similarity: string | number;
}

@Injectable()
export class RagService {
  private readonly openai: OpenAI | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    this.openai = apiKey ? new OpenAI({ apiKey }) : null;
  }

  /**
   * Retrieve the most relevant knowledge chunks for a given clinical query.
   * Returns empty array if OpenAI is not configured (graceful degradation).
   */
  async retrieveRelevantChunks(query: {
    species: string;
    symptoms?: string | null;
    analytes?: Array<{ code: string; flag: string }>;
    tenantId?: string;
    topK?: number;
  }): Promise<RetrievedChunk[]> {
    if (!this.openai) return [];

    const queryText = this.buildQueryText(query);
    const embedding = await this.generateEmbedding(queryText);
    return this.searchChunks(embedding, query.topK ?? 5);
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.openai)
      throw new Error('OpenAI not configured — set OPENAI_API_KEY');
    const response = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  }

  private buildQueryText(query: {
    species: string;
    symptoms?: string | null;
    analytes?: Array<{ code: string; flag: string }>;
  }): string {
    const parts: string[] = [`Species: ${query.species}`];
    if (query.symptoms) parts.push(`Symptoms: ${query.symptoms}`);
    const flagged = (query.analytes ?? [])
      .filter((a) => a.flag === 'H' || a.flag === 'L')
      .map((a) => `${a.code} (${a.flag})`)
      .join(', ');
    if (flagged) parts.push(`Abnormal analytes: ${flagged}`);
    return parts.join('. ');
  }

  private async searchChunks(
    embedding: number[],
    topK: number
  ): Promise<RetrievedChunk[]> {
    const vectorStr = `[${embedding.join(',')}]`;

    // Retrieval strategy:
    //   MVP: global knowledge only (scope = 'GLOBAL')
    //   Future: tenant-specific first, then global fallback:
    //     WHERE (kc.scope = 'GLOBAL' OR (kc.scope = 'TENANT' AND kc.tenant_id = $tenantId))
    //     ORDER BY CASE WHEN kc.tenant_id = $tenantId THEN 0 ELSE 1 END,
    //              kc.embedding <=> $vector::vector
    const rows = await this.prisma.$queryRawUnsafe<ChunkRow[]>(
      `SELECT kc.id, kc.section, kc.content,
              kd.title AS document_title, kd.species,
              1 - (kc.embedding <=> $1::vector) AS similarity
       FROM knowledge_chunks kc
       JOIN knowledge_documents kd ON kd.id = kc."documentId"
       WHERE kd.status = 'ACTIVE'
         AND kc.scope = 'GLOBAL'
         AND kc.embedding IS NOT NULL
       ORDER BY kc.embedding <=> $1::vector
       LIMIT $2`,
      vectorStr,
      topK
    );

    return rows.map((r) => ({
      id: r.id,
      section: r.section,
      content: r.content,
      documentTitle: r.document_title,
      species: r.species ?? null,
      similarity: Number(r.similarity),
    }));
  }
}

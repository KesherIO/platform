import { KnowledgeSearchResult } from '../../rag/knowledge-search.service';
import { KnowledgeSearchResultDto } from '../dto/knowledge-search-result.dto';

export function toKnowledgeSearchResultDto(
  result: KnowledgeSearchResult
): KnowledgeSearchResultDto {
  return {
    sourceId: result.id,
    documentTitle: result.documentTitle,
    section: result.section,
    content: result.content,
    species: result.species,
    relevanceScore: result.similarity,
  };
}

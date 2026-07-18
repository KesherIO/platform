/** MCP-facing wire shape — decoupled from KnowledgeSearchService's internal type. */
export interface KnowledgeSearchResultDto {
  sourceId: string;
  documentTitle: string;
  section: string;
  content: string;
  species: string | null;
  relevanceScore: number;
}

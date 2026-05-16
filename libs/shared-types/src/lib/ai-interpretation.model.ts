export interface AiInterpretationFlaggedAnalyte {
  code: string;
  name: string;
  value: string;
  flag: 'H' | 'L';
  clinicalMeaning: string;
}

export interface AiInterpretationModel {
  id: string;
  reportId: string;
  caseId: string;
  tenantId: string;
  model: string;
  promptVersion: string;
  summary: string;
  flaggedAnalytes: AiInterpretationFlaggedAnalyte[];
  risks: string[];
  suggestedNextSteps: string[];
  disclaimer: string;
  generatedByUserId?: string;
  retrievedChunkIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

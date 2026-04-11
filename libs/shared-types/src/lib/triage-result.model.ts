import { DiagnosisModel } from './diagnosis.model.js';

export interface TriageResultModel {
  diagnoses: DiagnosisModel[];
  suggestedCatalogItemIds: string[];
}

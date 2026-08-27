import { PatientSpecies } from './case.model.js';

export type AnalyteValueType =
  | 'NUMERIC'
  | 'TEXT'
  | 'LONG_TEXT'
  | 'POSITIVE_NEGATIVE'
  | 'SELECT';

export type TemplateScope = 'PLATFORM' | 'LABORATORY';
export type TemplateStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface ReferenceRangeSnapshot {
  min?: number;
  max?: number;
  displayText: string;
}

export interface ObservationPhrase {
  code: string;
  label: string;
  text: string;
  sectionCode?: string;
}

export interface ResultTemplateAnalyteModel {
  id: string;
  versionId: string;
  sectionId?: string;
  code: string;
  name: string;
  technique?: string;
  valueType: AnalyteValueType;
  unit?: string;
  options: string[];
  sortOrder: number;
  isHeader: boolean;
  formula?: string;
  referenceRange?: ReferenceRangeSnapshot;
}

export interface ResultTemplateSectionModel {
  id: string;
  versionId: string;
  code?: string;
  name: string;
  sortOrder: number;
  analytes: ResultTemplateAnalyteModel[];
}

export interface ResultTemplateVersionModel {
  id: string;
  definitionId: string;
  version: number;
  title: string;
  status: TemplateStatus;
  defaultObservations?: string;
  observationPhrases?: ObservationPhrase[];
  publishedAt?: Date;
  createdAt: Date;
  sections: ResultTemplateSectionModel[];
  analytes: ResultTemplateAnalyteModel[];
}

export interface ResultTemplateDefinitionModel {
  id: string;
  catalogItemCode: string;
  species: PatientSpecies;
  ageMinWeeks: number;
  ageMaxWeeks: number;
  scope: TemplateScope;
  labTenantId?: string;
  ownerKey: string;
  parentDefinitionId?: string;
  activeVersionId?: string;
  activeVersion?: ResultTemplateVersionModel;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @deprecated Use ResultTemplateDefinitionModel + ResultTemplateVersionModel.
 * Kept for backward compatibility with importTemplate() response shape.
 */
export interface ResultTemplateModel {
  id: string;
  catalogItemCode: string;
  species: PatientSpecies;
  ageMinWeeks?: number;
  ageMaxWeeks?: number;
  title: string;
  version: number;
  isActive: boolean;
  defaultObservations?: string;
  observationPhrases?: ObservationPhrase[];
  sections: ResultTemplateSectionModel[];
  analytes: ResultTemplateAnalyteModel[];
}

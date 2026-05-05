import { PatientSpecies } from './case.model.js';

export type AnalyteValueType =
  | 'NUMERIC'
  | 'TEXT'
  | 'POSITIVE_NEGATIVE'
  | 'SELECT';

export interface ReferenceRangeSnapshot {
  min?: number;
  max?: number;
  displayText: string;
}

export interface ResultTemplateAnalyteModel {
  id: string;
  templateId: string;
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
  templateId: string;
  name: string;
  sortOrder: number;
  analytes: ResultTemplateAnalyteModel[];
}

export interface ResultTemplateModel {
  id: string;
  catalogItemId: string;
  species: PatientSpecies;
  ageMinWeeks?: number;
  ageMaxWeeks?: number;
  title: string;
  version: number;
  isActive: boolean;
  defaultObservations?: string;
  sections: ResultTemplateSectionModel[];
  analytes: ResultTemplateAnalyteModel[];
}

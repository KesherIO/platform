import { AnalyteValueType, ReferenceRangeSnapshot } from './result-template.model.js';

export type AnalyteFlag = 'H' | 'L' | 'N';

export type ResultReportStatus = 'DRAFT' | 'RELEASED';

export interface ResultReportAnalyteModel {
  id: string;
  reportId: string;
  templateAnalyteId?: string;

  // Snapshot fields — stable even after template edits
  code: string;
  name: string;
  technique?: string;
  unit?: string;
  valueType: AnalyteValueType;
  sectionName?: string;
  sortOrder: number;
  isHeader: boolean;
  formula?: string;

  // Typed value — only one populated per non-header row
  numericValue?: number;
  textValue?: string;
  booleanValue?: boolean;
  selectValue?: string;

  // Semantic fields — frozen on release
  flag?: AnalyteFlag;
  referenceSnapshot?: ReferenceRangeSnapshot;
}

export interface ResultReportModel {
  id: string;
  orderId: string;
  caseId: string;
  tenantId: string;
  templateId: string;
  status: ResultReportStatus;
  observations?: string;

  // Professional footer
  processedByName?: string;
  processedByRole?: string;
  processedByCredentials?: string;
  approvedByName?: string;
  approvedByRole?: string;
  approvedByCredentials?: string;
  signatureUrl?: string;

  // Export
  pdfUrl?: string;

  // Audit
  releasedAt?: Date;
  releasedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;

  analytes: ResultReportAnalyteModel[];
}

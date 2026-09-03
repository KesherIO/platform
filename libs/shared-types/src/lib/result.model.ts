import {
  AnalyteValueType,
  ReferenceRangeSnapshot,
} from './result-template.model.js';

export type AnalyteFlag = 'H' | 'L' | 'N';

export type ResultReportStatus = 'DRAFT' | 'IN_REVIEW' | 'RELEASED';

export interface ResultReportAnalyteModel {
  id: string;
  reportTestId: string;
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

export interface ResultReportTestModel {
  id: string;
  reportId: string;
  orderedTestId?: string;
  templateVersionId: string;
  templateDefinitionId: string;
  analytes: ResultReportAnalyteModel[];
}

export interface ResultReportModel {
  id: string;
  orderId: string;
  caseId: string;
  tenantId: string;
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

  // Review workflow
  submittedForReviewAt?: Date;
  reviewedAt?: Date;
  reviewNotes?: string;
  correctionNotes?: string;
  reviewedBySignerId?: string;

  // Audit
  releasedAt?: Date;
  releasedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;

  analytes: ResultReportAnalyteModel[];
  tests?: ResultReportTestModel[];
}

// ---------------------------------------------------------------------------
// Clinic-facing released results (only RELEASED data from immutable snapshots)
// ---------------------------------------------------------------------------

export type ClinicReleaseStatus =
  | 'PARTIAL_RESULTS'
  | 'ALL_RELEASED'
  | 'NO_RESULTS';

export interface ReleasedTestResult {
  testName: string;
  catalogItemCode: string | null;
  department: string | null;
  releaseType: string;
  releasedAt: string;
  signerName: string;
  signerTitle?: string;
  signerSpecialty?: string;
  signerUniversity?: string;
  signerRegistrationNumber?: string;
  signerSignatureUrl?: string;
  analystName?: string;
  analystTitle?: string;
  analystSpecialty?: string;
  analystUniversity?: string;
  analystRegistrationNumber?: string;
  analystSignatureUrl?: string;
  reportDisclaimer?: string;
  observations?: string;
  analytes: ResultReportAnalyteModel[];
}

export interface ClinicReleasedResultsModel {
  reportId: string;
  orderId: string;
  caseId: string;
  releaseStatus: ClinicReleaseStatus;
  releasedTests: ReleasedTestResult[];
  pendingTestNames: string[];
  latestReleasedAt: string | null;
}

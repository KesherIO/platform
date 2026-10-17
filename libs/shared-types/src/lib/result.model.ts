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
  /** Absent when the lab keeps amendments silent */
  releaseType?: string;
  /** When the clinic first got this test if the lab keeps amendments silent */
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
  orderingVetId?: string;
  orderingVetName?: string;
  orderingVetLicenseNumber?: string;
  orderingVetIssuingAuthority?: string;
  analytes: ResultReportAnalyteModel[];
}

/** Tests the lab added to the order that are still to come. */
export interface ClinicLabAddedTestsModel {
  testNames: string[];
  /** When the lab last added tests (ISO) */
  addedAt: string;
  /** Another sample is awaited for some of them. The lab creates no pickup:
   * the clinic arranges sending it. */
  awaitingSample: boolean;
}

export interface ClinicReleasedResultsModel {
  reportId: string;
  orderId: string;
  caseId: string;
  releaseStatus: ClinicReleaseStatus;
  releasedTests: ReleasedTestResult[];
  pendingTestNames: string[];
  latestReleasedAt: string | null;
  /** Null when the lab added no tests, or all of them are done or cancelled */
  labAdded: ClinicLabAddedTestsModel | null;
  /** The lab that ran this order has suspended services for the clinic:
   * results stay readable, new AI analysis is refused. */
  labServicesSuspended: boolean;
}

export type ClinicReleaseType = 'PARTIAL' | 'FINAL' | 'AMENDMENT';
export type ReleasePdfStatus =
  | 'PENDING'
  | 'GENERATING'
  | 'COMPLETED'
  | 'FAILED';

/** One entry of GET /results/by-order/:orderId/releases — each release has its own PDF. */
export interface ClinicReleaseSummaryModel {
  id: string;
  releaseSequence: number;
  releaseType: ClinicReleaseType;
  signerName: string;
  releasedAt: string;
  pdfStatus: ReleasePdfStatus;
  testNames: string[];
}

export interface ClinicCurrentReportModel {
  pdfStatus: ReleasePdfStatus;
}

export interface ClinicOrderReleasesModel {
  requisitionNumber: string;
  /** Lab setting. When false, `releases` is empty and the clinic gets `currentReport` */
  showAmendments: boolean;
  releases: ClinicReleaseSummaryModel[];
  /** Silent amendments only: the one PDF with every result at its latest values */
  currentReport: ClinicCurrentReportModel | null;
}

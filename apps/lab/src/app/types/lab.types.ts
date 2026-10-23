// Shared domain types for the lab app.
// All page components import from here — no inline type definitions in components.

export type OrderStatus =
  | 'PENDING'
  | 'READY_FOR_PICKUP'
  | 'COLLECTED'
  | 'RECEIVED_BY_LAB'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'CANCELLED';

export type OrderedTestStatus =
  | 'PENDING'
  | 'READY'
  | 'IN_PROGRESS'
  | 'RESULTS_ENTERED'
  | 'IN_REVIEW'
  | 'COMPLETED'
  | 'BLOCKED'
  | 'CANCELLED';
export type ResultEntryMethod = 'MANUAL' | 'INSTRUMENT' | 'IMPORTED';
export type SpecimenStatus =
  | 'EXPECTED'
  | 'RECEIVED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'MISSING'
  | 'CANCELLED';
export type BlockReason =
  | 'MISSING_SPECIMEN'
  | 'REJECTED_SPECIMEN'
  | 'INSUFFICIENT_VOLUME'
  | 'ANALYZER_UNAVAILABLE'
  | 'REAGENT_UNAVAILABLE'
  | 'REQUIRES_RECOLLECTION'
  | 'MISSING_RESULT_TEMPLATE'
  | 'OTHER';
export type ReportStatus = 'DRAFT' | 'IN_REVIEW' | 'RELEASED';
export type ReleaseType = 'PARTIAL' | 'FINAL' | 'AMENDMENT';
export type AggregateReportStatus =
  | 'PARTIAL_RESULTS'
  | 'ALL_RELEASED'
  | 'AMENDMENT_PENDING';
export type ResultReportTestStatus = 'DRAFT' | 'IN_REVIEW' | 'RELEASED';
export type AmendmentStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'CANCELLED';
export type Priority = 'ROUTINE' | 'URGENT' | 'STAT';

export type DeliveryMethod = 'LAB_PICKUP' | 'CLIENT_DELIVERY';

export type OrderedTestSourceType = 'DIRECT' | 'PACKAGE';

export type PickupStatus =
  | 'REQUESTED'
  | 'ASSIGNED'
  | 'NOTIFIED'
  | 'ACCEPTED'
  | 'COLLECTED'
  | 'IN_TRANSIT'
  | 'RECEIVED_AT_LAB'
  | 'CANCELLED'
  | 'FAILED';

export type PickupProblemReason =
  | 'CLINIC_CLOSED'
  | 'SAMPLE_NOT_READY'
  | 'INCORRECT_ADDRESS'
  | 'UNABLE_TO_CONTACT'
  | 'OTHER';
export type Species =
  | 'DOG'
  | 'CAT'
  | 'EQUINE'
  | 'BOVINE'
  | 'BIRD'
  | 'REPTILE'
  | 'RABBIT'
  | 'OTHER';

export interface OrderedTestSource {
  id: string;
  orderedTestId: string;
  originCatalogItemId: string;
  sourceType: OrderedTestSourceType;
  originalOrderItemKey: string;
  originalOrderItemIndex: number;
  quantity: number;
  originCode: string | null;
  originName: string;
}

export interface OrderedTest {
  id: string;
  orderId: string;
  catalogItemId: string;
  catalogItemName: string;
  catalogItemCode: string | null;
  status: OrderedTestStatus;
  entryMethod: ResultEntryMethod;
  version: number;
  assignedUserId: string | null;
  instrumentId: string | null;
  department: Department | null;
  processingMethod: ProcessingMethod | null;
  analyzerId: string | null;
  claimedAt: string | null;
  blockReason: BlockReason | null;
  blockReasonDetail: string | null;
  receivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  sources: OrderedTestSource[];
}

/** Tubes an order still waits on (only while an unfinished test needs them). */
export interface OutstandingSpecimens {
  awaiting: number;
  missing: number;
  rejected: number;
}

export interface ReceiveSpecimenInput {
  accepted: boolean;
  accessionNumber?: string;
  rejectionReason?: string;
  notes?: string;
  isHemolyzed?: boolean;
  isLipemic?: boolean;
  isIcteric?: boolean;
  isInsufficient?: boolean;
  isContaminated?: boolean;
  isWrongContainer?: boolean;
  isLeaking?: boolean;
}

export interface RequestSampleInput {
  /** Only for a test with no configured specimen requirement */
  specimenType?: string;
  containerType?: string;
  note?: string;
}

/** NO_TEMPLATE tests are added BLOCKED until a template is published */
export type AddedTestOutcome = 'READY' | 'NO_TEMPLATE';

/** Which samples added tests run on (see AddTestsService.SampleMode):
 * pick ACCEPTED ones, or confirm the sample received with an order that has
 * no specimen records; the last two can't add. */
export type AddTestsSampleMode =
  | 'SELECT_ACCEPTED'
  | 'CONFIRM_RECEIVED_ORDER'
  | 'NO_ACCEPTED_SPECIMEN'
  | 'NOT_RECEIVED';

export type SpecimenConditionFlag =
  | 'isHemolyzed'
  | 'isLipemic'
  | 'isIcteric'
  | 'isInsufficient'
  | 'isContaminated'
  | 'isWrongContainer'
  | 'isLeaking';

/** What adding tests to an open order would do (nothing is saved yet). */
export interface AddTestsPreview {
  tests: Array<{
    catalogItemId: string;
    code: string | null;
    name: string;
    origins: string[];
    outcome: AddedTestOutcome;
  }>;
  alreadyOnOrder: Array<{ catalogItemId: string; name: string }>;
  sampleMode: AddTestsSampleMode;
  /** Accepted samples to pick from (SELECT_ACCEPTED only) */
  acceptedSpecimens: AddTestsSpecimen[];
  /** Something new to add, and a sample mode tests can be added in */
  canAdd: boolean;
}

export interface AddTestsSpecimen {
  id: string;
  accessionNumber: string;
  specimenType: string;
  containerType: string;
  conditions: SpecimenConditionFlag[];
}

export interface AddTestsResult {
  added: Array<{ id: string; name: string; status: string }>;
  alreadyOnOrder: AddTestsPreview['alreadyOnOrder'];
  /** The samples the tests were added onto */
  specimens: AddTestsSpecimen[];
  order: { id: string; status: string };
}

export interface Specimen {
  id: string;
  orderId: string;
  labTenantId: string;
  accessionNumber: string;
  specimenType: string;
  containerType: string;
  tubeIndex: number;
  status: SpecimenStatus;
  isHemolyzed: boolean;
  isLipemic: boolean;
  isIcteric: boolean;
  isInsufficient: boolean;
  isContaminated: boolean;
  isWrongContainer: boolean;
  isLeaking: boolean;
  receivedAt: string | null;
  receivedById: string | null;
  rejectionReason: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  markedMissingAt: string | null;
  markedMissingById: string | null;
}

export interface ExpectedSpecimenGroup {
  specimenType: string;
  containerType: string;
  minimumVolumeMl: number | null;
  tests: { id: string; name: string; code: string | null }[];
}

export interface ExpectedSpecimensResponse {
  expectedSpecimenGroups: ExpectedSpecimenGroup[];
  unconfiguredTests: { id: string; name: string; code: string | null }[];
  existingSpecimens: Specimen[];
}

export interface AccessionSpecimenInput {
  specimenType: string;
  containerType: string;
  tubeIndex?: number;
  accessionNumber?: string;
  accepted: boolean;
  /** Not at the lab yet: kept as an expected tube, its tests stay pending */
  awaiting?: boolean;
  rejectionReason?: string;
  notes?: string;
  isHemolyzed?: boolean;
  isLipemic?: boolean;
  isIcteric?: boolean;
  isInsufficient?: boolean;
  isContaminated?: boolean;
  isWrongContainer?: boolean;
  isLeaking?: boolean;
}

export interface PatientCase {
  patientName: string;
  patientSpecies: Species;
  patientSex?: string | null;
  patientBreed: string | null;
  patientAge: number | null;
  patientAgeUnit: string | null;
  patientWeight: number | null;
  ownerName: string;
  ownerPhone: string | null;
  symptoms: string | null;
}

export interface ResultReport {
  id: string;
  status: ReportStatus;
  observations: string | null;
  releasedAt?: string | null;
  submittedForReviewAt?: string | null;
  reviewedAt?: string | null;
  reviewNotes?: string | null;
  correctionNotes?: string | null;
  reviewedBySignerId?: string | null;
  approvedByName?: string | null;
}

export interface LabOrderSummary {
  id: string;
  requisitionNumber: string;
  caseId: string;
  tenantId: string;
  clinicName: string;
  labTenantId: string | null;
  status: OrderStatus;
  priority: Priority;
  deliveryMethod: DeliveryMethod | null;
  orderedTests: OrderedTest[];
  /** Amendments waiting for a reviewer's approval */
  amendmentsInReview: number;
  /** Tubes still needed by an unfinished test */
  outstandingSpecimens?: OutstandingSpecimens;
  clinicNotes: string | null;
  labNotes: string | null;
  sampleType: string | null;
  sampleNotes: string | null;
  patientName: string;
  patientSpecies: Species;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
  collectedAt: string | null;
  receivedByLabAt: string | null;
  completedAt: string | null;
  orderingVetId: string | null;
  orderingVetName: string | null;
  orderingVetLicenseNumber: string | null;
  orderingVetIssuingAuthority: string | null;
}

export interface OrderPickupInfo {
  id: string;
  status: PickupStatus;
  priority: Priority;
  pickupAddress: string | null;
  pickupContactName: string | null;
  pickupContactPhone: string | null;
  pickupInstructions: string | null;
  isAlternateLocation: boolean;
  pickupLocationNotes: string | null;
  requestedPickupTime: string | null;
  messengerId: string | null;
  messenger: {
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
  } | null;
  assignedAt: string | null;
  notifiedAt: string | null;
  acceptedAt: string | null;
  collectedAt: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
  failReason: string | null;
}

export interface LabOrderDetail extends LabOrderSummary {
  case: PatientCase;
  tenant: { name: string; email: string | null; phone: string | null };
  resultReport: ResultReport | null;
  pickup: OrderPickupInfo | null;
  specimens?: Specimen[];
  outstandingSpecimens?: OutstandingSpecimens;
}

/**
 * Lab roles since 2026-10-15: OWNER, ADMIN, REVIEWER, ANALYST, RESULTS_VIEWER,
 * MESSENGER. TECHNICIAN and DATA_ENTRY only appear in old history entries
 * (lab members were moved to ANALYST).
 */
export type LabRole =
  | 'OWNER'
  | 'ADMIN'
  | 'REVIEWER'
  | 'ANALYST'
  | 'RESULTS_VIEWER'
  | 'MESSENGER'
  | 'TECHNICIAN'
  | 'DATA_ENTRY';

export const WEEKDAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export type DayRange = { start: string; end: string } | null;

export type WeeklySchedule = Record<Weekday, DayRange>;

export interface LabMember {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: LabRole;
  joinedAt: string;
  schedule: WeeklySchedule | null;
  canPerformPickups: boolean;
  isCurrentlyScheduled: boolean;
  /** RESULTS_VIEWER only: may also list orders in progress (status, no values) */
  canViewInProgress: boolean;
  /** Roles of the report-signer profile linked to this member, if any */
  signerRoles: LabSignerRole[] | null;
}

export type MembershipEventType =
  | 'MEMBER_ADDED'
  | 'INVITED'
  | 'INVITATION_ACCEPTED'
  | 'ROLE_CHANGED'
  | 'PICKUP_CAPABILITY_CHANGED'
  | 'DEACTIVATED'
  | 'REACTIVATED'
  | 'REMOVED'
  | 'SIGNER_LINKED'
  | 'SIGNER_UNLINKED'
  | 'SIGNER_ROLES_CHANGED'
  | 'SIGNATURE_REPLACED'
  | 'IN_PROGRESS_ACCESS_CHANGED'
  | 'EMAIL_CHANGED'
  | 'PROFILE_CHANGED';

/** `details` of the SIGNER_* / SIGNATURE_REPLACED events */
export interface SignerEventDetails {
  signerId: string;
  signerName: string;
  roles?: LabSignerRole[];
  previousRoles?: LabSignerRole[];
  newRoles?: LabSignerRole[];
  signerRemoved?: boolean;
}

/** `details` of EMAIL_CHANGED (the login email) */
export interface EmailChangeEventDetails {
  previousEmail: string;
  newEmail: string;
}

/** `details` of PROFILE_CHANGED — only the fields that changed */
export interface ProfileChangeEventDetails {
  changes: Partial<
    Record<
      'firstName' | 'lastName' | 'phone',
      { from: string | null; to: string | null }
    >
  >;
}

/** Event `details` — which fields are present depends on `eventType`. */
export type MembershipEventDetails = Partial<SignerEventDetails> &
  Partial<EmailChangeEventDetails> &
  Partial<ProfileChangeEventDetails>;

/** One row of the membership audit log (GET lab/users/history). */
export interface MembershipEvent {
  id: string;
  eventType: MembershipEventType;
  targetUserId: string;
  targetName: string | null;
  targetEmail: string | null;
  /** null = system action (lab setup / onboarding) */
  actorUserId: string | null;
  actorName: string | null;
  previousRole: LabRole | null;
  newRole: LabRole | null;
  previousStatus: string | null;
  newStatus: string | null;
  previousCanPerformPickups: boolean | null;
  newCanPerformPickups: boolean | null;
  previousCanViewInProgress: boolean | null;
  newCanViewInProgress: boolean | null;
  reason: string | null;
  details: MembershipEventDetails | null;
  source: string;
  createdAt: string;
}

export interface MembershipHistoryPage {
  items: MembershipEvent[];
  nextCursor: string | null;
}

export interface MembershipHistoryQuery {
  userId?: string;
  cursor?: string;
  limit?: number;
}

/** Someone removed from the lab (GET lab/users/removed). */
export interface RemovedLabMember {
  userId: string;
  name: string | null;
  email: string | null;
  lastRole: LabRole | null;
  removedAt: string;
  removedByName: string | null;
}

export interface LaboratoryProfile {
  accreditationNumber: string | null;
  directorName: string | null;
  directorCredentials: string | null;
  defaultObservations: string | null;
  reportDisclaimer: string | null;
  vetVerificationRequired?: boolean;
  /** Off = clinics only get the current report, never amendments */
  showAmendmentsToClinic?: boolean;
  signers?: LabSigner[];
}

export interface LabPhoneNumber {
  /** Free text, e.g. "Recepción" (may be empty) */
  label: string;
  number: string;
  /** Reachable on WhatsApp — the clinic app shows a chat button for it */
  whatsapp: boolean;
}

export type LabSignerRole = 'ANALYST' | 'REVIEWER' | 'DATA_ENTRY';

export interface LabSigner {
  id: string;
  /** Team member this signer is; required when roles include ANALYST */
  userId: string | null;
  name: string;
  roles: LabSignerRole[];
  title: string;
  specialty: string;
  university: string;
  registrationNumber: string;
  signatureUrl: string | null;
}

export interface LabContactInfo {
  name: string;
  email: string;
  logoUrl: string | null;
  address: string;
  city: string;
  /** ISO 3166-1 alpha-2 — default country for imported clients */
  country: string | null;
  phoneNumbers: LabPhoneNumber[];
  mapLat: number | null;
  mapLng: number | null;
  timezone: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface LabOrdersQuery {
  status?: string;
  /** "Por revisar" — overrides status */
  forReview?: boolean;
  /** Waiting on an additional, missing or rejected tube — overrides status */
  awaitingSpecimens?: boolean;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

// ---------------------------------------------------------------------------
// Client management
// ---------------------------------------------------------------------------

export type ClientType =
  | 'VETERINARY_CLINIC'
  | 'INDEPENDENT_VET'
  | 'BREEDER'
  | 'FARM'
  | 'SHELTER'
  | 'RESEARCH_ORGANIZATION'
  | 'INDIVIDUAL'
  | 'OTHER';

export type ClientStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED';

export interface ClientOrganization {
  id: string;
  name: string;
  clientType: ClientType | null;
  status: ClientStatus;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  /** ISO 3166-1 alpha-2, e.g. "CO" */
  country: string | null;
  /** Registered legal name ("razón social") */
  legalName: string | null;
  /** e.g. "NIT", "RUT" — see shared/taxIdTypes.ts */
  taxIdType: string | null;
  /** ID number as entered, e.g. "900.123.456-7" */
  taxId: string | null;
  /** This lab's internal notes — never shown to the clinic */
  notes: string | null;
  userCount: number;
  orderCount: number;
  createdAt: string;
}

export interface ClientUser {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  joinedAt: string;
}

export interface ClientOrder {
  id: string;
  requisitionNumber: string;
  status: OrderStatus;
  priority: Priority;
  patientName: string;
  patientSpecies: string;
  createdAt: string;
}

export interface ClientInvitation {
  id: string;
  email: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  used: boolean;
  createdAt: string;
}

export interface ClientDetail extends ClientOrganization, CollectionSettings {
  updatedAt: string;
  laboratoryName: string | null;
  users: ClientUser[];
  recentOrders: ClientOrder[];
  invitation: ClientInvitation | null;
}

export interface CreateClientForm {
  name: string;
  clientType: ClientType;
  primaryContactName: string;
  primaryContactEmail: string;
  phone: string;
  address: string;
  city: string;
  country: string;
}

export interface CreateClientResponse {
  clientId: string;
  onboardingToken: string;
  onboardingLink: string;
  expiresAt: string;
}

export interface ClientsQuery {
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

/** GET lab/clients/export — same filters as the list, unpaged (plan B9). */
export interface ClientsExportQuery {
  status?: string;
  search?: string;
  includeNotes?: boolean;
}

/** One exported client. `notes` is only present when includeNotes was set. */
export interface ClientExportRow {
  /** Tenant id — the match key a future update-import can use */
  id: string;
  name: string;
  legalName: string | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  clientType: ClientType | null;
  taxIdType: string | null;
  /** As entered, never the normalized copy */
  taxId: string | null;
  status: ClientStatus;
  notes?: string | null;
}

export interface ClientsExportResponse {
  rows: ClientExportRow[];
}

// ---------------------------------------------------------------------------
// Client bulk import (docs/CLIENT_BULK_IMPORT_PLAN.md)
// ---------------------------------------------------------------------------

/** A client field a file column can be mapped to. */
export type ImportField =
  | 'name'
  | 'legalName'
  | 'primaryContactName'
  | 'primaryContactEmail'
  | 'phone'
  | 'address'
  | 'city'
  | 'country'
  | 'clientType'
  | 'taxIdType'
  | 'taxId'
  | 'notes';

/** One column's mapping: a field, or ignored. */
export type ColumnMapping = ImportField | 'ignore';

/** How a spreadsheet cell held its value (A6) — CSV cells are always 'text'. */
export type CellSource =
  | 'text'
  /** number with a zero-padding format, padded to the format's width */
  | 'padded_number'
  /** number, safe integer ≤ 15 digits — leading zeros may be lost */
  | 'number'
  /** number Excel may have rounded (> 15 significant digits / unsafe) */
  | 'unsafe_number';

export interface SheetCell {
  text: string;
  source: CellSource;
}

export interface ParsedSheet {
  headers: string[];
  /** Data rows (no header, no fully empty rows), one cell per header */
  rows: SheetCell[][];
  /** 1-based row number in the file for each entry of `rows` */
  rowNumbers: number[];
}

/** Values of one preview row, after mapping and normalization. */
export type ImportRowValues = Record<Exclude<ImportField, 'notes'>, string> & {
  notes: string;
};

/** Field-level problem found in the browser or by the server. */
export type ImportIssueCode =
  // server codes (POST /lab/clients/import)
  | 'REQUIRED'
  | 'INVALID'
  | 'INVALID_EMAIL'
  | 'TOO_LONG'
  | 'INVALID_COUNTRY'
  | 'INVALID_CLIENT_TYPE'
  | 'INVALID_TAX_ID_TYPE'
  | 'INVALID_TAX_ID'
  | 'TAX_ID_INCOMPLETE'
  | 'UNKNOWN_FIELD'
  // browser-only codes (A6, A7)
  | 'NUMBER_ROUNDED'
  | 'SCIENTIFIC_NOTATION'
  | 'NUMBER_STORED'
  | 'APOSTROPHE_PREFIX';

export interface ImportIssue {
  field: ImportField | string;
  code: ImportIssueCode;
  /** Warnings can be confirmed; errors must be fixed */
  severity: 'error' | 'warning';
}

export type ImportSkipReason =
  | 'EMAIL_EXISTS'
  | 'TAX_ID_EXISTS'
  | 'DUPLICATE_IN_FILE';

/** Per-row result from POST /lab/clients/import. */
export type ImportRowResult =
  | { rowNumber: number; status: 'created'; clientId: string }
  | { rowNumber: number; status: 'would_create' }
  | { rowNumber: number; status: 'skipped'; reason: ImportSkipReason }
  | {
      rowNumber: number;
      status: 'invalid';
      errors: { field: string; code: ImportIssueCode }[];
    }
  | { rowNumber: number; status: 'conflict'; reason: 'BATCH_ROW_MISMATCH' }
  | { rowNumber: number; status: 'failed'; reason: 'UNEXPECTED' };

export interface ImportClientsResponse {
  results: ImportRowResult[];
  summary: {
    created: number;
    wouldCreate: number;
    skipped: number;
    invalid: number;
    conflict: number;
    failed: number;
  };
}

/** One row as sent to the API. */
export interface ImportRequestRow {
  rowNumber: number;
  name: string;
  clientType: string;
  primaryContactEmail: string;
  primaryContactName?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
  legalName?: string;
  taxIdType?: string;
  taxId?: string;
  notes?: string;
}

export interface ImportClientsRequest {
  importBatchId: string;
  dryRun?: boolean;
  rows: ImportRequestRow[];
}

/** One row of the import preview. */
export interface ImportPreviewRow {
  rowNumber: number;
  values: ImportRowValues;
  /** Where each value came from in the file — drives the A6 number checks */
  sources: Partial<Record<ImportField, CellSource>>;
  excluded: boolean;
  /** `${field}:${code}` of warnings the user confirmed */
  confirmedWarnings: string[];
  /** Last dry-run result and the values it was checked with (A4) */
  check: { key: string; result: ImportRowResult } | null;
  /** Final import result, or 'not_confirmed' if its group never came back */
  imported: ImportRowResult | 'not_confirmed' | null;
}

/** Preview / summary buckets (A4) — same words before and after import. */
export type ImportBucket =
  | 'will_create'
  | 'created'
  | 'checking'
  | 'needs_review'
  | 'already_in_lab'
  | 'duplicate_in_file'
  | 'invalid'
  | 'excluded'
  | 'failed'
  | 'not_confirmed';

export type CatalogItemKind = 'TEST' | 'PACKAGE';
export type ResultType = 'NUMERIC' | 'TEXT' | 'POSITIVE_NEGATIVE';

export interface CatalogItem {
  id: string;
  kind: CatalogItemKind;
  name: string;
  code?: string;
  /** The lab's own billing-system code (set by Owner/Admin) */
  billingCode?: string;
  /** TEST only: exists only inside packages — hidden from clinics */
  packageComponentOnly?: boolean;
  description?: string;
  category?: string;
  turnaroundHours?: number;
  resultType?: ResultType;
  unit?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  components?: CatalogItem[]; // PACKAGE only — constituent tests
}

export type CatalogSort =
  | 'name_asc'
  | 'name_desc'
  | 'created_desc'
  | 'created_asc';

export interface CatalogQuery {
  search?: string;
  kind?: CatalogItemKind;
  sort?: CatalogSort;
  page?: number;
  pageSize?: number;
}

export interface CatalogCounts {
  all: number;
  TEST: number;
  PACKAGE: number;
}

export interface CatalogListResponse extends PaginatedResponse<CatalogItem> {
  counts: CatalogCounts;
}

export interface ImportCatalogItemInput {
  kind: CatalogItemKind;
  name: string;
  code?: string;
  billingCode?: string;
  category?: string;
  turnaroundHours?: number;
  resultType?: ResultType;
  unit?: string;
  description?: string;
  componentCodes?: string[];
}

// ---------------------------------------------------------------------------
// Billing codes and billing export
// ---------------------------------------------------------------------------

export interface BillingRow {
  fecha: string;
  entidad: string;
  item: string;
  cantidad: number;
  patientName: string;
}

export type MappingStatus = 'SUGGESTED' | 'REVIEW' | 'NO_MATCH' | 'INVALID';
export type MappingReason =
  | 'DUPLICATE_DESCRIPTION'
  | 'DUPLICATE_CODE'
  | 'MULTIPLE_CANDIDATES'
  | 'CLAIMED_BY_OTHER_ROW'
  | 'CODE_ASSIGNED_ELSEWHERE'
  | 'NOT_EXACT';

export interface MappingCandidate {
  catalogItemId: string;
  kind: CatalogItemKind;
  internalCode: string | null;
  name: string;
  currentBillingCode: string | null;
  matchedBy: 'NAME' | 'CODE' | 'SIMILAR';
  score: number;
}

export interface MappingSuggestion {
  index: number;
  code: string;
  description: string;
  status: MappingStatus;
  reasons: MappingReason[];
  suggestedCatalogItemId: string | null;
  candidates: MappingCandidate[];
}

export interface MappingAssignment {
  catalogItemId: string;
  billingCode: string;
}

export interface BillingMissingCode {
  catalogItemId: string;
  name: string;
  internalCode: string | null;
  kind: CatalogItemKind;
  reason: 'NO_BILLING_CODE' | 'ITEM_NOT_IN_CATALOG';
  lineCount: number;
  orderCount: number;
}

export interface BillingPreviousExport {
  exportId: string;
  exportedAt: string;
  item: string;
}

export interface BillingPreviewLine {
  orderId: string;
  requisitionNumber: string;
  lineKey: string;
  fecha: string;
  entidad: string;
  item: string | null;
  cantidad: number;
  patientName: string;
  serviceName: string;
  kind: CatalogItemKind;
  catalogItemId: string;
  missing: BillingMissingCode['reason'] | null;
  /** CATALOG = the item's own code; DELETED_ITEM = a reviewed code for a deleted item */
  codeSource: 'CATALOG' | 'DELETED_ITEM' | null;
  previouslyExported: BillingPreviousExport | null;
  orderPreviouslyExported: boolean;
}

export interface BillingWithdrawnLine {
  orderId: string;
  requisitionNumber: string;
  lineKey: string;
  item: string;
  exportId: string;
  exportedAt: string;
  reason: 'ORDER_CANCELLED' | 'ITEM_CANCELLED' | 'NOT_BILLABLE';
}

export interface BillingPreview {
  range: { dateFrom: string; dateTo: string };
  timezone: string;
  onlyNew: boolean;
  summary: {
    orders: number;
    lines: number;
    alreadyExported: number;
    notExportedBefore: number;
    missingCode: number;
    cancelledOrderLines: number;
    cancelledItemLines: number;
  };
  lines: BillingPreviewLine[];
  linesTruncated: boolean;
  missingCodes: BillingMissingCode[];
  withdrawnSinceExport: BillingWithdrawnLine[];
  canGenerate: boolean;
}

export interface BillingExportFile {
  exportId: string;
  createdAt: string;
  dateFrom: string;
  dateTo: string;
  timezone: string;
  onlyNew: boolean;
  rows: BillingRow[];
}

export interface BillingExportSummary {
  id: string;
  createdAt: string;
  createdByName: string;
  dateFrom: string;
  dateTo: string;
  timezone: string;
  onlyNew: boolean;
  lineCount: number;
}

// ---------------------------------------------------------------------------
// Sample collection & pickup workflow
// ---------------------------------------------------------------------------

export interface PickupSummary {
  id: string;
  orderId: string;
  requisitionNumber: string | null;
  patientName: string | null;
  clinicName: string | null;
  status: PickupStatus;
  priority: Priority;
  pickupAddress: string | null;
  pickupContactName: string | null;
  pickupContactPhone: string | null;
  pickupInstructions: string | null;
  isAlternateLocation: boolean;
  pickupLocationNotes: string | null;
  requestedPickupTime: string | null;
  messengerId: string | null;
  messengerName: string | null;
  messengerPhone: string | null;
  assignedAt: string | null;
  notifiedAt: string | null;
  acceptedAt: string | null;
  collectedAt: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
  failReason: string | null;
  createdAt: string;
}

export interface TimelineEvent {
  id: string;
  eventType: string;
  actorName: string | null;
  description: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface MessengerInfo {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  role: LabRole;
  activePickupCount: number;
  schedule: WeeklySchedule | null;
  isCurrentlyScheduled: boolean;
}

export interface CollectionsQuery {
  status?: string;
  search?: string;
  messengerId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export interface CollectionSettings {
  pickupEnabled: boolean;
  defaultDeliveryMethod: DeliveryMethod | null;
  pickupAddress: string | null;
  pickupContactName: string | null;
  pickupContactPhone: string | null;
  collectionHours: string | null;
  pickupInstructions: string | null;
}

// ---------------------------------------------------------------------------
// Lab configuration — Analyzers & Test Config
// ---------------------------------------------------------------------------

export type Department =
  | 'HEMATOLOGY'
  | 'CHEMISTRY'
  | 'URINALYSIS'
  | 'PARASITOLOGY'
  | 'SEROLOGY'
  | 'ENDOCRINOLOGY'
  | 'MICROBIOLOGY'
  | 'OTHER';

export type ProcessingMethod = 'MANUAL' | 'ANALYZER';

export type TemplateScope = 'PLATFORM' | 'LABORATORY';
export type TemplateStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export type AnalyteValueType =
  | 'NUMERIC'
  | 'TEXT'
  | 'LONG_TEXT'
  | 'POSITIVE_NEGATIVE'
  | 'SELECT';

export interface Analyzer {
  id: string;
  name: string;
  model: string | null;
  manufacturer: string | null;
  department: Department;
  connectionType: string;
  isActive: boolean;
  /** Match this analyzer's results to orders by the order's analyzer number */
  autoMatchOrders: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SpecimenRequirement {
  id: string;
  specimenType: string;
  containerType: string;
  minimumVolumeMl: number | null;
  requirementGroupKey: string;
  specimenRole: string | null;
  isAlternativeWithinGroup: boolean;
  notes: string | null;
  sortOrder: number;
}

export interface LabTestConfiguration {
  id: string;
  catalogItemId: string;
  department: Department;
  defaultProcessingMethod: ProcessingMethod;
  allowedProcessingMethods: ProcessingMethod[];
  defaultAnalyzerId: string | null;
  catalogItem: CatalogItem;
  defaultAnalyzer: Analyzer | null;
  specimenRequirements: SpecimenRequirement[];
  createdAt: string;
  updatedAt: string;
}

export interface GenerateTestConfigsResult {
  created: number;
  skipped: number;
  unmappedCategories: string[];
}

// ---------------------------------------------------------------------------
// Template versioning
// ---------------------------------------------------------------------------

export interface ReferenceRange {
  min?: number;
  max?: number;
  displayText: string;
}

export interface TemplateAnalyte {
  id: string;
  versionId: string;
  sectionId: string | null;
  code: string;
  name: string;
  technique: string | null;
  valueType: AnalyteValueType;
  unit: string | null;
  options: string[];
  sortOrder: number;
  isHeader: boolean;
  isRequired: boolean;
  formula: string | null;
  referenceRange: ReferenceRange | null;
}

export interface ObservationPhrase {
  code: string;
  label: string;
  text: string;
  sectionCode?: string;
}

export interface TemplateSection {
  id: string;
  versionId: string;
  code?: string;
  name: string;
  sortOrder: number;
  analytes: TemplateAnalyte[];
}

export interface TemplateVersion {
  id: string;
  definitionId: string;
  version: number;
  title: string;
  status: TemplateStatus;
  defaultObservations: string | null;
  observationPhrases?: ObservationPhrase[] | null;
  publishedAt: string | null;
  createdAt: string;
  sections?: TemplateSection[];
  analytes?: TemplateAnalyte[];
  formulaWarnings?: FormulaValidationError[];
}

export interface FormulaValidationError {
  analyteCode: string;
  analyteName: string;
  sectionName: string | null;
  formula: string;
  errors: Array<{
    code: string;
    message: string;
    ref?: string;
  }>;
}

export interface TemplateDefinition {
  id: string;
  catalogItemCode: string;
  species: Species | 'ANY';
  ageMinWeeks: number;
  ageMaxWeeks: number;
  scope: TemplateScope;
  labTenantId: string | null;
  ownerKey: string;
  parentDefinitionId: string | null;
  activeVersionId: string | null;
  activeVersion: TemplateVersion | null;
  versions?: TemplateVersion[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Worklist
// ---------------------------------------------------------------------------

export interface WorklistItem {
  id: string;
  catalogItemName: string;
  catalogItemCode: string | null;
  status: OrderedTestStatus;
  department: Department | null;
  processingMethod: ProcessingMethod | null;
  version: number;
  claimedAt: string | null;
  startedAt: string | null;
  createdAt: string;
  blockReason: BlockReason | null;
  blockReasonDetail: string | null;
  orderId: string;
  requisitionNumber: string;
  /** What the technician types into the analyzer (REQ-2026-000012 → 26000012); null for legacy formats */
  analyzerNumber: string | null;
  orderPriority: Priority;
  orderStatus: OrderStatus;
  patientName: string;
  patientSpecies: string;
  ownerName: string;
  clinicName: string;
  assignedUserId: string | null;
  assignedUserName: string | null;
  analyzerName: string | null;
  accessionNumber: string | null;
  packageOriginId: string | null;
  packageOriginName: string | null;
}

export interface WorklistQuery {
  department?: string;
  status?: string;
  assignmentFilter?: 'unassigned' | 'mine' | 'all';
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export interface DepartmentCount {
  department: Department;
  ready: number;
  inProgress: number;
  total: number;
}

export interface WorklistCountsResponse {
  departments: DepartmentCount[];
  totalReady: number;
  noDepartment: { ready: number; inProgress: number; total: number } | null;
}

// ---------------------------------------------------------------------------
// Operational Readiness
// ---------------------------------------------------------------------------

export type ReadinessReasonCode = 'CATALOG_ITEM_INACTIVE';

export interface ReadinessCheck {
  code: ReadinessReasonCode;
  message: string;
  resourceId?: string;
}

export interface ReadinessResult {
  catalogItemId: string;
  catalogItemCode: string | null;
  catalogItemName: string;
  ready: boolean;
  reasons: ReadinessCheck[];
}

export interface BulkReadinessResponse {
  items: ReadinessResult[];
  summary: { total: number; ready: number; notReady: number };
}

// ---------------------------------------------------------------------------
// Release & Amendment types
// ---------------------------------------------------------------------------

export interface ReleaseTestInfo {
  catalogItemName: string;
  catalogItemCode: string | null;
  amendsReleaseTestId: string | null;
}

export interface ReleaseInfo {
  id: string;
  releaseSequence: number;
  releaseType: ReleaseType;
  signerName: string;
  releasedAt: string;
  pdfStatus: string;
  pdfUrl: string | null;
  tests: ReleaseTestInfo[];
  artifacts: Array<{
    status: string;
    storageUrl: string | null;
  }>;
  orderingVetId: string | null;
  orderingVetName: string | null;
  orderingVetLicenseNumber: string | null;
  orderingVetIssuingAuthority: string | null;
}

export interface ReleaseHistoryResponse {
  releases: ReleaseInfo[];
  aggregateReportStatus: AggregateReportStatus;
}

export interface AmendmentAnalyteInfo {
  id: string;
  code: string;
  name: string;
  sectionName: string | null;
  sortOrder: number;
  isHeader: boolean;
  valueType: string;
  numericValue: number | null;
  textValue: string | null;
  booleanValue: boolean | null;
  selectValue: string | null;
  unit: string | null;
  formula: string | null;
  /** SELECT values / TEXT suggestions, from the template version */
  options: string[];
  flag: string | null;
  referenceSnapshot: unknown;
}

/** One editable value in a draft amendment (only the value fields). */
export type AmendmentValue = Pick<
  AmendmentAnalyteInfo,
  'numericValue' | 'textValue' | 'booleanValue' | 'selectValue'
>;

/** An open (DRAFT / IN_REVIEW) amendment, used to resume it after a reload. */
export interface ActiveAmendmentSummary {
  amendmentId: string;
  status: AmendmentStatus;
  reason: string;
  orderedTestId: string;
}

export interface AmendmentInfo {
  id: string;
  status: AmendmentStatus;
  reason: string;
  reportTestId: string;
  sourceReleaseId: string;
  analytes: AmendmentAnalyteInfo[];
  reportTest?: {
    id: string;
    orderedTestId: string;
    templateVersion?: { title: string };
  };
}

export interface CurrentResultAnalyte {
  code: string;
  name: string;
  sectionName: string | null;
  sortOrder: number;
  isHeader: boolean;
  valueType: string;
  numericValue: number | null;
  textValue: string | null;
  booleanValue: boolean | null;
  selectValue: string | null;
  unit: string | null;
  flag: string | null;
  referenceSnapshot: unknown;
}

export interface CurrentResultTest {
  catalogItemName: string;
  catalogItemCode: string | null;
  releaseSequence: number;
  releaseType: ReleaseType;
  releasedAt: string;
  signerName: string;
  analytes: CurrentResultAnalyte[];
  orderingVetId: string | null;
  orderingVetName: string | null;
  orderingVetLicenseNumber: string | null;
  orderingVetIssuingAuthority: string | null;
}

export interface CurrentResultsResponse {
  tests: CurrentResultTest[];
}

// ---------------------------------------------------------------------------
// Resultados search (GET lab/results/*)
// ---------------------------------------------------------------------------

export type ResultsView = 'released' | 'in_progress';

export interface ResultsSearchQuery {
  view: ResultsView;
  clinicId?: string;
  dateFrom?: string;
  dateTo?: string;
  patient?: string;
  analyteCode?: string;
  page?: number;
  pageSize?: number;
}

/** The searched analyte's released value on a row */
export interface ResultRowAnalyte {
  code: string;
  name: string | null;
  valueType: string | null;
  numericValue: number | null;
  textValue: string | null;
  booleanValue: boolean | null;
  selectValue: string | null;
  unit: string | null;
  flag: string | null;
}

/** One current released test */
export interface ReleasedResultRow {
  id: string;
  releaseId: string;
  releaseSequence: number;
  releaseType: ReleaseType;
  releasedAt: string;
  amended: boolean;
  orderId: string;
  requisitionNumber: string;
  clinicId: string;
  clinicName: string;
  patientName: string;
  patientSpecies: string;
  ownerName: string;
  testName: string;
  testCode: string | null;
  analyte: ResultRowAnalyte | null;
}

/** One open test — status only, never values */
export interface InProgressResultRow {
  id: string;
  status: OrderedTestStatus;
  orderId: string;
  requisitionNumber: string;
  orderedAt: string;
  clinicId: string;
  clinicName: string;
  patientName: string;
  patientSpecies: string;
  ownerName: string;
  testName: string;
  testCode: string | null;
}

export interface ResultsSearchResponse<Row> {
  data: Row[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  view: ResultsView;
  /** The date range actually applied (defaults filled in by the API) */
  dateFrom?: string;
  dateTo?: string;
}

export interface ResultsClinic {
  id: string;
  name: string;
}

export interface ResultsAnalyte {
  code: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Vet verification
// ---------------------------------------------------------------------------

export type VetVerificationStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'REVOKED'
  | 'EXPIRED';

export type VetVerificationEventType =
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'RESUBMITTED'
  | 'REVOKED'
  | 'EXPIRED'
  | 'DOCUMENT_VIEWED';

export interface VetVerificationSummary {
  id: string;
  status: VetVerificationStatus;
  vetLegalName: string;
  licenseNumber: string;
  issuingCountry: string;
  issuingAuthority: string | null;
  licenseExpiresAt: string | null;
  initiatingClinicName: string;
  submittedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
}

export interface VetVerificationAuditEvent {
  id: string;
  eventType: VetVerificationEventType;
  actorName: string | null;
  reason: string | null;
  createdAt: string;
}

export interface VetVerificationDetail {
  id: string;
  status: VetVerificationStatus;
  vetProfileId: string;
  vetLegalName: string;
  vetEmail: string | null;
  licenseNumber: string;
  issuingCountry: string;
  issuingAuthority: string | null;
  licenseExpiresAt: string | null;
  initiatingClinicName: string;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedByName: string | null;
  rejectionReason: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  duplicateLicenseDetected: boolean;
  profileChangedAfterApproval: boolean;
  events: VetVerificationAuditEvent[];
}

export interface VetVerificationsQuery {
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

// ---------------------------------------------------------------------------
// Lab onboarding (public, unauthenticated flow)
// ---------------------------------------------------------------------------

export interface VerifyLabTokenResponse {
  valid: boolean;
  type?: string;
  labName?: string;
  labEmail?: string;
  reason?: 'expired' | 'used' | 'not_found' | 'revoked';
}

export interface CompleteLabOnboardingRequest {
  token: string;
  adminFirstName: string;
  adminLastName: string;
  adminEmail: string;
  password: string;
  labName: string;
}

export interface CompleteLabOnboardingResponse {
  tenantId: string;
  userId: string;
}

// ── Notifications ─────────────────────────────────────────────────────────────

export type NotificationType =
  | 'TESTS_ADDED'
  | 'ADDITIONAL_SAMPLE_REQUIRED'
  | 'RESULTS_RELEASED'
  | 'RESULTS_AMENDED'
  | 'PICKUP_ASSIGNED'
  | 'PICKUP_UNASSIGNED'
  | 'PICKUP_CANCELLED';

export interface NotificationParams {
  requisitionNumber?: string;
  caseId?: string;
  testNames?: string[];
  releaseType?: 'PARTIAL' | 'FINAL';
  assignedAt?: string;
}

/** One entry in the user's own inbox (GET /lab/notifications). */
export interface LabNotification {
  id: string;
  type: NotificationType;
  tenantId: string;
  orderId?: string;
  pickupId?: string;
  params: NotificationParams;
  patientName?: string;
  /** In-app path to open */
  link: string;
  readAt?: string;
  createdAt: string;
}

export interface NotificationListResponse {
  items: LabNotification[];
  nextCursor: string | null;
}

export interface NotificationUnreadCount {
  count: number;
  otherTenants: { tenantId: string; count: number }[];
}

// ---------------------------------------------------------------------------
// Analyzer connector (apps/connector → /api/lab/instruments)
// ---------------------------------------------------------------------------

export type InstrumentMessageStatus =
  | 'RECEIVED'
  | 'INCOMPLETE'
  | 'DUPLICATE'
  | 'UNMATCHED'
  | 'AMBIGUOUS'
  | 'NEEDS_REVIEW'
  | 'IMPORTED'
  | 'DISMISSED'
  | 'FAILED';

export type InstrumentQueueView = 'review' | 'incomplete' | 'attention' | 'all';

export interface InstrumentMessageSummary {
  id: string;
  status: InstrumentMessageStatus;
  /** Why a person has to look: UNMATCHED, CONTENT_CHANGED, EXPIRED_REAGENT, UNIT_MISMATCH:HGB:g/L … */
  reasons: string[];
  isComplete: boolean;
  incompleteReason: string | null;
  /** The analyzer's own sample ID — not an order number */
  sampleId: string | null;
  controlId: string | null;
  observationTime: string | null;
  receivedAtConnector: string;
  createdAt: string;
  /** OBX-13 E/e: values edited on the analyzer */
  hasAnalyzerEdits: boolean;
  /** OBX-13 O: expired reagent — kept separate from edits */
  hasExpiredReagent: boolean;
  importedCount: number;
  resolvedAt: string | null;
  orderId: string | null;
  /** How the order was found: an explicit link, or the order's analyzer number */
  matchedBy: 'SAMPLE_LINK' | 'ORDER_NUMBER' | null;
  analyzer: { id: string; name: string };
  order: { requisitionNumber: string } | null;
}

/** Order page: the number to type into the analyzers, and what each analyzer sent. */
export interface OrderAnalyzerStatus {
  analyzerNumber: string | null;
  analyzers: Array<{
    analyzerId: string;
    analyzerName: string;
    state: 'IMPORTED' | 'NEEDS_REVIEW' | 'WAITING';
    messageId: string | null;
    reasons: string[];
    at: string | null;
  }>;
}

export interface InstrumentParameter {
  code: string;
  valueType: string;
  value: string;
  unit: string;
  referenceRange: string;
  abnormalFlag: string;
  userFlag: string;
}

export interface InstrumentMessageDiff {
  changed: Array<{
    code: string;
    before: InstrumentParameter;
    after: InstrumentParameter;
  }>;
  added: InstrumentParameter[];
  removed: InstrumentParameter[];
  imagesChanged: string[];
  patientChanged: Array<{
    field: string;
    before: string | null;
    after: string | null;
  }>;
}

export interface InstrumentMessageDetail extends InstrumentMessageSummary {
  sha256: string;
  byteLength: number;
  remoteAddress: string | null;
  processingError: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  importedAt: string | null;
  parsed: {
    patient: {
      sampleId: string | null;
      name: string | null;
      speciesText: string | null;
      sex: string | null;
    };
    parameters: InstrumentParameter[];
    images: Array<{ code: string }>;
    import?: {
      plan: Array<{
        analyzerCode: string;
        analyzerUnit: string;
        rawValue: string;
        analyteCode: string;
        multiplier: number;
        value: number;
      }>;
      ignored: Array<{ code: string; reason: string }>;
      /** fields the result template computes by formula: the analyzer's figure was not used */
      formulaComputed?: Array<{
        analyteCode: string;
        analyzerCode: string;
        analyzerValue: number;
      }>;
    };
  } | null;
  diff: InstrumentMessageDiff | null;
  previousMessageId: string | null;
  orderedTestId: string | null;
  order: { id: string; requisitionNumber: string; status: string } | null;
  history: Array<{
    id: string;
    status: InstrumentMessageStatus;
    controlId: string | null;
    messageTime: string | null;
    createdAt: string;
    isComplete: boolean;
  }>;
  approvableReasons: string[];
  /** What the importer would do under the CURRENT mappings (null for incomplete transfers) */
  mappingPreview: InstrumentMappingPreview | null;
}

export interface InstrumentMappingPreview {
  numericParameters: number;
  importable: Array<{
    analyzerCode: string;
    analyzerUnit: string;
    rawValue: string;
    catalogItemCode: string;
    analyteCode: string;
    multiplier: number;
    value: number;
  }>;
  unitMismatches: Array<{ code: string; unit: string; mappedUnits: string[] }>;
  notMapped: string[];
  notImported: Array<{ code: string; reason: string }>;
  /** fewer values will be imported than the analyzer sent */
  isPartial: boolean;
}

export interface InstrumentQueuePage {
  items: InstrumentMessageSummary[];
  nextCursor: string | null;
}

export interface ConnectorCredentialSummary {
  id: string;
  name: string;
  analyzerId: string;
  tokenPrefix: string;
  createdAt: string;
  lastSeenAt: string | null;
  lastSeenAddress: string | null;
  revokedAt: string | null;
  analyzer: { name: string };
}

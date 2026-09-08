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
  | 'MISSING';
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
}

export type LabRole = 'OWNER' | 'ADMIN' | 'TECHNICIAN' | 'MESSENGER';

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
}

export interface LaboratoryProfile {
  accreditationNumber: string | null;
  directorName: string | null;
  directorCredentials: string | null;
  defaultObservations: string | null;
  reportDisclaimer: string | null;
  signatureUrl: string | null;
  vetVerificationRequired?: boolean;
  signers?: LabSigner[];
}

export type PhoneLabel = 'whatsapp' | 'commercial' | 'personal' | 'other';

export interface LabPhoneNumber {
  label: PhoneLabel | string;
  number: string;
}

export type LabSignerRole = 'ANALYST' | 'REVIEWER' | 'DATA_ENTRY';

export interface LabSigner {
  id: string;
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

export type CatalogItemKind = 'TEST' | 'PACKAGE';
export type ResultType = 'NUMERIC' | 'TEXT' | 'POSITIVE_NEGATIVE';

export interface CatalogItem {
  id: string;
  kind: CatalogItemKind;
  name: string;
  code?: string;
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

export interface CatalogQuery {
  search?: string;
  kind?: CatalogItemKind;
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
  category?: string;
  turnaroundHours?: number;
  resultType?: ResultType;
  unit?: string;
  description?: string;
  componentCodes?: string[];
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
  flag: string | null;
  referenceSnapshot: unknown;
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

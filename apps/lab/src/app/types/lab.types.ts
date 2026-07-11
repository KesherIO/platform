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

export type OrderedTestStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type ResultEntryMethod = 'MANUAL' | 'INSTRUMENT' | 'IMPORTED';
export type ReportStatus = 'DRAFT' | 'RELEASED';
export type Priority = 'ROUTINE' | 'URGENT' | 'STAT';
export type Species = 'DOG' | 'CAT' | 'EQUINE' | 'BOVINE' | 'BIRD' | 'REPTILE' | 'RABBIT' | 'OTHER';

export interface OrderedTest {
  id: string;
  orderId: string;
  catalogItemId: string;
  catalogItemName: string;
  catalogItemCode: string | null;
  status: OrderedTestStatus;
  entryMethod: ResultEntryMethod;
  assignedUserId: string | null;
  instrumentId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
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
  receivedByLabAt: string | null;
  completedAt: string | null;
}

export interface LabOrderDetail extends LabOrderSummary {
  case: PatientCase;
  tenant: { name: string; email: string | null; phone: string | null };
  resultReport: ResultReport | null;
}

export type LabRole = 'ADMIN' | 'TECHNICIAN' | 'VET' | 'RECEPTIONIST';

export interface LabMember {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: LabRole;
  joinedAt: string;
}

export interface LaboratoryProfile {
  accreditationNumber: string | null;
  directorName: string | null;
  directorCredentials: string | null;
  defaultObservations: string | null;
  signatureUrl: string | null;
}

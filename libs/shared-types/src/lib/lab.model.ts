export type OrderedTestStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

export type ResultEntryMethod = 'MANUAL' | 'INSTRUMENT' | 'IMPORTED';

export interface OrderedTestModel {
  id: string;
  orderId: string;
  catalogItemId: string;
  status: OrderedTestStatus;
  entryMethod: ResultEntryMethod;
  catalogItemCode: string | null;
  catalogItemName: string;
  assignedUserId: string | null;
  instrumentId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LaboratoryProfileModel {
  id: string;
  tenantId: string;
  accreditationNumber: string | null;
  directorName: string | null;
  directorCredentials: string | null;
  signatureUrl: string | null;
  defaultObservations: string | null;
  phoneNumbers?: LabPhoneNumber[];
  mapLat?: number;
  mapLng?: number;
  signers?: LabSignerModel[];
  createdAt: Date;
  updatedAt: Date;
}

export interface LabPhoneNumber {
  label: string;
  number: string;
}

export type LabSignerRole = 'ANALYST' | 'REVIEWER' | 'DATA_ENTRY';

export interface LabSignerModel {
  id: string;
  name: string;
  roles: LabSignerRole[];
  title: string;
  specialty: string;
  university: string;
  registrationNumber?: string;
  signatureUrl: string | null;
}

export interface ClinicLabConnectionModel {
  id: string;
  clinicId: string;
  labId: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Lab-side order view: full order with its ordered tests
export interface LabOrderModel {
  id: string;
  requisitionNumber: string;
  caseId: string;
  tenantId: string; // clinic tenant
  clinicName: string; // denormalized for display
  labTenantId: string | null;
  status: string;
  priority: string;
  orderedItems: unknown[];
  orderedTests: OrderedTestModel[];
  clinicNotes: string | null;
  labNotes: string | null;
  sampleType: string | null;
  sampleNotes: string | null;
  // Patient snapshot for display in queue
  patientName: string;
  patientSpecies: string;
  ownerName: string;
  createdAt: Date;
  updatedAt: Date;
  receivedByLabAt: Date | null;
  completedAt: Date | null;
}

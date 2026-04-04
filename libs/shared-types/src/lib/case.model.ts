export enum PatientSpecies {
  DOG = 'DOG',
  CAT = 'CAT',
  EQUINE = 'EQUINE',
  BOVINE = 'BOVINE',
  BIRD = 'BIRD',
  REPTILE = 'REPTILE',
  RABBIT = 'RABBIT',
  OTHER = 'OTHER',
}

export enum AgeUnit {
  DAYS = 'DAYS',
  WEEKS = 'WEEKS',
  MONTHS = 'MONTHS',
  YEARS = 'YEARS',
}

export enum CaseStatus {
  OPEN = 'OPEN',
  TRIAGED = 'TRIAGED',
  ORDERED = 'ORDERED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export interface CaseModel {
  id: string;
  tenantId: string;
  status: CaseStatus;

  // Patient
  patientName: string;
  patientSpecies: PatientSpecies;
  patientBreed?: string;
  patientAge?: number;
  patientAgeUnit?: AgeUnit;
  patientWeight?: number; // kg

  // Owner
  ownerName: string;
  ownerPhone?: string;

  // Clinical
  symptoms?: string;
  triageResult?: unknown;
  suggestedTests?: unknown;
  selectedTests?: unknown;

  // Order
  orderNotes?: string;
  orderSentAt?: Date;

  // Results
  resultsUrl?: string;
  resultsReceivedAt?: Date;

  // Audit
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

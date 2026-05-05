import { TriageResultModel } from './triage-result.model.js';
import { CatalogItemModel } from './catalog-item.model.js';

export enum PatientSpecies {
  DOG = 'DOG',
  CAT = 'CAT',
  EQUINE = 'EQUINE',
  BOVINE = 'BOVINE',
  BIRD = 'BIRD',
  REPTILE = 'REPTILE',
  RABBIT = 'RABBIT',
  OTHER = 'OTHER',
  ANY = 'ANY', // species-agnostic template — applies to all species
}

export enum AgeUnit {
  DAYS = 'DAYS',
  WEEKS = 'WEEKS',
  MONTHS = 'MONTHS',
  YEARS = 'YEARS',
}

export enum PatientSex {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  UNKNOWN = 'UNKNOWN',
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
  patientSex?: PatientSex;
  patientBreed?: string;
  patientDateOfBirth?: string; // ISO date string YYYY-MM-DD, optional
  patientAge?: number;
  patientAgeUnit?: AgeUnit;
  patientWeight?: number; // kg

  // Owner
  ownerName: string;
  ownerPhone?: string;

  // Clinical
  symptoms?: string;
  triageResult?: TriageResultModel;
  suggestedCatalogItemIds?: string[]; // AI suggestions (from triage)
  selectedCatalogItems?: CatalogItemModel[]; // vet-confirmed selection (resolved by API)

  // Order (set when a lab order is generated)
  orderNotes?: string;
  orderSentAt?: Date | string;
  order?: { orderId: string; status: string };

  // Audit
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

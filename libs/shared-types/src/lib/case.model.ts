import { TriageResultModel } from './triage-result.model.js';
import { TestModel } from './test.model.js';
import { TestPackageModel } from './test-package.model.js';

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
  selectedTests?: {
    tests: TestModel[];
    packages: TestPackageModel[];
  };

  // Order
  order?: {
    orderId: string;
    requisitionUrl: string;
    qrCodeUrl?: string;
    whatsAppLink: string;
    sentAt?: Date;
  };

  // Results
  resultsUrl?: string;
  resultsReceivedAt?: Date;

  // Audit
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

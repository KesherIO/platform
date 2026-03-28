import { Patient } from './patient.model.js';
import { Owner } from './owner.model.js';

export type CaseStatus = 'NEW' | 'TRIAGE' | 'ORDERED' | 'RESULTED' | 'COMPLETED' | 'ARCHIVED';

export interface Case {
  id?: string;
  caseNumber?: string;
  patient: Patient;
  owner: Owner;
  status: CaseStatus;
  chiefComplaint?: string;
  symptoms?: string[];
  vetId?: string;
  clinicId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
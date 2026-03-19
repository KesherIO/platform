import { Patient } from './patient.model';
import { Owner } from './owner.model';

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
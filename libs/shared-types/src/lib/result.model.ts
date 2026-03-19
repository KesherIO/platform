export type AnalyteFlag = 'H' | 'L' | 'A' | 'N'; // High, Low, Abnormal, Normal

export interface ReferenceRange {
  min?: number;
  max?: number;
  unit: string;
  species: string;
  ageMonths?: number;
}

export interface Analyte {
  code: string;
  name: string;
  value: number | string;
  unit: string;
  flag: AnalyteFlag;
  referenceRange?: ReferenceRange;
}

export interface PanelResult {
  panelName: string; // e.g., 'CBC', 'Basic Chemistry', 'Urinalysis'
  analytes: Analyte[];
  performedAt?: Date;
}

export interface Result {
  id?: string;
  orderId: string;
  caseId: string;
  panels: PanelResult[];
  interpretationVet?: string;
  interpretationOwner?: string;
  status: 'PENDING' | 'PARTIAL' | 'COMPLETE';
  createdAt?: Date;
  reportedAt?: Date;
}
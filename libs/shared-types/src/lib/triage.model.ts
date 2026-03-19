export interface DifferentialDiagnosis {
  diagnosis: string;
  confidence: number; // 0-1
  rationale: string;
}

export interface SuggestedTest {
  testCode: string;
  testName: string;
  testType: 'CBC' | 'CHEMISTRY' | 'URINALYSIS' | 'FECAL' | 'SNAP' | 'PCR' | 'OTHER';
  sampleType: string;
  volumeMl?: number;
  temperature?: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  rationale: string;
}

export interface RedFlag {
  flag: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  recommendation: string;
}

export interface TriageResult {
  caseId: string;
  ddx: DifferentialDiagnosis[];
  tests: SuggestedTest[];
  redFlags: RedFlag[];
  createdAt?: Date;
}
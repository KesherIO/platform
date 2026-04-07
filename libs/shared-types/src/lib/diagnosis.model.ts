export interface DiagnosisModel {
  name: string;
  confidence: number; // 0–100
  explanation?: string;
}

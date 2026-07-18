export interface AttentionReasonDto {
  code: string;
  message: string;
  severity: 'HIGH' | 'CRITICAL';
  elapsedMinutes?: number;
  thresholdMinutes?: number;
}

/** MCP-facing wire shape — decoupled from OrderAttentionService's internal type. */
export interface OrderAttentionDto {
  orderId: string;
  requisitionNumber: string;
  status: string;
  priority: string;
  patientName: string;
  patientSpecies: string;
  clinicName: string;
  ageMinutes: number;
  severity: 'HIGH' | 'CRITICAL';
  reasons: AttentionReasonDto[];
}

import { SuggestedTest } from './triage.model';

export type OrderStatus = 'PENDING' | 'SENT' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface Sample {
  sampleId: string;
  type: string;
  volumeMl?: number;
  temperature?: string;
  collectedAt?: Date;
}

export interface Order {
  id?: string;
  orderId: string; // e.g., ORD-9F4Q7
  caseId: string;
  tests: SuggestedTest[];
  samples: Sample[];
  status: OrderStatus;
  requisitionPdfUrl?: string;
  sentVia?: 'WHATSAPP' | 'SMS' | 'EMAIL';
  labContact?: string;
  createdAt?: Date;
  sentAt?: Date;
}
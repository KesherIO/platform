export type OrderStatus =
  | 'PENDING'
  | 'READY_FOR_PICKUP'
  | 'COLLECTED'
  | 'RECEIVED_BY_LAB'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'CANCELLED';

export type OrderPriority = 'ROUTINE' | 'URGENT' | 'STAT';

export interface OrderedItem {
  catalogItemId: string;
  code: string | null;
  name: string;
  kind: 'TEST' | 'PACKAGE';
  category: string | null;
  turnaroundHours: number | null;
}

export interface OrderModel {
  id: string;
  requisitionNumber: string; // REQ-2026-000001 — written on tubes
  caseId: string;
  tenantId: string;
  status: OrderStatus;
  priority: OrderPriority;
  orderedItems: OrderedItem[];
  clinicNotes?: string;
  labNotes?: string;
  sampleType?: string;
  sampleNotes?: string;
  requisitionUrl: string; // URL to the requisition document
  createdAt: Date;
  updatedAt: Date;
  collectedAt?: Date;
  receivedByLabAt?: Date;
  processingStartedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
}

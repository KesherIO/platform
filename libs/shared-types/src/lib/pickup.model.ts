export type DeliveryMethod = 'LAB_PICKUP' | 'CLIENT_DELIVERY';

export type PickupStatus =
  | 'REQUESTED'
  | 'ASSIGNED'
  | 'NOTIFIED'
  | 'ACCEPTED'
  | 'COLLECTED'
  | 'IN_TRANSIT'
  | 'RECEIVED_AT_LAB'
  | 'CANCELLED'
  | 'FAILED';

export type PickupProblemReason =
  | 'CLINIC_CLOSED'
  | 'SAMPLE_NOT_READY'
  | 'INCORRECT_ADDRESS'
  | 'UNABLE_TO_CONTACT'
  | 'OTHER';

export type TimelineEventType =
  | 'ORDER_CREATED'
  | 'PICKUP_REQUESTED'
  | 'PICKUP_ASSIGNED'
  | 'NOTIFICATION_SENT'
  | 'NOTIFICATION_FAILED'
  | 'PICKUP_ACCEPTED'
  | 'SAMPLE_COLLECTED'
  | 'IN_TRANSIT'
  | 'RECEIVED_AT_LAB'
  | 'PICKUP_CANCELLED'
  | 'PICKUP_FAILED'
  | 'PROBLEM_REPORTED'
  | 'PROCESSING_STARTED'
  | 'RESULTS_COMPLETED'
  | 'REPORT_RELEASED';

export interface PickupModel {
  id: string;
  orderId: string;
  labTenantId: string;
  clinicTenantId: string;
  status: PickupStatus;
  priority: string;

  pickupAddress: string | null;
  pickupContactName: string | null;
  pickupContactPhone: string | null;
  pickupInstructions: string | null;
  requestedPickupTime: Date | null;

  messengerId: string | null;
  assignedAt: Date | null;

  notifiedAt: Date | null;
  notifyFailReason: string | null;

  acceptedAt: Date | null;
  collectedAt: Date | null;
  receivedAt: Date | null;
  cancelledAt: Date | null;
  failedAt: Date | null;
  failReason: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export interface TimelineEventModel {
  id: string;
  orderId: string;
  pickupId: string | null;
  eventType: TimelineEventType;
  actorId: string | null;
  actorName: string | null;
  description: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

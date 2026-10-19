/** Matches the Prisma NotificationType enum. */
export type NotificationType =
  | 'TESTS_ADDED'
  | 'ADDITIONAL_SAMPLE_REQUIRED'
  | 'RESULTS_RELEASED'
  | 'RESULTS_AMENDED'
  | 'PICKUP_ASSIGNED'
  | 'PICKUP_UNASSIGNED'
  | 'PICKUP_CANCELLED';

/**
 * What a notification is rendered from. Never holds patient names or result
 * values — the inbox adds the patient name from the order it links to.
 */
export interface NotificationParams {
  requisitionNumber?: string;
  /** Clinic links open the case's report page */
  caseId?: string;
  testNames?: string[];
  /** RESULTS_RELEASED */
  releaseType?: 'PARTIAL' | 'FINAL';
  /** PICKUP_ASSIGNED: the persisted assignment it was sent for (ISO) */
  assignedAt?: string;
}

export interface NotificationModel {
  id: string;
  type: NotificationType;
  /** The clinic or lab this notification belongs to */
  tenantId: string;
  orderId?: string;
  pickupId?: string;
  params: NotificationParams;
  /** From the linked order's case; shown inside the app only */
  patientName?: string;
  /** In-app path to open, e.g. /cases/:id/report?clinic=<tenantId> */
  link: string;
  readAt?: string;
  createdAt: string;
}

export interface NotificationListResponse {
  items: NotificationModel[];
  nextCursor: string | null;
}

export interface NotificationUnreadCountResponse {
  /** Unread in the active clinic/lab */
  count: number;
  /** Unread in the user's other active memberships of the same kind */
  otherTenants: { tenantId: string; count: number }[];
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

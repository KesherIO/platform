import type { NotificationType, Prisma } from '@prisma/client';
import type { NotificationParams } from '@vet-ai/shared-types';
import { notificationApp } from './notification-content';

type Db = Pick<
  Prisma.TransactionClient,
  'userTenantMembership' | 'order' | 'pickup' | 'laboratoryProfile'
>;

const LAB_TENANT_TYPES = new Set(['LAB', 'PLATFORM']);

/** Of `userIds`, those with an ACTIVE membership in `tenantId`. */
export async function activeMemberIds(
  db: Pick<Db, 'userTenantMembership'>,
  tenantId: string,
  userIds: string[]
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await db.userTenantMembership.findMany({
    where: { tenantId, userId: { in: userIds }, status: 'ACTIVE' },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/**
 * Whether the recipient may still be told about this — checked again right
 * before a queued push goes out, since membership, roles, the pickup's
 * assignment or the lab's amendment setting can change after it was created.
 */
export async function isRecipientStillAuthorized(
  db: Db,
  n: {
    recipientUserId: string;
    tenantId: string;
    type: NotificationType;
    orderId: string | null;
    pickupId: string | null;
    params: NotificationParams;
  }
): Promise<boolean> {
  const membership = await db.userTenantMembership.findUnique({
    where: {
      userId_tenantId: { userId: n.recipientUserId, tenantId: n.tenantId },
    },
    select: {
      status: true,
      role: true,
      canPerformPickups: true,
      tenant: { select: { type: true } },
    },
  });
  if (!membership || membership.status !== 'ACTIVE') return false;

  if (notificationApp(n.type) === 'CLINIC') {
    if (membership.tenant.type !== 'CLINIC' || !n.orderId) return false;
    // Every active clinic member may see every order of the clinic
    const order = await db.order.findUnique({
      where: { id: n.orderId },
      select: { tenantId: true, labTenantId: true },
    });
    if (!order || order.tenantId !== n.tenantId) return false;
    if (n.type === 'RESULTS_AMENDED') {
      // The lab may have made amendments silent since
      if (!order.labTenantId) return true;
      const profile = await db.laboratoryProfile.findUnique({
        where: { tenantId: order.labTenantId },
        select: { showAmendmentsToClinic: true },
      });
      return profile?.showAmendmentsToClinic ?? true;
    }
    return true;
  }

  if (!LAB_TENANT_TYPES.has(membership.tenant.type)) return false;
  if (n.type !== 'PICKUP_ASSIGNED') return true;

  // Still this messenger's pickup, from the same assignment, not yet accepted
  if (membership.role !== 'MESSENGER' && !membership.canPerformPickups) {
    return false;
  }
  if (!n.pickupId) return false;
  const pickup = await db.pickup.findUnique({
    where: { id: n.pickupId },
    select: { messengerId: true, assignedAt: true, status: true },
  });
  return (
    !!pickup &&
    pickup.messengerId === n.recipientUserId &&
    pickup.assignedAt?.toISOString() === n.params.assignedAt &&
    (pickup.status === 'ASSIGNED' || pickup.status === 'NOTIFIED')
  );
}

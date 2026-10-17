import type { Prisma } from '@prisma/client';
import { activeMemberIds } from './notification-access';

type Db = Pick<Prisma.TransactionClient, 'order' | 'userTenantMembership'>;

export interface ClinicOrderRecipients {
  /** The clinic the order belongs to — the notifications' tenant */
  tenantId: string;
  userIds: string[];
  requisitionNumber: string;
  caseId: string;
}

/**
 * Who in the clinic hears about an order (defaults agreed 2026-10-17):
 * the ordering vet and the case's attending vet; the clinic's Owner and
 * Admins when neither is an active member, and always when `includeAdmins`
 * (another sample is needed — they usually arrange the logistics).
 * Only ACTIVE members, each person once. Every active member of a clinic may
 * see all of its orders, so membership is the authorization.
 */
export async function clinicOrderRecipients(
  db: Db,
  orderId: string,
  opts: { includeAdmins?: boolean } = {}
): Promise<ClinicOrderRecipients | null> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      tenantId: true,
      requisitionNumber: true,
      caseId: true,
      orderingVetId: true,
      case: { select: { attendingVetId: true } },
    },
  });
  if (!order) return null;

  const vets = await activeMemberIds(
    db,
    order.tenantId,
    [order.orderingVetId, order.case.attendingVetId].filter(
      (id): id is string => !!id
    )
  );

  let admins: string[] = [];
  if (opts.includeAdmins || vets.length === 0) {
    admins = (
      await db.userTenantMembership.findMany({
        where: {
          tenantId: order.tenantId,
          status: 'ACTIVE',
          role: { in: ['OWNER', 'ADMIN'] },
        },
        select: { userId: true },
      })
    ).map((m) => m.userId);
  }

  return {
    tenantId: order.tenantId,
    userIds: [...new Set([...vets, ...admins])],
    requisitionNumber: order.requisitionNumber,
    caseId: order.caseId,
  };
}

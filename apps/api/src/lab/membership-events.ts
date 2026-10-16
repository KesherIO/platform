import type {
  MembershipEventType,
  MembershipStatus,
  Prisma,
  TenantRole,
} from '@prisma/client';

/** Where a membership change came from — stored on every event. */
export type MembershipEventSource =
  | 'lab_users'
  | 'lab_setup'
  | 'lab_onboarding';

export interface MembershipEventInput {
  tenantId: string;
  eventType: MembershipEventType;
  targetUserId: string;
  /** null = system (InternalApiKey bootstrap, self-service lab onboarding) */
  actorUserId: string | null;
  source: MembershipEventSource;
  previousRole?: TenantRole | null;
  newRole?: TenantRole | null;
  previousStatus?: MembershipStatus | null;
  newStatus?: MembershipStatus | null;
  previousCanPerformPickups?: boolean | null;
  newCanPerformPickups?: boolean | null;
  reason?: string | null;
}

/**
 * Appends one membership audit event. Must be called with the transaction
 * client of the change it describes, so a rollback drops the event too.
 * Target/actor names are snapshotted: the user row may change or disappear.
 */
export async function recordMembershipEvent(
  tx: Prisma.TransactionClient,
  input: MembershipEventInput
) {
  const ids = [input.targetUserId, input.actorUserId].filter(
    (id): id is string => !!id
  );
  const users = await tx.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  const nameOf = (id: string | null) => {
    const u = id ? byId.get(id) : undefined;
    if (!u) return null;
    return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
  };

  const { reason, ...rest } = input;
  return tx.membershipEvent.create({
    data: {
      ...rest,
      targetName: nameOf(input.targetUserId),
      targetEmail: byId.get(input.targetUserId)?.email ?? null,
      actorName: nameOf(input.actorUserId),
      reason: reason?.trim() || null,
    },
  });
}

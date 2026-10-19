import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { TenantRole, Prisma, MembershipEventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import type { CreateLabUserDto } from './dto/create-lab-user.dto';
import type { UpdateLabUserDto } from './dto/update-lab-user.dto';
import {
  validateWeeklySchedule,
  isWithinSchedule,
  type WeeklySchedule,
} from './messenger-schedule.util';
import { recordMembershipEvent } from './membership-events';

/** MESSENGER does pickups by role; a results viewer never does them. */
const canHavePickupFlag = (role: string) =>
  role !== TenantRole.MESSENGER && role !== TenantRole.RESULTS_VIEWER;

/** Only a results viewer ("Consulta") can be given in-progress access. */
const canHaveInProgressFlag = (role: string) =>
  role === TenantRole.RESULTS_VIEWER;

/** Only an owner may edit an owner (name, email, phone, access flags). */
function assertCanEditMember(
  targetRole: TenantRole,
  requestingRole: TenantRole
) {
  if (targetRole === TenantRole.OWNER && requestingRole !== TenantRole.OWNER) {
    throw new ForbiddenException('Only an owner can edit another owner.');
  }
}

@Injectable()
export class LabUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService
  ) {}

  // ---------------------------------------------------------------------------
  // Bootstrap — creates the very first lab admin (InternalApiKey protected)
  // ---------------------------------------------------------------------------

  async bootstrapAdmin(labTenantId: string, dto: CreateLabUserDto) {
    const existing = await this.prisma.userTenantMembership.findFirst({
      where: {
        tenantId: labTenantId,
        role: { in: [TenantRole.ADMIN, TenantRole.OWNER] },
      },
    });
    if (existing) {
      throw new ConflictException(
        'A lab admin already exists. Use the user management screen to add more users.'
      );
    }
    return this.createLabUser(
      labTenantId,
      { ...dto, role: 'ADMIN' },
      null,
      'lab_setup'
    );
  }

  // ---------------------------------------------------------------------------
  // List members
  // ---------------------------------------------------------------------------

  async getLabMembers(labTenantId: string) {
    const [memberships, tenant, signers] = await Promise.all([
      this.prisma.userTenantMembership.findMany({
        where: { tenantId: labTenantId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: labTenantId },
        select: { timezone: true },
      }),
      // Linked report-signer profiles, for the "Signer" badge
      this.prisma.labSigner.findMany({
        where: {
          laboratoryProfile: { tenantId: labTenantId },
          userId: { not: null },
        },
        select: { userId: true, roles: true },
      }),
    ]);
    const signerRolesByUser = new Map(signers.map((s) => [s.userId, s.roles]));

    return memberships.map((m) => {
      const schedule = m.schedule as WeeklySchedule | null;
      return {
        signerRoles: signerRolesByUser.get(m.userId) ?? null,
        userId: m.userId,
        role: m.role,
        joinedAt: m.createdAt,
        email: m.user.email,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        schedule,
        canPerformPickups: m.canPerformPickups,
        canViewInProgress: m.canViewInProgress,
        isCurrentlyScheduled: isWithinSchedule(schedule, tenant.timezone),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Create user + add to lab tenant
  // ---------------------------------------------------------------------------

  async createLabUser(
    labTenantId: string,
    dto: CreateLabUserDto,
    requestingUserId: string | null,
    source: 'lab_users' | 'lab_setup' = 'lab_users'
  ) {
    const schedule =
      dto.schedule !== undefined ? validateWeeklySchedule(dto.schedule) : null;

    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingUser) {
      const existingMembership =
        await this.prisma.userTenantMembership.findUnique({
          where: {
            userId_tenantId: { userId: existingUser.id, tenantId: labTenantId },
          },
        });
      if (existingMembership) {
        throw new ConflictException(
          'This user is already a member of the lab.'
        );
      }
    }

    // 1. Create Supabase auth user
    const supabaseId = await this.auth.createSupabaseUser(
      dto.email,
      dto.password,
      dto.firstName,
      dto.lastName
    );

    try {
      // 2. Create local user + membership atomically
      const result = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.upsert({
          where: { id: supabaseId },
          create: {
            id: supabaseId,
            email: dto.email,
            firstName: dto.firstName,
            lastName: dto.lastName,
          },
          update: { email: dto.email },
        });

        const membership = await tx.userTenantMembership.create({
          data: {
            userId: supabaseId,
            tenantId: labTenantId,
            role: dto.role as TenantRole,
            ...(schedule && {
              schedule: schedule as unknown as Prisma.InputJsonValue,
            }),
            ...(dto.canPerformPickups &&
              canHavePickupFlag(dto.role) && { canPerformPickups: true }),
            ...(dto.canViewInProgress &&
              canHaveInProgressFlag(dto.role) && { canViewInProgress: true }),
          },
        });

        await recordMembershipEvent(tx, {
          tenantId: labTenantId,
          eventType: MembershipEventType.MEMBER_ADDED,
          targetUserId: user.id,
          actorUserId: requestingUserId,
          source,
          newRole: membership.role,
          newStatus: membership.status,
          newCanPerformPickups: membership.canPerformPickups,
          newCanViewInProgress: membership.canViewInProgress,
          reason: dto.reason,
        });

        return { user, membership };
      });

      return {
        userId: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        role: result.membership.role,
        joinedAt: result.membership.createdAt,
        canPerformPickups: result.membership.canPerformPickups,
        canViewInProgress: result.membership.canViewInProgress,
      };
    } catch (err) {
      // Compensate — remove the Supabase user so we don't leave orphaned auth accounts
      await this.auth.deleteSupabaseUser(supabaseId);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Update user info
  // ---------------------------------------------------------------------------

  async updateUser(
    labTenantId: string,
    userId: string,
    dto: UpdateLabUserDto,
    requestingUserId: string,
    requestingRole: TenantRole
  ) {
    const membership = await this.prisma.userTenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId: labTenantId } },
    });
    if (!membership)
      throw new NotFoundException('User is not a member of this lab.');
    assertCanEditMember(membership.role, requestingRole);

    const current = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });
    // Supabase stores emails lowercased; keep our row identical to the JWT's.
    const newEmail = dto.email?.trim().toLowerCase();
    const emailChanged =
      newEmail !== undefined && newEmail !== current.email.toLowerCase();

    // The login email lives in Supabase: change it there first, so a refusal
    // (address taken, invalid) stops the edit before anything is written here.
    if (emailChanged) {
      await this.assertEmailCanChange(labTenantId, userId, newEmail);
      await this.auth.updateSupabaseUserEmail(userId, newEmail);
    }

    try {
      return await this.prisma.$transaction((tx) =>
        this.applyUserUpdate(tx, labTenantId, userId, dto, {
          email: emailChanged ? newEmail : undefined,
          requestingUserId,
          requestingRole,
        })
      );
    } catch (err) {
      if (emailChanged) {
        // Put the login back so it matches our row again.
        await this.auth
          .updateSupabaseUserEmail(userId, current.email)
          .catch((e) =>
            console.error(
              'Supabase email rollback failed (login and DB email differ):',
              userId,
              (e as Error).message
            )
          );
      }
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('A user with this email already exists.');
      }
      throw err;
    }
  }

  /**
   * An email change moves the person's login, so it may only be done by the
   * lab that is their sole tenant: from here, another clinic's or lab's
   * account could otherwise be redirected to an address this lab controls.
   */
  private async assertEmailCanChange(
    labTenantId: string,
    userId: string,
    email: string
  ) {
    const taken = await this.prisma.user.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        NOT: { id: userId },
      },
    });
    if (taken)
      throw new ConflictException('A user with this email already exists.');

    const otherTenants = await this.prisma.userTenantMembership.count({
      where: { userId, tenantId: { not: labTenantId } },
    });
    if (otherTenants > 0) {
      throw new ForbiddenException(
        'This person also belongs to another clinic or lab, so their login email cannot be changed from this lab.'
      );
    }
  }

  /** The DB half of updateUser: user row, membership flags and their events. */
  private async applyUserUpdate(
    tx: Prisma.TransactionClient,
    labTenantId: string,
    userId: string,
    dto: UpdateLabUserDto,
    opts: {
      email: string | undefined;
      requestingUserId: string;
      requestingRole: TenantRole;
    }
  ) {
    // Locked so concurrent edits (or a retry) serialize: the second one sees
    // the first's result and logs nothing instead of the same change twice.
    const membership = await this.lockMember(tx, labTenantId, userId);
    // Re-checked under the lock: the role may have changed since the pre-check.
    assertCanEditMember(membership.role, opts.requestingRole);
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;

    const profileSelect = {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
    } as const;
    const before = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: profileSelect,
    });
    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        ...(dto.firstName !== undefined && { firstName: dto.firstName }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName }),
        ...(opts.email !== undefined && { email: opts.email }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
      },
      select: profileSelect,
    });

    const event = {
      tenantId: labTenantId,
      targetUserId: userId,
      actorUserId: opts.requestingUserId,
      source: 'lab_users' as const,
      reason: dto.reason,
    };

    if (updated.email !== before.email) {
      await recordMembershipEvent(tx, {
        ...event,
        eventType: MembershipEventType.EMAIL_CHANGED,
        details: { previousEmail: before.email, newEmail: updated.email },
      });
    }

    const changes: Record<string, { from: string | null; to: string | null }> =
      {};
    for (const field of ['firstName', 'lastName', 'phone'] as const) {
      const from = before[field] || null;
      const to = updated[field] || null;
      if (from !== to) changes[field] = { from, to };
    }
    if (Object.keys(changes).length) {
      await recordMembershipEvent(tx, {
        ...event,
        eventType: MembershipEventType.PROFILE_CHANGED,
        details: { changes },
      });
    }

    let schedule = membership.schedule as WeeklySchedule | null;
    let { canPerformPickups, canViewInProgress } = membership;
    const membershipUpdates: Record<string, unknown> = {};

    if (dto.schedule !== undefined) {
      schedule =
        dto.schedule === null ? null : validateWeeklySchedule(dto.schedule);
      membershipUpdates.schedule = schedule
        ? (schedule as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull;
    }

    if (dto.canPerformPickups !== undefined) {
      canPerformPickups = canHavePickupFlag(membership.role)
        ? dto.canPerformPickups
        : false;
      membershipUpdates.canPerformPickups = canPerformPickups;
    }

    if (dto.canViewInProgress !== undefined) {
      canViewInProgress = canHaveInProgressFlag(membership.role)
        ? dto.canViewInProgress
        : false;
      membershipUpdates.canViewInProgress = canViewInProgress;
    }

    if (Object.keys(membershipUpdates).length) {
      await tx.userTenantMembership.update({
        where: { userId_tenantId: { userId, tenantId: labTenantId } },
        data: membershipUpdates,
      });
    }

    // The schedule is informational; only the access flags are audited.
    if (canPerformPickups !== membership.canPerformPickups) {
      await recordMembershipEvent(tx, {
        ...event,
        eventType: MembershipEventType.PICKUP_CAPABILITY_CHANGED,
        previousCanPerformPickups: membership.canPerformPickups,
        newCanPerformPickups: canPerformPickups,
      });
    }
    if (canViewInProgress !== membership.canViewInProgress) {
      await recordMembershipEvent(tx, {
        ...event,
        eventType: MembershipEventType.IN_PROGRESS_ACCESS_CHANGED,
        previousCanViewInProgress: membership.canViewInProgress,
        newCanViewInProgress: canViewInProgress,
      });
    }

    return {
      userId: updated.id,
      email: updated.email,
      firstName: updated.firstName,
      lastName: updated.lastName,
      role: membership.role,
      schedule,
      canPerformPickups,
      canViewInProgress,
    };
  }

  // ---------------------------------------------------------------------------
  // Change role
  // ---------------------------------------------------------------------------

  async updateRole(
    labTenantId: string,
    userId: string,
    role: string,
    reason: string,
    requestingUserId: string,
    requestingRole: TenantRole
  ) {
    if (userId === requestingUserId) {
      throw new ForbiddenException('You cannot change your own role.');
    }

    return this.prisma.$transaction(async (tx) => {
      const membership = await this.lockOwnersAndGetMember(
        tx,
        labTenantId,
        userId
      );
      if (membership.role === TenantRole.OWNER && role !== TenantRole.OWNER) {
        await this.assertCanActOnOwner(tx, labTenantId, userId, requestingRole);
      }
      // Same role (e.g. a retried request): nothing changes, nothing is logged.
      if (membership.role === role) return membership;

      const updated = await tx.userTenantMembership.update({
        where: { userId_tenantId: { userId, tenantId: labTenantId } },
        data: {
          role: role as TenantRole,
          // Flags that don't apply to the new role are cleared; leaving
          // MESSENGER clears pickups too (they were intrinsic to the role).
          ...(!canHavePickupFlag(role) ||
          membership.role === TenantRole.MESSENGER
            ? { canPerformPickups: false }
            : {}),
          ...(!canHaveInProgressFlag(role) ? { canViewInProgress: false } : {}),
        },
      });

      await recordMembershipEvent(tx, {
        tenantId: labTenantId,
        eventType: MembershipEventType.ROLE_CHANGED,
        targetUserId: userId,
        actorUserId: requestingUserId,
        source: 'lab_users',
        previousRole: membership.role,
        newRole: updated.role,
        previousCanPerformPickups: membership.canPerformPickups,
        newCanPerformPickups: updated.canPerformPickups,
        previousCanViewInProgress: membership.canViewInProgress,
        newCanViewInProgress: updated.canViewInProgress,
        reason,
      });

      return updated;
    });
  }

  /**
   * Locks the lab's OWNER memberships (so two concurrent demotions/removals
   * can't both see "another owner remains") and returns the target member.
   */
  private async lockOwnersAndGetMember(
    tx: Prisma.TransactionClient,
    labTenantId: string,
    userId: string
  ) {
    await tx.$queryRaw`SELECT "userId" FROM user_tenant_memberships WHERE "tenantId" = ${labTenantId} AND role = 'OWNER' FOR UPDATE`;
    return this.lockMember(tx, labTenantId, userId);
  }

  /**
   * Locks and returns the target membership, so two concurrent changes (or a
   * retry racing the original) serialize: the second one sees the first's
   * result and becomes a no-op instead of logging the same change twice.
   */
  private async lockMember(
    tx: Prisma.TransactionClient,
    labTenantId: string,
    userId: string
  ) {
    await tx.$queryRaw`SELECT "userId" FROM user_tenant_memberships WHERE "tenantId" = ${labTenantId} AND "userId" = ${userId} FOR UPDATE`;
    const membership = await tx.userTenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId: labTenantId } },
    });
    if (!membership)
      throw new NotFoundException('User is not a member of this lab.');
    return membership;
  }

  /**
   * Only an owner may demote or remove an owner, and the lab always keeps at
   * least one owner. (Ownership transfer is a separate feature.)
   */
  private async assertCanActOnOwner(
    tx: Prisma.TransactionClient,
    labTenantId: string,
    ownerUserId: string,
    requestingRole: TenantRole
  ) {
    if (requestingRole !== TenantRole.OWNER) {
      throw new ForbiddenException(
        'Only an owner can change or remove another owner.'
      );
    }
    const otherOwners = await tx.userTenantMembership.count({
      where: {
        tenantId: labTenantId,
        role: TenantRole.OWNER,
        userId: { not: ownerUserId },
      },
    });
    if (otherOwners === 0) {
      throw new ForbiddenException('The lab must keep at least one owner.');
    }
  }

  // ---------------------------------------------------------------------------
  // Remove from lab (does NOT delete the Supabase auth user)
  // ---------------------------------------------------------------------------

  async removeMember(
    labTenantId: string,
    userId: string,
    reason: string,
    requestingUserId: string,
    requestingRole: TenantRole
  ) {
    if (userId === requestingUserId) {
      throw new ForbiddenException('You cannot remove yourself from the lab.');
    }

    await this.prisma.$transaction(async (tx) => {
      const membership = await this.lockOwnersAndGetMember(
        tx,
        labTenantId,
        userId
      );
      if (membership.role === TenantRole.OWNER) {
        await this.assertCanActOnOwner(tx, labTenantId, userId, requestingRole);
      }
      await tx.userTenantMembership.delete({
        where: { userId_tenantId: { userId, tenantId: labTenantId } },
      });
      await recordMembershipEvent(tx, {
        tenantId: labTenantId,
        eventType: MembershipEventType.REMOVED,
        targetUserId: userId,
        actorUserId: requestingUserId,
        source: 'lab_users',
        previousRole: membership.role,
        previousStatus: membership.status,
        previousCanPerformPickups: membership.canPerformPickups,
        previousCanViewInProgress: membership.canViewInProgress,
        reason,
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Reactivate a removed member — restores the role and access flags they had
  // when they were removed. Reuses their existing Supabase account.
  // ---------------------------------------------------------------------------

  async reactivateMember(
    labTenantId: string,
    userId: string,
    reason: string,
    requestingUserId: string,
    requestingRole: TenantRole
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const removal = await tx.membershipEvent.findFirst({
          where: {
            tenantId: labTenantId,
            targetUserId: userId,
            eventType: MembershipEventType.REMOVED,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!removal || !user || !removal.previousRole) {
          throw new NotFoundException('No removed member found for this user.');
        }

        const existing = await tx.userTenantMembership.findUnique({
          where: { userId_tenantId: { userId, tenantId: labTenantId } },
        });
        if (existing) {
          throw new ConflictException(
            'This user is already a member of the lab.'
          );
        }

        const role = removal.previousRole;
        if (role === TenantRole.OWNER && requestingRole !== TenantRole.OWNER) {
          throw new ForbiddenException(
            'Only an owner can reactivate another owner.'
          );
        }

        const membership = await tx.userTenantMembership.create({
          data: {
            userId,
            tenantId: labTenantId,
            role,
            ...(removal.previousCanPerformPickups &&
              canHavePickupFlag(role) && { canPerformPickups: true }),
            ...(removal.previousCanViewInProgress &&
              canHaveInProgressFlag(role) && { canViewInProgress: true }),
          },
        });

        await recordMembershipEvent(tx, {
          tenantId: labTenantId,
          eventType: MembershipEventType.REACTIVATED,
          targetUserId: userId,
          actorUserId: requestingUserId,
          source: 'lab_users',
          newRole: membership.role,
          newStatus: membership.status,
          newCanPerformPickups: membership.canPerformPickups,
          newCanViewInProgress: membership.canViewInProgress,
          reason,
        });

        return {
          userId: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: membership.role,
          joinedAt: membership.createdAt,
          canPerformPickups: membership.canPerformPickups,
          canViewInProgress: membership.canViewInProgress,
        };
      });
    } catch (err) {
      // Concurrent reactivation: the composite PK rejected the second insert.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'This user is already a member of the lab.'
        );
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Membership history (read-only — events are never edited or deleted)
  // ---------------------------------------------------------------------------

  /**
   * Newest first. Scoped by lab only — not by current membership — so a
   * removed member's history stays reachable.
   */
  async getMembershipHistory(
    labTenantId: string,
    query: { userId?: string; cursor?: string; limit?: number }
  ) {
    const limit = query.limit ?? 50;
    const events = await this.prisma.membershipEvent.findMany({
      where: {
        tenantId: labTenantId,
        ...(query.userId && { targetUserId: query.userId }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
    });
    const hasMore = events.length > limit;
    const items = hasMore ? events.slice(0, limit) : events;
    return {
      items: items.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        targetUserId: e.targetUserId,
        targetName: e.targetName,
        targetEmail: e.targetEmail,
        actorUserId: e.actorUserId,
        actorName: e.actorName,
        previousRole: e.previousRole,
        newRole: e.newRole,
        previousStatus: e.previousStatus,
        newStatus: e.newStatus,
        previousCanPerformPickups: e.previousCanPerformPickups,
        newCanPerformPickups: e.newCanPerformPickups,
        previousCanViewInProgress: e.previousCanViewInProgress,
        newCanViewInProgress: e.newCanViewInProgress,
        reason: e.reason,
        details: e.details,
        source: e.source,
        createdAt: e.createdAt,
      })),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  /**
   * People removed from this lab who are not members again, latest removal
   * first — the entry point to their history once they leave the team list.
   */
  async getRemovedMembers(labTenantId: string) {
    const [removals, members] = await Promise.all([
      this.prisma.membershipEvent.findMany({
        where: {
          tenantId: labTenantId,
          eventType: MembershipEventType.REMOVED,
        },
        orderBy: [{ targetUserId: 'asc' }, { createdAt: 'desc' }],
        distinct: ['targetUserId'],
      }),
      this.prisma.userTenantMembership.findMany({
        where: { tenantId: labTenantId },
        select: { userId: true },
      }),
    ]);
    const current = new Set(members.map((m) => m.userId));
    return removals
      .filter((r) => !current.has(r.targetUserId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => ({
        userId: r.targetUserId,
        name: r.targetName,
        email: r.targetEmail,
        lastRole: r.previousRole,
        removedAt: r.createdAt,
        removedByName: r.actorName,
      }));
  }
}

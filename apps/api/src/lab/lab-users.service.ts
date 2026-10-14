import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { TenantRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import type { CreateLabUserDto } from './dto/create-lab-user.dto';
import type { UpdateLabUserDto } from './dto/update-lab-user.dto';
import {
  validateWeeklySchedule,
  isWithinSchedule,
  type WeeklySchedule,
} from './messenger-schedule.util';

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
    return this.createLabUser(labTenantId, { ...dto, role: 'ADMIN' });
  }

  // ---------------------------------------------------------------------------
  // List members
  // ---------------------------------------------------------------------------

  async getLabMembers(labTenantId: string) {
    const [memberships, tenant] = await Promise.all([
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
    ]);

    return memberships.map((m) => {
      const schedule = m.schedule as WeeklySchedule | null;
      return {
        userId: m.userId,
        role: m.role,
        joinedAt: m.createdAt,
        email: m.user.email,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        schedule,
        canPerformPickups: m.canPerformPickups,
        isCurrentlyScheduled: isWithinSchedule(schedule, tenant.timezone),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Create user + add to lab tenant
  // ---------------------------------------------------------------------------

  async createLabUser(labTenantId: string, dto: CreateLabUserDto) {
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
              dto.role !== 'MESSENGER' && { canPerformPickups: true }),
          },
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

  async updateUser(labTenantId: string, userId: string, dto: UpdateLabUserDto) {
    const membership = await this.prisma.userTenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId: labTenantId } },
    });
    if (!membership)
      throw new NotFoundException('User is not a member of this lab.');

    if (dto.email) {
      const existing = await this.prisma.user.findFirst({
        where: { email: dto.email, NOT: { id: userId } },
      });
      if (existing)
        throw new ConflictException('A user with this email already exists.');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.firstName !== undefined && { firstName: dto.firstName }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
      },
    });

    let schedule = membership.schedule as WeeklySchedule | null;
    let { canPerformPickups } = membership;

    const membershipUpdates: Record<string, unknown> = {};

    if (dto.schedule !== undefined) {
      schedule =
        dto.schedule === null ? null : validateWeeklySchedule(dto.schedule);
      membershipUpdates.schedule = schedule
        ? (schedule as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull;
    }

    if (dto.canPerformPickups !== undefined) {
      canPerformPickups =
        membership.role === TenantRole.MESSENGER
          ? false
          : dto.canPerformPickups;
      membershipUpdates.canPerformPickups = canPerformPickups;
    }

    if (Object.keys(membershipUpdates).length > 0) {
      await this.prisma.userTenantMembership.update({
        where: { userId_tenantId: { userId, tenantId: labTenantId } },
        data: membershipUpdates,
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
    };
  }

  // ---------------------------------------------------------------------------
  // Change role
  // ---------------------------------------------------------------------------

  async updateRole(
    labTenantId: string,
    userId: string,
    role: string,
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

      return tx.userTenantMembership.update({
        where: { userId_tenantId: { userId, tenantId: labTenantId } },
        data: {
          role: role as TenantRole,
          ...(role === 'MESSENGER' || membership.role === TenantRole.MESSENGER
            ? { canPerformPickups: false }
            : {}),
        },
      });
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
    });
  }
}

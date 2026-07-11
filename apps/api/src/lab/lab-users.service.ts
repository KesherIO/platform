import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { TenantRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import type { CreateLabUserDto } from './dto/create-lab-user.dto';

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
      where: { tenantId: labTenantId, role: TenantRole.ADMIN },
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
    const memberships = await this.prisma.userTenantMembership.findMany({
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
    });

    return memberships.map((m) => ({
      userId: m.userId,
      role: m.role,
      joinedAt: m.createdAt,
      email: m.user.email,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
    }));
  }

  // ---------------------------------------------------------------------------
  // Create user + add to lab tenant
  // ---------------------------------------------------------------------------

  async createLabUser(labTenantId: string, dto: CreateLabUserDto) {
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
      };
    } catch (err) {
      // Compensate — remove the Supabase user so we don't leave orphaned auth accounts
      await this.auth.deleteSupabaseUser(supabaseId);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Change role
  // ---------------------------------------------------------------------------

  async updateRole(
    labTenantId: string,
    userId: string,
    role: string,
    requestingUserId: string
  ) {
    if (userId === requestingUserId) {
      throw new ForbiddenException('You cannot change your own role.');
    }

    const membership = await this.prisma.userTenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId: labTenantId } },
    });
    if (!membership)
      throw new NotFoundException('User is not a member of this lab.');

    return this.prisma.userTenantMembership.update({
      where: { userId_tenantId: { userId, tenantId: labTenantId } },
      data: { role: role as TenantRole },
    });
  }

  // ---------------------------------------------------------------------------
  // Remove from lab (does NOT delete the Supabase auth user)
  // ---------------------------------------------------------------------------

  async removeMember(
    labTenantId: string,
    userId: string,
    requestingUserId: string
  ) {
    if (userId === requestingUserId) {
      throw new ForbiddenException('You cannot remove yourself from the lab.');
    }

    const membership = await this.prisma.userTenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId: labTenantId } },
    });
    if (!membership)
      throw new NotFoundException('User is not a member of this lab.');

    await this.prisma.userTenantMembership.delete({
      where: { userId_tenantId: { userId, tenantId: labTenantId } },
    });
  }
}

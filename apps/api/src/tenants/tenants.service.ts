import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantRole } from '@prisma/client';
import { StaffMember, StaffRole } from '@vet-ai/shared-types';

const ROLE_MAP: Record<string, StaffRole> = {
  OWNER:        'Admin',
  ADMIN:        'Admin',
  VET:          'Staff',
  TECHNICIAN:   'Staff',
  RECEPTIONIST: 'Staff',
};

const ADMIN_ROLES: TenantRole[] = [TenantRole.OWNER, TenantRole.ADMIN];

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  findOne(_id: string): unknown {
    return null;
  }

  async getStaff(tenantId: string): Promise<StaffMember[]> {
    const now = new Date();

    const [memberships, pendingInvites] = await Promise.all([
      this.prisma.userTenantMembership.findMany({
        where: { tenantId },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.tenantInvitation.findMany({
        where: { tenantId, acceptedAt: null, expiresAt: { gt: now } },
        orderBy: { expiresAt: 'asc' },
      }),
    ]);

    const activeMembers: StaffMember[] = memberships.map((m) => ({
      id: m.userId,
      fullName:
        [m.user.firstName, m.user.lastName].filter(Boolean).join(' ') || m.user.email,
      email: m.user.email,
      role: ROLE_MAP[m.role] ?? 'Staff',
      status: 'Active',
    }));

    // Generic magic links have an empty email — skip them in the list
    const invitedMembers: StaffMember[] = pendingInvites
      .filter((inv) => inv.email)
      .map((inv) => ({
        id: inv.id,
        fullName: inv.email,
        email: inv.email,
        role: ROLE_MAP[inv.role] ?? 'Staff',
        status: 'Invited',
      }));

    return [...activeMembers, ...invitedMembers];
  }

  /**
   * Remove a staff member's clinic access by deleting their membership row.
   * The User record and Supabase auth account are intentionally kept intact
   * so that cases, orders, and audit history remain linked.
   * Blocked when the target is the last admin/owner in the clinic.
   */
  async removeStaff(tenantId: string, userId: string): Promise<void> {
    const membership = await this.prisma.userTenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
    });

    if (!membership) {
      throw new NotFoundException('Staff member not found.');
    }

    if (ADMIN_ROLES.includes(membership.role)) {
      await this.assertNotLastAdmin(tenantId);
    }

    await this.prisma.userTenantMembership.delete({
      where: { userId_tenantId: { userId, tenantId } },
    });
  }

  /**
   * Change a staff member's role between ADMIN and VET (staff).
   * Blocked when trying to demote the last admin/owner in the clinic.
   */
  async updateStaffRole(tenantId: string, userId: string, role: TenantRole): Promise<void> {
    const membership = await this.prisma.userTenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
    });

    if (!membership) {
      throw new NotFoundException('Staff member not found.');
    }

    const isDemoting = ADMIN_ROLES.includes(membership.role) && !ADMIN_ROLES.includes(role);
    if (isDemoting) {
      await this.assertNotLastAdmin(tenantId);
    }

    await this.prisma.userTenantMembership.update({
      where: { userId_tenantId: { userId, tenantId } },
      data: { role },
    });
  }

  // ---------------------------------------------------------------------------

  private async assertNotLastAdmin(tenantId: string): Promise<void> {
    const adminCount = await this.prisma.userTenantMembership.count({
      where: { tenantId, role: { in: ADMIN_ROLES } },
    });
    if (adminCount <= 1) {
      throw new ConflictException('last_admin');
    }
  }
}

import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { TenantRole } from '@prisma/client';
import { EligibleVetModel, StaffMember, StaffRole } from '@vet-ai/shared-types';

const ROLE_MAP: Record<string, StaffRole> = {
  OWNER: 'Admin',
  ADMIN: 'Admin',
  VET: 'Vet',
  TECHNICIAN: 'Technician',
  RECEPTIONIST: 'Receptionist',
};

const ADMIN_ROLES: TenantRole[] = [TenantRole.OWNER, TenantRole.ADMIN];

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService
  ) {}

  findOne(_id: string): unknown {
    return null;
  }

  async updateClinic(
    tenantId: string,
    data: { name?: string; phone?: string; address?: string },
    logoFile?: Express.Multer.File
  ): Promise<{
    id: string;
    name: string;
    phone: string | null;
    address: string | null;
    logoUrl: string | null;
  }> {
    let logoUrl: string | undefined;
    if (logoFile) {
      logoUrl = await this.storage.uploadClinicLogo(tenantId, logoFile);
    }

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.address !== undefined && { address: data.address }),
        ...(logoUrl !== undefined && { logoUrl }),
      },
      select: {
        id: true,
        name: true,
        phone: true,
        address: true,
        logoUrl: true,
      },
    });

    return updated;
  }

  async getStaff(tenantId: string): Promise<StaffMember[]> {
    const now = new Date();

    const connection = await this.prisma.clinicLabConnection.findFirst({
      where: { clinicId: tenantId, isActive: true, isDefault: true },
      select: { labId: true },
    });
    const labId = connection?.labId;

    const [memberships, pendingInvites] = await Promise.all([
      this.prisma.userTenantMembership.findMany({
        where: { tenantId },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              veterinarianProfile: {
                select: {
                  verifications: {
                    where: labId ? { labTenantId: labId } : { id: '' },
                    select: { status: true },
                    take: 1,
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.tenantInvitation.findMany({
        where: { tenantId, acceptedAt: null, expiresAt: { gt: now } },
        orderBy: { expiresAt: 'asc' },
      }),
    ]);

    const activeMembers: StaffMember[] = memberships.map((m) => {
      const verification = m.isOrderingVet
        ? m.user.veterinarianProfile?.verifications?.[0]
        : undefined;
      return {
        id: m.userId,
        fullName:
          [m.user.firstName, m.user.lastName].filter(Boolean).join(' ') ||
          m.user.email,
        email: m.user.email,
        role: ROLE_MAP[m.role] ?? 'Staff',
        status: 'Active',
        isOrderingVet: m.isOrderingVet,
        membershipStatus: m.status as string,
        vetVerificationStatus: verification?.status ?? null,
      };
    });

    // Generic magic links have an empty email — skip them in the list
    const invitedMembers: StaffMember[] = pendingInvites
      .filter((inv) => inv.email)
      .map((inv) => ({
        id: inv.id,
        fullName: inv.email,
        email: inv.email,
        role: ROLE_MAP[inv.role] ?? 'Staff',
        status: 'Invited',
        isOrderingVet: false,
        membershipStatus: null,
        vetVerificationStatus: null,
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
  async updateStaffRole(
    tenantId: string,
    userId: string,
    role: TenantRole
  ): Promise<void> {
    const membership = await this.prisma.userTenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
    });

    if (!membership) {
      throw new NotFoundException('Staff member not found.');
    }

    const isDemoting =
      ADMIN_ROLES.includes(membership.role) && !ADMIN_ROLES.includes(role);
    if (isDemoting) {
      await this.assertNotLastAdmin(tenantId);
    }

    const nonVetRoles: TenantRole[] = [
      TenantRole.TECHNICIAN,
      TenantRole.RECEPTIONIST,
      TenantRole.MESSENGER,
    ];
    const isOrderingVet = nonVetRoles.includes(role) ? false : undefined;

    await this.prisma.userTenantMembership.update({
      where: { userId_tenantId: { userId, tenantId } },
      data: {
        role,
        ...(isOrderingVet !== undefined && { isOrderingVet }),
      },
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

  // ---------------------------------------------------------------------------
  // Eligible ordering vets — used by case/order vet dropdown
  // ---------------------------------------------------------------------------

  async getVets(tenantId: string): Promise<EligibleVetModel[]> {
    const connection = await this.prisma.clinicLabConnection.findFirst({
      where: { clinicId: tenantId, isActive: true, isDefault: true },
      select: { labId: true },
    });

    const labId = connection?.labId;

    const memberships = await this.prisma.userTenantMembership.findMany({
      where: { tenantId, isOrderingVet: true },
      include: {
        user: {
          include: {
            veterinarianProfile: {
              include: {
                verifications: {
                  where: labId ? { labTenantId: labId } : { id: '' },
                  select: { status: true, rejectionReason: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((m) => {
      const verification = m.user.veterinarianProfile?.verifications?.[0];
      return {
        userId: m.userId,
        fullName:
          [m.user.firstName, m.user.lastName].filter(Boolean).join(' ') ||
          m.user.email,
        email: m.user.email,
        isOrderingVet: m.isOrderingVet,
        status: m.status as string,
        vetVerification: verification
          ? {
              status: verification.status as string,
              rejectionReason: verification.rejectionReason,
            }
          : null,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Lab contact (clinic-side)
  // ---------------------------------------------------------------------------

  async getLabContact(clinicTenantId: string) {
    const connection = await this.prisma.clinicLabConnection.findFirst({
      where: { clinicId: clinicTenantId, isActive: true, isDefault: true },
      select: {
        lab: {
          select: {
            name: true,
            email: true,
            phone: true,
            address: true,
            logoUrl: true,
            phoneNumbers: true,
            mapLat: true,
            mapLng: true,
          },
        },
      },
    });

    if (!connection) {
      throw new NotFoundException('No lab connected to this clinic.');
    }

    return connection.lab;
  }
}

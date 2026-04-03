import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { TenantRole } from '@prisma/client';
import { TenantsService } from './tenants.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMembership(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-1',
    tenantId: 'tenant-1',
    role: TenantRole.VET,
    createdAt: new Date('2024-01-01'),
    user: {
      id: 'user-1',
      firstName: 'John',
      lastName: 'Smith',
      email: 'john@example.com',
    },
    ...overrides,
  };
}

function makeInvite(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invite-1',
    email: 'staff@example.com',
    role: TenantRole.VET,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    acceptedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock factory — creates a fresh Prisma mock for each test
// ---------------------------------------------------------------------------

function makePrismaMock() {
  return {
    userTenantMembership: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    tenantInvitation: {
      findMany: jest.fn(),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TenantsService', () => {
  let service: TenantsService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(TenantsService);
  });

  // ── getStaff ──────────────────────────────────────────────────────────────

  describe('getStaff', () => {
    it('returns active members with correct shape and role mapping', async () => {
      prisma.userTenantMembership.findMany.mockResolvedValue([
        makeMembership({ role: TenantRole.ADMIN }),
        makeMembership({ userId: 'user-2', user: { id: 'user-2', firstName: 'Ana', lastName: 'Lopez', email: 'ana@example.com' }, role: TenantRole.VET }),
      ]);
      prisma.tenantInvitation.findMany.mockResolvedValue([]);

      const result = await service.getStaff('tenant-1');

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: 'user-1', role: 'Admin', status: 'Active' });
      expect(result[1]).toMatchObject({ id: 'user-2', role: 'Staff', status: 'Active' });
    });

    it('uses email as fullName when firstName and lastName are missing', async () => {
      prisma.userTenantMembership.findMany.mockResolvedValue([
        makeMembership({ user: { id: 'user-1', firstName: null, lastName: null, email: 'noname@example.com' } }),
      ]);
      prisma.tenantInvitation.findMany.mockResolvedValue([]);

      const [member] = await service.getStaff('tenant-1');

      expect(member.fullName).toBe('noname@example.com');
    });

    it('includes pending invites with Invited status', async () => {
      prisma.userTenantMembership.findMany.mockResolvedValue([]);
      prisma.tenantInvitation.findMany.mockResolvedValue([
        makeInvite({ role: TenantRole.ADMIN }),
      ]);

      const result = await service.getStaff('tenant-1');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        email: 'staff@example.com',
        role: 'Admin',
        status: 'Invited',
      });
    });

    it('excludes generic magic links (empty email) from the invite list', async () => {
      prisma.userTenantMembership.findMany.mockResolvedValue([]);
      prisma.tenantInvitation.findMany.mockResolvedValue([
        makeInvite({ email: '' }),             // generic link — should be excluded
        makeInvite({ id: 'invite-2', email: 'real@example.com' }),
      ]);

      const result = await service.getStaff('tenant-1');

      expect(result).toHaveLength(1);
      expect(result[0].email).toBe('real@example.com');
    });

    it('returns active members before invited members', async () => {
      prisma.userTenantMembership.findMany.mockResolvedValue([makeMembership()]);
      prisma.tenantInvitation.findMany.mockResolvedValue([makeInvite()]);

      const result = await service.getStaff('tenant-1');

      expect(result[0].status).toBe('Active');
      expect(result[1].status).toBe('Invited');
    });
  });

  // ── removeStaff ───────────────────────────────────────────────────────────

  describe('removeStaff', () => {
    it('throws NotFoundException when membership does not exist', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(null);

      await expect(service.removeStaff('tenant-1', 'user-1'))
        .rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException with last_admin when removing the only admin', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(
        makeMembership({ role: TenantRole.ADMIN }),
      );
      prisma.userTenantMembership.count.mockResolvedValue(1); // only 1 admin

      await expect(service.removeStaff('tenant-1', 'user-1'))
        .rejects.toThrow(new ConflictException('last_admin'));
    });

    it('removes an admin when at least 2 admins exist', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(
        makeMembership({ role: TenantRole.ADMIN }),
      );
      prisma.userTenantMembership.count.mockResolvedValue(2);
      prisma.userTenantMembership.delete.mockResolvedValue({});

      await expect(service.removeStaff('tenant-1', 'user-1')).resolves.toBeUndefined();
      expect(prisma.userTenantMembership.delete).toHaveBeenCalledWith({
        where: { userId_tenantId: { userId: 'user-1', tenantId: 'tenant-1' } },
      });
    });

    it('removes a staff member without checking admin count', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(
        makeMembership({ role: TenantRole.VET }),
      );
      prisma.userTenantMembership.delete.mockResolvedValue({});

      await service.removeStaff('tenant-1', 'user-1');

      // Admin count should not be queried for non-admin roles
      expect(prisma.userTenantMembership.count).not.toHaveBeenCalled();
      expect(prisma.userTenantMembership.delete).toHaveBeenCalled();
    });
  });

  // ── updateStaffRole ───────────────────────────────────────────────────────

  describe('updateStaffRole', () => {
    it('throws NotFoundException when membership does not exist', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(null);

      await expect(service.updateStaffRole('tenant-1', 'user-1', TenantRole.VET))
        .rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException with last_admin when demoting the only admin', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(
        makeMembership({ role: TenantRole.ADMIN }),
      );
      prisma.userTenantMembership.count.mockResolvedValue(1);

      await expect(service.updateStaffRole('tenant-1', 'user-1', TenantRole.VET))
        .rejects.toThrow(new ConflictException('last_admin'));
    });

    it('allows demotion when 2 or more admins exist', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(
        makeMembership({ role: TenantRole.ADMIN }),
      );
      prisma.userTenantMembership.count.mockResolvedValue(2);
      prisma.userTenantMembership.update.mockResolvedValue({});

      await expect(service.updateStaffRole('tenant-1', 'user-1', TenantRole.VET))
        .resolves.toBeUndefined();
      expect(prisma.userTenantMembership.update).toHaveBeenCalledWith({
        where: { userId_tenantId: { userId: 'user-1', tenantId: 'tenant-1' } },
        data: { role: TenantRole.VET },
      });
    });

    it('promotes a staff member to admin without checking admin count', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(
        makeMembership({ role: TenantRole.VET }),
      );
      prisma.userTenantMembership.update.mockResolvedValue({});

      await service.updateStaffRole('tenant-1', 'user-1', TenantRole.ADMIN);

      expect(prisma.userTenantMembership.count).not.toHaveBeenCalled();
      expect(prisma.userTenantMembership.update).toHaveBeenCalledWith({
        where: { userId_tenantId: { userId: 'user-1', tenantId: 'tenant-1' } },
        data: { role: TenantRole.ADMIN },
      });
    });

    it('does not trigger last_admin check when changing between non-admin roles', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(
        makeMembership({ role: TenantRole.VET }),
      );
      prisma.userTenantMembership.update.mockResolvedValue({});

      await service.updateStaffRole('tenant-1', 'user-1', TenantRole.VET);

      expect(prisma.userTenantMembership.count).not.toHaveBeenCalled();
    });
  });
});

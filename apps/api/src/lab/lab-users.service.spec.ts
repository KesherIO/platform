import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { LabUsersService } from './lab-users.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';

const LAB_ID = 'lab-1';
const USER_ID = 'user-1';
const ADMIN_ID = 'admin-1';

const mockMembership = {
  userId: USER_ID,
  tenantId: LAB_ID,
  role: 'TECHNICIAN',
  canPerformPickups: false,
  schedule: null,
  createdAt: new Date('2026-07-01'),
};

describe('LabUsersService', () => {
  let service: LabUsersService;
  let prisma: Record<string, any>;
  let auth: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      userTenantMembership: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ timezone: 'UTC' }),
      },
      $transaction: jest.fn((fn: (tx: any) => Promise<any>) => fn(prisma)),
    };

    auth = {
      createSupabaseUser: jest.fn(),
      deleteSupabaseUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LabUsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuthService, useValue: auth },
      ],
    }).compile();

    service = module.get<LabUsersService>(LabUsersService);
  });

  it('creates without error', () => {
    expect(service).toBeDefined();
  });

  describe('getLabMembers', () => {
    it('returns formatted member list', async () => {
      prisma.userTenantMembership.findMany.mockResolvedValue([
        {
          userId: USER_ID,
          role: 'TECHNICIAN',
          canPerformPickups: false,
          createdAt: new Date('2026-07-01'),
          schedule: null,
          user: {
            id: USER_ID,
            email: 'tech@lab.com',
            firstName: 'Jane',
            lastName: 'Doe',
            createdAt: new Date(),
          },
        },
      ]);

      const result = await service.getLabMembers(LAB_ID);

      expect(result).toHaveLength(1);
      expect(result[0].email).toBe('tech@lab.com');
      expect(result[0].role).toBe('TECHNICIAN');
      expect(result[0].firstName).toBe('Jane');
      expect(result[0].schedule).toBeNull();
      expect(result[0].canPerformPickups).toBe(false);
      expect(result[0].isCurrentlyScheduled).toBe(false);
    });

    it('marks a messenger as currently scheduled using the lab timezone', async () => {
      prisma.tenant.findUniqueOrThrow.mockResolvedValue({
        timezone: 'America/New_York',
      });
      prisma.userTenantMembership.findMany.mockResolvedValue([
        {
          userId: USER_ID,
          role: 'MESSENGER',
          canPerformPickups: false,
          createdAt: new Date('2026-07-01'),
          schedule: {
            MONDAY: { start: '00:00', end: '23:59' },
            TUESDAY: { start: '00:00', end: '23:59' },
            WEDNESDAY: { start: '00:00', end: '23:59' },
            THURSDAY: { start: '00:00', end: '23:59' },
            FRIDAY: { start: '00:00', end: '23:59' },
            SATURDAY: { start: '00:00', end: '23:59' },
            SUNDAY: { start: '00:00', end: '23:59' },
          },
          user: {
            id: USER_ID,
            email: 'messenger@lab.com',
            firstName: 'Sam',
            lastName: 'Courier',
            createdAt: new Date(),
          },
        },
      ]);

      const result = await service.getLabMembers(LAB_ID);

      expect(result[0].isCurrentlyScheduled).toBe(true);
    });
  });

  describe('updateRole', () => {
    it('throws ForbiddenException when changing own role', async () => {
      await expect(
        service.updateRole(LAB_ID, USER_ID, 'ADMIN', USER_ID)
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when user is not a member', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.updateRole(LAB_ID, USER_ID, 'ADMIN', ADMIN_ID)
      ).rejects.toThrow(NotFoundException);
    });

    it('updates role successfully', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(mockMembership);
      prisma.userTenantMembership.update.mockResolvedValue({
        ...mockMembership,
        role: 'ADMIN',
      });

      await service.updateRole(LAB_ID, USER_ID, 'ADMIN', ADMIN_ID);

      expect(prisma.userTenantMembership.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { role: 'ADMIN' },
        })
      );
    });

    it('clears canPerformPickups when changing role to MESSENGER', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue({
        ...mockMembership,
        canPerformPickups: true,
      });
      prisma.userTenantMembership.update.mockResolvedValue({
        ...mockMembership,
        role: 'MESSENGER',
        canPerformPickups: false,
      });

      await service.updateRole(LAB_ID, USER_ID, 'MESSENGER', ADMIN_ID);

      expect(prisma.userTenantMembership.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { role: 'MESSENGER', canPerformPickups: false },
        })
      );
    });

    it('clears canPerformPickups when changing role from MESSENGER', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue({
        ...mockMembership,
        role: 'MESSENGER',
      });
      prisma.userTenantMembership.update.mockResolvedValue({
        ...mockMembership,
        role: 'TECHNICIAN',
      });

      await service.updateRole(LAB_ID, USER_ID, 'TECHNICIAN', ADMIN_ID);

      expect(prisma.userTenantMembership.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { role: 'TECHNICIAN', canPerformPickups: false },
        })
      );
    });
  });

  describe('updateUser', () => {
    it('throws NotFoundException when user is not a member', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.updateUser(LAB_ID, USER_ID, { firstName: 'Updated' })
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when email is already taken', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(mockMembership);
      prisma.user.findFirst.mockResolvedValue({ id: 'other-user' });

      await expect(
        service.updateUser(LAB_ID, USER_ID, { email: 'taken@lab.com' })
      ).rejects.toThrow(ConflictException);
    });

    it('updates user info and returns result with role', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(mockMembership);
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue({
        id: USER_ID,
        email: 'new@lab.com',
        firstName: 'Updated',
        lastName: 'Name',
      });

      const result = await service.updateUser(LAB_ID, USER_ID, {
        firstName: 'Updated',
        lastName: 'Name',
        email: 'new@lab.com',
      });

      expect(result.userId).toBe(USER_ID);
      expect(result.firstName).toBe('Updated');
      expect(result.email).toBe('new@lab.com');
      expect(result.role).toBe('TECHNICIAN');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: USER_ID },
          data: expect.objectContaining({
            firstName: 'Updated',
            lastName: 'Name',
            email: 'new@lab.com',
          }),
        })
      );
    });

    it('skips email uniqueness check when email is not provided', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(mockMembership);
      prisma.user.update.mockResolvedValue({
        id: USER_ID,
        email: 'existing@lab.com',
        firstName: 'Updated',
        lastName: null,
      });

      await service.updateUser(LAB_ID, USER_ID, { firstName: 'Updated' });

      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('validates and persists a valid weekly schedule', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(mockMembership);
      prisma.user.update.mockResolvedValue({
        id: USER_ID,
        email: mockMembership.userId,
        firstName: 'Sam',
        lastName: 'Courier',
      });

      const schedule = {
        MONDAY: { start: '09:00', end: '17:00' },
        TUESDAY: null,
        WEDNESDAY: null,
        THURSDAY: null,
        FRIDAY: null,
        SATURDAY: null,
        SUNDAY: null,
      };

      const result = await service.updateUser(LAB_ID, USER_ID, { schedule });

      expect(prisma.userTenantMembership.update).toHaveBeenCalledWith({
        where: { userId_tenantId: { userId: USER_ID, tenantId: LAB_ID } },
        data: { schedule },
      });
      expect(result.schedule).toEqual(schedule);
    });

    it('rejects a malformed weekly schedule', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(mockMembership);
      prisma.user.update.mockResolvedValue({
        id: USER_ID,
        email: 'x@lab.com',
        firstName: 'Sam',
        lastName: 'Courier',
      });

      await expect(
        service.updateUser(LAB_ID, USER_ID, {
          schedule: { MONDAY: { start: '25:00', end: '17:00' } } as any,
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('persists canPerformPickups for a non-MESSENGER user', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(mockMembership);
      prisma.user.update.mockResolvedValue({
        id: USER_ID,
        email: 'tech@lab.com',
        firstName: 'Jane',
        lastName: 'Doe',
      });

      const result = await service.updateUser(LAB_ID, USER_ID, {
        canPerformPickups: true,
      } as any);

      expect(prisma.userTenantMembership.update).toHaveBeenCalledWith({
        where: { userId_tenantId: { userId: USER_ID, tenantId: LAB_ID } },
        data: { canPerformPickups: true },
      });
      expect(result.canPerformPickups).toBe(true);
    });

    it('ignores canPerformPickups for a MESSENGER user', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue({
        ...mockMembership,
        role: 'MESSENGER',
      });
      prisma.user.update.mockResolvedValue({
        id: USER_ID,
        email: 'msg@lab.com',
        firstName: 'Sam',
        lastName: 'Courier',
      });

      const result = await service.updateUser(LAB_ID, USER_ID, {
        canPerformPickups: true,
      } as any);

      expect(prisma.userTenantMembership.update).toHaveBeenCalledWith({
        where: { userId_tenantId: { userId: USER_ID, tenantId: LAB_ID } },
        data: { canPerformPickups: false },
      });
      expect(result.canPerformPickups).toBe(false);
    });
  });

  describe('removeMember', () => {
    it('throws ForbiddenException when removing self', async () => {
      await expect(
        service.removeMember(LAB_ID, USER_ID, USER_ID)
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when user is not a member', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.removeMember(LAB_ID, USER_ID, ADMIN_ID)
      ).rejects.toThrow(NotFoundException);
    });

    it('deletes the membership', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(mockMembership);
      prisma.userTenantMembership.delete.mockResolvedValue({});

      await service.removeMember(LAB_ID, USER_ID, ADMIN_ID);

      expect(prisma.userTenantMembership.delete).toHaveBeenCalledWith({
        where: { userId_tenantId: { userId: USER_ID, tenantId: LAB_ID } },
      });
    });
  });
});

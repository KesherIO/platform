import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { TenantRole } from '@prisma/client';
import { LabUsersService } from './lab-users.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';

const LAB_ID = 'lab-1';
const USER_ID = 'user-1';
const ADMIN_ID = 'admin-1';
const REASON = 'Covers the night shift';

const mockMembership = {
  userId: USER_ID,
  tenantId: LAB_ID,
  role: 'TECHNICIAN',
  canPerformPickups: false,
  canViewInProgress: false,
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
        findMany: jest.fn().mockResolvedValue([]),
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
        count: jest.fn().mockResolvedValue(0),
      },
      membershipEvent: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      labSigner: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
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

    it("adds the member's linked signer roles", async () => {
      prisma.userTenantMembership.findMany.mockResolvedValue([
        {
          userId: USER_ID,
          role: 'TECHNICIAN',
          canPerformPickups: false,
          createdAt: new Date('2026-07-01'),
          schedule: null,
          user: { id: USER_ID, email: 'tech@lab.com' },
        },
        {
          userId: 'other',
          role: 'ADMIN',
          canPerformPickups: false,
          createdAt: new Date('2026-07-01'),
          schedule: null,
          user: { id: 'other', email: 'admin@lab.com' },
        },
      ]);
      prisma.labSigner.findMany.mockResolvedValue([
        { userId: USER_ID, roles: ['ANALYST', 'REVIEWER'] },
      ]);

      const result = await service.getLabMembers(LAB_ID);

      expect(prisma.labSigner.findMany).toHaveBeenCalledWith({
        where: {
          laboratoryProfile: { tenantId: LAB_ID },
          userId: { not: null },
        },
        select: { userId: true, roles: true },
      });
      expect(result.map((m) => m.signerRoles)).toEqual([
        ['ANALYST', 'REVIEWER'],
        null,
      ]);
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
        service.updateRole(
          LAB_ID,
          USER_ID,
          'ADMIN',
          REASON,
          USER_ID,
          TenantRole.ADMIN
        )
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when user is not a member', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.updateRole(
          LAB_ID,
          USER_ID,
          'ADMIN',
          REASON,
          ADMIN_ID,
          TenantRole.ADMIN
        )
      ).rejects.toThrow(NotFoundException);
    });

    it('updates role successfully', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(mockMembership);
      prisma.userTenantMembership.update.mockResolvedValue({
        ...mockMembership,
        role: 'ADMIN',
      });

      await service.updateRole(
        LAB_ID,
        USER_ID,
        'ADMIN',
        REASON,
        ADMIN_ID,
        TenantRole.ADMIN
      );

      expect(prisma.userTenantMembership.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { role: 'ADMIN', canViewInProgress: false },
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

      await service.updateRole(
        LAB_ID,
        USER_ID,
        'MESSENGER',
        REASON,
        ADMIN_ID,
        TenantRole.ADMIN
      );

      expect(prisma.userTenantMembership.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            role: 'MESSENGER',
            canPerformPickups: false,
            canViewInProgress: false,
          },
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
        role: 'ANALYST',
      });

      await service.updateRole(
        LAB_ID,
        USER_ID,
        'ANALYST',
        REASON,
        ADMIN_ID,
        TenantRole.ADMIN
      );

      expect(prisma.userTenantMembership.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            role: 'ANALYST',
            canPerformPickups: false,
            canViewInProgress: false,
          },
        })
      );
    });
  });

  describe('updateUser', () => {
    it('throws NotFoundException when user is not a member', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.updateUser(LAB_ID, USER_ID, { firstName: 'Updated' }, ADMIN_ID)
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when email is already taken', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(mockMembership);
      prisma.user.findFirst.mockResolvedValue({ id: 'other-user' });

      await expect(
        service.updateUser(
          LAB_ID,
          USER_ID,
          { email: 'taken@lab.com' },
          ADMIN_ID
        )
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

      const result = await service.updateUser(
        LAB_ID,
        USER_ID,
        {
          firstName: 'Updated',
          lastName: 'Name',
          email: 'new@lab.com',
        },
        ADMIN_ID
      );

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

      await service.updateUser(
        LAB_ID,
        USER_ID,
        { firstName: 'Updated' },
        ADMIN_ID
      );

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

      const result = await service.updateUser(
        LAB_ID,
        USER_ID,
        { schedule },
        ADMIN_ID
      );

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
        service.updateUser(
          LAB_ID,
          USER_ID,
          {
            schedule: { MONDAY: { start: '25:00', end: '17:00' } } as any,
          },
          ADMIN_ID
        )
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

      const result = await service.updateUser(
        LAB_ID,
        USER_ID,
        {
          canPerformPickups: true,
        } as any,
        ADMIN_ID
      );

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

      const result = await service.updateUser(
        LAB_ID,
        USER_ID,
        {
          canPerformPickups: true,
        } as any,
        ADMIN_ID
      );

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
        service.removeMember(LAB_ID, USER_ID, REASON, USER_ID, TenantRole.ADMIN)
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when user is not a member', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.removeMember(
          LAB_ID,
          USER_ID,
          REASON,
          ADMIN_ID,
          TenantRole.ADMIN
        )
      ).rejects.toThrow(NotFoundException);
    });

    it('deletes the membership', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(mockMembership);
      prisma.userTenantMembership.delete.mockResolvedValue({});

      await service.removeMember(
        LAB_ID,
        USER_ID,
        REASON,
        ADMIN_ID,
        TenantRole.ADMIN
      );

      expect(prisma.userTenantMembership.delete).toHaveBeenCalledWith({
        where: { userId_tenantId: { userId: USER_ID, tenantId: LAB_ID } },
      });
    });
  });

  describe('owner protection', () => {
    const owner = { userId: USER_ID, tenantId: LAB_ID, role: 'OWNER' };

    beforeEach(() => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(owner);
      prisma.userTenantMembership.update.mockResolvedValue({});
      prisma.userTenantMembership.delete.mockResolvedValue({});
    });

    it('an admin cannot demote an owner', async () => {
      prisma.userTenantMembership.count.mockResolvedValue(1);

      await expect(
        service.updateRole(
          LAB_ID,
          USER_ID,
          'ADMIN',
          REASON,
          ADMIN_ID,
          TenantRole.ADMIN
        )
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.userTenantMembership.update).not.toHaveBeenCalled();
    });

    it('an admin cannot remove an owner', async () => {
      prisma.userTenantMembership.count.mockResolvedValue(1);

      await expect(
        service.removeMember(
          LAB_ID,
          USER_ID,
          REASON,
          ADMIN_ID,
          TenantRole.ADMIN
        )
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.userTenantMembership.delete).not.toHaveBeenCalled();
    });

    it('an owner cannot demote the last owner', async () => {
      prisma.userTenantMembership.count.mockResolvedValue(0);

      await expect(
        service.updateRole(
          LAB_ID,
          USER_ID,
          'ADMIN',
          REASON,
          ADMIN_ID,
          TenantRole.OWNER
        )
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.userTenantMembership.update).not.toHaveBeenCalled();
    });

    it('an owner cannot remove the last owner', async () => {
      prisma.userTenantMembership.count.mockResolvedValue(0);

      await expect(
        service.removeMember(
          LAB_ID,
          USER_ID,
          REASON,
          ADMIN_ID,
          TenantRole.OWNER
        )
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.userTenantMembership.delete).not.toHaveBeenCalled();
    });

    it('an owner can demote another owner when one remains', async () => {
      prisma.userTenantMembership.count.mockResolvedValue(1);

      await service.updateRole(
        LAB_ID,
        USER_ID,
        'ADMIN',
        REASON,
        ADMIN_ID,
        TenantRole.OWNER
      );

      expect(prisma.userTenantMembership.count).toHaveBeenCalledWith({
        where: {
          tenantId: LAB_ID,
          role: TenantRole.OWNER,
          userId: { not: USER_ID },
        },
      });
      expect(prisma.userTenantMembership.update).toHaveBeenCalled();
    });

    it('locks the owner memberships before counting', async () => {
      prisma.userTenantMembership.count.mockResolvedValue(1);

      await service.removeMember(
        LAB_ID,
        USER_ID,
        REASON,
        ADMIN_ID,
        TenantRole.OWNER
      );

      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.userTenantMembership.count.mock.invocationCallOrder[0]
      );
    });

    it('admins still manage non-owner members', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue({
        ...owner,
        role: 'TECHNICIAN',
      });

      await service.removeMember(
        LAB_ID,
        USER_ID,
        REASON,
        ADMIN_ID,
        TenantRole.ADMIN
      );

      expect(prisma.userTenantMembership.count).not.toHaveBeenCalled();
      expect(prisma.userTenantMembership.delete).toHaveBeenCalled();
    });
  });

  describe('membership audit log', () => {
    const event = () => prisma.membershipEvent.create.mock.calls[0][0].data;

    beforeEach(() => {
      prisma.user.findMany.mockResolvedValue([
        {
          id: USER_ID,
          email: 'tech@lab.com',
          firstName: 'Jane',
          lastName: 'Doe',
        },
        {
          id: ADMIN_ID,
          email: 'admin@lab.com',
          firstName: null,
          lastName: null,
        },
      ]);
    });

    it('logs MEMBER_ADDED with the actor when a user is created', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      auth.createSupabaseUser.mockResolvedValue(USER_ID);
      prisma.user.upsert.mockResolvedValue({
        id: USER_ID,
        email: 'tech@lab.com',
      });
      prisma.userTenantMembership.create.mockResolvedValue({
        ...mockMembership,
        status: 'ACTIVE',
      });

      await service.createLabUser(
        LAB_ID,
        {
          email: 'tech@lab.com',
          password: 'long-password',
          firstName: 'Jane',
          lastName: 'Doe',
          role: 'TECHNICIAN',
        },
        ADMIN_ID
      );

      expect(event()).toEqual({
        tenantId: LAB_ID,
        eventType: 'MEMBER_ADDED',
        targetUserId: USER_ID,
        targetName: 'Jane Doe',
        targetEmail: 'tech@lab.com',
        actorUserId: ADMIN_ID,
        actorName: 'admin@lab.com',
        source: 'lab_users',
        newRole: 'TECHNICIAN',
        newStatus: 'ACTIVE',
        newCanPerformPickups: false,
        newCanViewInProgress: false,
        reason: null,
      });
    });

    it('bootstrap logs MEMBER_ADDED as a system action', async () => {
      prisma.userTenantMembership.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      auth.createSupabaseUser.mockResolvedValue(USER_ID);
      prisma.user.upsert.mockResolvedValue({ id: USER_ID });
      prisma.userTenantMembership.create.mockResolvedValue({
        ...mockMembership,
        role: 'ADMIN',
      });

      await service.bootstrapAdmin(LAB_ID, {
        email: 'a@lab.com',
        password: 'long-password',
        firstName: 'A',
        lastName: 'B',
        role: 'ADMIN',
      });

      expect(event()).toMatchObject({
        actorUserId: null,
        actorName: null,
        source: 'lab_setup',
        newRole: 'ADMIN',
      });
    });

    it('logs no event when the user already belongs to the lab (retry)', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: USER_ID });
      prisma.userTenantMembership.findUnique.mockResolvedValue(mockMembership);

      await expect(
        service.createLabUser(
          LAB_ID,
          {
            email: 'tech@lab.com',
            password: 'long-password',
            firstName: 'Jane',
            lastName: 'Doe',
            role: 'TECHNICIAN',
          },
          ADMIN_ID
        )
      ).rejects.toThrow(ConflictException);
      expect(prisma.membershipEvent.create).not.toHaveBeenCalled();
    });

    it('logs ROLE_CHANGED with previous/new role, pickups and reason', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue({
        ...mockMembership,
        canPerformPickups: true,
      });
      prisma.userTenantMembership.update.mockResolvedValue({
        ...mockMembership,
        role: 'MESSENGER',
        canPerformPickups: false,
      });

      await service.updateRole(
        LAB_ID,
        USER_ID,
        'MESSENGER',
        `  ${REASON}  `,
        ADMIN_ID,
        TenantRole.ADMIN
      );

      expect(event()).toMatchObject({
        eventType: 'ROLE_CHANGED',
        actorUserId: ADMIN_ID,
        previousRole: 'TECHNICIAN',
        newRole: 'MESSENGER',
        previousCanPerformPickups: true,
        newCanPerformPickups: false,
        reason: REASON,
      });
    });

    it('a same-role request changes nothing and logs nothing', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(mockMembership);

      await service.updateRole(
        LAB_ID,
        USER_ID,
        'TECHNICIAN',
        REASON,
        ADMIN_ID,
        TenantRole.ADMIN
      );

      expect(prisma.userTenantMembership.update).not.toHaveBeenCalled();
      expect(prisma.membershipEvent.create).not.toHaveBeenCalled();
    });

    it('locks the target membership before reading it', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(mockMembership);
      prisma.userTenantMembership.update.mockResolvedValue({
        ...mockMembership,
        role: 'ADMIN',
      });

      await service.updateRole(
        LAB_ID,
        USER_ID,
        'ADMIN',
        REASON,
        ADMIN_ID,
        TenantRole.ADMIN
      );

      const lockSql = prisma.$queryRaw.mock.calls
        .map((c: [TemplateStringsArray]) => c[0].join('?'))
        .find((sql: string) => sql.includes('"userId" = ?'));
      expect(lockSql).toContain('FOR UPDATE');
      expect(prisma.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
        prisma.userTenantMembership.findUnique.mock.invocationCallOrder[0]
      );
    });

    it('a rejected role change (owner protection) logs nothing', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue({
        ...mockMembership,
        role: 'OWNER',
      });

      await expect(
        service.updateRole(
          LAB_ID,
          USER_ID,
          'ADMIN',
          REASON,
          ADMIN_ID,
          TenantRole.ADMIN
        )
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.membershipEvent.create).not.toHaveBeenCalled();
    });

    it('logs REMOVED with the last role/status and the reason', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue({
        ...mockMembership,
        status: 'ACTIVE',
      });

      await service.removeMember(
        LAB_ID,
        USER_ID,
        REASON,
        ADMIN_ID,
        TenantRole.ADMIN
      );

      expect(event()).toMatchObject({
        eventType: 'REMOVED',
        targetName: 'Jane Doe',
        previousRole: 'TECHNICIAN',
        previousStatus: 'ACTIVE',
        previousCanPerformPickups: false,
        reason: REASON,
      });
    });

    it('removing someone already removed (retry) logs nothing', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.removeMember(
          LAB_ID,
          USER_ID,
          REASON,
          ADMIN_ID,
          TenantRole.ADMIN
        )
      ).rejects.toThrow(NotFoundException);
      expect(prisma.membershipEvent.create).not.toHaveBeenCalled();
    });

    it('logs PICKUP_CAPABILITY_CHANGED when the flag flips', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(mockMembership);
      prisma.user.update.mockResolvedValue({ id: USER_ID });

      await service.updateUser(
        LAB_ID,
        USER_ID,
        { canPerformPickups: true, reason: 'Backup driver' },
        ADMIN_ID
      );

      expect(event()).toMatchObject({
        eventType: 'PICKUP_CAPABILITY_CHANGED',
        previousCanPerformPickups: false,
        newCanPerformPickups: true,
        reason: 'Backup driver',
      });
    });

    it('does not log unchanged pickups, schedule edits or profile edits', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue({
        ...mockMembership,
        role: 'MESSENGER',
      });
      prisma.user.update.mockResolvedValue({ id: USER_ID });

      await service.updateUser(
        LAB_ID,
        USER_ID,
        {
          firstName: 'New',
          canPerformPickups: true, // ignored for messengers → still false
          schedule: { MONDAY: { start: '09:00', end: '17:00' } } as any,
        },
        ADMIN_ID
      );

      expect(prisma.membershipEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('in-progress access (Consulta / Facturación)', () => {
    const viewer = { ...mockMembership, role: 'RESULTS_VIEWER' };
    const created = () =>
      prisma.userTenantMembership.create.mock.calls[0][0].data;

    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(null);
      auth.createSupabaseUser.mockResolvedValue(USER_ID);
      prisma.user.upsert.mockResolvedValue({ id: USER_ID });
      prisma.userTenantMembership.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => ({
          canPerformPickups: false,
          canViewInProgress: false,
          ...data,
        })
      );
    });

    const newUser = (role: string) => ({
      email: 'x@lab.com',
      password: 'long-password',
      firstName: 'X',
      lastName: 'Y',
      role,
      canViewInProgress: true,
      canPerformPickups: true,
    });

    it('a new results viewer can get it, never pickups', async () => {
      await service.createLabUser(LAB_ID, newUser('RESULTS_VIEWER'), ADMIN_ID);

      expect(created()).toMatchObject({ canViewInProgress: true });
      expect(created().canPerformPickups).toBeUndefined();
    });

    it('is ignored for any other role', async () => {
      await service.createLabUser(LAB_ID, newUser('ANALYST'), ADMIN_ID);

      expect(created().canViewInProgress).toBeUndefined();
      expect(created()).toMatchObject({ canPerformPickups: true });
    });

    it('turning it on for a viewer is saved and logged', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(viewer);
      prisma.user.update.mockResolvedValue({ id: USER_ID });

      const result = await service.updateUser(
        LAB_ID,
        USER_ID,
        { canViewInProgress: true, reason: 'Facturación' },
        ADMIN_ID
      );

      expect(prisma.userTenantMembership.update).toHaveBeenCalledWith({
        where: { userId_tenantId: { userId: USER_ID, tenantId: LAB_ID } },
        data: { canViewInProgress: true },
      });
      expect(result.canViewInProgress).toBe(true);
      expect(prisma.membershipEvent.create.mock.calls[0][0].data).toMatchObject(
        {
          eventType: 'IN_PROGRESS_ACCESS_CHANGED',
          previousCanViewInProgress: false,
          newCanViewInProgress: true,
          reason: 'Facturación',
        }
      );
    });

    it('stays off for a non-viewer and logs nothing', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(mockMembership);
      prisma.user.update.mockResolvedValue({ id: USER_ID });

      await service.updateUser(
        LAB_ID,
        USER_ID,
        { canViewInProgress: true },
        ADMIN_ID
      );

      expect(prisma.userTenantMembership.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { canViewInProgress: false } })
      );
      expect(prisma.membershipEvent.create).not.toHaveBeenCalled();
    });

    it('is cleared and recorded when the viewer gets another role', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue({
        ...viewer,
        canViewInProgress: true,
      });
      prisma.userTenantMembership.update.mockResolvedValue({
        ...viewer,
        role: 'ANALYST',
        canViewInProgress: false,
      });

      await service.updateRole(
        LAB_ID,
        USER_ID,
        'ANALYST',
        REASON,
        ADMIN_ID,
        TenantRole.ADMIN
      );

      expect(prisma.userTenantMembership.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { role: 'ANALYST', canViewInProgress: false },
        })
      );
      expect(prisma.membershipEvent.create.mock.calls[0][0].data).toMatchObject(
        {
          eventType: 'ROLE_CHANGED',
          previousCanViewInProgress: true,
          newCanViewInProgress: false,
        }
      );
    });

    it('a viewer loses pickups when the role changes to viewer', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue({
        ...mockMembership,
        canPerformPickups: true,
      });
      prisma.userTenantMembership.update.mockResolvedValue({
        ...viewer,
        canPerformPickups: false,
      });

      await service.updateRole(
        LAB_ID,
        USER_ID,
        'RESULTS_VIEWER',
        REASON,
        ADMIN_ID,
        TenantRole.ADMIN
      );

      expect(prisma.userTenantMembership.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { role: 'RESULTS_VIEWER', canPerformPickups: false },
        })
      );
    });
  });

  describe('getMembershipHistory', () => {
    const row = (id: string) => ({
      id,
      tenantId: LAB_ID,
      eventType: 'ROLE_CHANGED',
      targetUserId: USER_ID,
      createdAt: new Date('2026-10-15'),
    });

    it('is scoped to the lab and the person, not to current membership', async () => {
      await service.getMembershipHistory(LAB_ID, { userId: USER_ID });

      expect(prisma.membershipEvent.findMany).toHaveBeenCalledWith({
        where: { tenantId: LAB_ID, targetUserId: USER_ID },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 51,
      });
      expect(prisma.userTenantMembership.findUnique).not.toHaveBeenCalled();
    });

    it('pages with a cursor', async () => {
      prisma.membershipEvent.findMany.mockResolvedValue([
        row('e3'),
        row('e2'),
        row('e1'),
      ]);

      const result = await service.getMembershipHistory(LAB_ID, {
        cursor: 'e4',
        limit: 2,
      });

      expect(prisma.membershipEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: { id: 'e4' }, skip: 1, take: 3 })
      );
      expect(result.items.map((e) => e.id)).toEqual(['e3', 'e2']);
      expect(result.nextCursor).toBe('e2');
    });

    it('returns no cursor on the last page', async () => {
      prisma.membershipEvent.findMany.mockResolvedValue([row('e1')]);

      const result = await service.getMembershipHistory(LAB_ID, {});

      expect(result.nextCursor).toBeNull();
    });
  });

  describe('getRemovedMembers', () => {
    it('lists removed people who are not members again, newest first', async () => {
      prisma.membershipEvent.findMany.mockResolvedValue([
        {
          targetUserId: 'old-1',
          targetName: 'Old One',
          targetEmail: 'old1@lab.com',
          previousRole: 'TECHNICIAN',
          actorName: 'Admin',
          createdAt: new Date('2026-10-01'),
        },
        {
          targetUserId: 'back-again',
          createdAt: new Date('2026-10-02'),
        },
        {
          targetUserId: 'old-2',
          targetName: 'Old Two',
          createdAt: new Date('2026-10-03'),
        },
      ]);
      prisma.userTenantMembership.findMany.mockResolvedValue([
        { userId: 'back-again' },
      ]);

      const result = await service.getRemovedMembers(LAB_ID);

      expect(prisma.membershipEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: LAB_ID, eventType: 'REMOVED' },
          distinct: ['targetUserId'],
        })
      );
      expect(result.map((r) => r.userId)).toEqual(['old-2', 'old-1']);
      expect(result[1]).toMatchObject({
        name: 'Old One',
        lastRole: 'TECHNICIAN',
        removedByName: 'Admin',
      });
    });
  });
});

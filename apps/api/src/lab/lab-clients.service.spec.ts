import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { LabClientsService } from './lab-clients.service';
import { PrismaService } from '../prisma/prisma.service';

const LAB_ID = 'lab-1';
const CLIENT_ID = 'client-1';
const USER_ID = 'user-1';

const mockConnection = {
  id: 'conn-1',
  clinicId: CLIENT_ID,
  labId: LAB_ID,
  isActive: true,
  isDefault: true,
};

const mockClientTenant = {
  id: CLIENT_ID,
  name: 'Test Clinic',
  slug: 'test-clinic',
  type: 'CLINIC',
  clientType: 'VETERINARY_CLINIC',
  clientStatus: 'PENDING',
  primaryContactName: 'Dr. Smith',
  email: 'clinic@example.com',
  phone: '+1234567890',
  address: '123 Main St',
  createdAt: new Date('2026-07-01'),
  updatedAt: new Date('2026-07-01'),
  _count: { memberships: 0, orders: 0 },
  memberships: [],
  orders: [],
};

describe('LabClientsService', () => {
  let service: LabClientsService;
  let prisma: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      tenant: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      clinicLabConnection: {
        findFirst: jest.fn(),
        create: jest.fn(),
        deleteMany: jest.fn(),
      },
      onboardingToken: {
        findFirst: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      order: {
        count: jest.fn(),
      },
      userTenantMembership: {
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn((fn: (tx: any) => Promise<any>) => fn(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LabClientsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<LabClientsService>(LabClientsService);
  });

  it('creates without error', () => {
    expect(service).toBeDefined();
  });

  describe('listClients', () => {
    it('returns paginated client list', async () => {
      prisma.tenant.findMany.mockResolvedValue([mockClientTenant]);
      prisma.tenant.count.mockResolvedValue(1);

      const result = await service.listClients(LAB_ID, {});

      expect(prisma.tenant.findMany).toHaveBeenCalled();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('Test Clinic');
      expect(result.data[0].status).toBe('PENDING');
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
    });

    it('passes search filter to prisma query', async () => {
      prisma.tenant.findMany.mockResolvedValue([]);
      prisma.tenant.count.mockResolvedValue(0);

      await service.listClients(LAB_ID, { search: 'acme' });

      const call = prisma.tenant.findMany.mock.calls[0][0];
      const andConditions = call.where.AND;
      expect(andConditions).toHaveLength(2);
    });
  });

  describe('getClientDetail', () => {
    it('throws NotFoundException when connection does not exist', async () => {
      prisma.clinicLabConnection.findFirst.mockResolvedValue(null);

      await expect(service.getClientDetail(LAB_ID, CLIENT_ID)).rejects.toThrow(
        NotFoundException
      );
    });

    it('returns client detail with users, orders, and invitation', async () => {
      prisma.clinicLabConnection.findFirst.mockResolvedValue(mockConnection);
      prisma.tenant.findUniqueOrThrow.mockResolvedValue({
        ...mockClientTenant,
        _count: { orders: 0 },
        memberships: [],
        orders: [],
      });
      prisma.tenant.findUnique.mockResolvedValue({ name: 'Test Lab' });
      prisma.onboardingToken.findFirst.mockResolvedValue(null);

      const result = await service.getClientDetail(LAB_ID, CLIENT_ID);

      expect(result.name).toBe('Test Clinic');
      expect(result.laboratoryName).toBe('Test Lab');
      expect(result.orderCount).toBe(0);
      expect(result.users).toEqual([]);
      expect(result.recentOrders).toEqual([]);
      expect(result.invitation).toBeNull();
    });
  });

  describe('createClient', () => {
    it('throws ConflictException if email already connected to lab', async () => {
      prisma.tenant.findFirst.mockResolvedValueOnce({ id: 'existing' });

      await expect(
        service.createClient(
          LAB_ID,
          {
            name: 'New Clinic',
            clientType: 'VETERINARY_CLINIC',
            primaryContactEmail: 'existing@example.com',
          } as any,
          USER_ID
        )
      ).rejects.toThrow(ConflictException);
    });

    it('creates tenant, connection, and onboarding token in a transaction', async () => {
      prisma.tenant.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      prisma.tenant.create.mockResolvedValue({
        id: 'new-client-1',
        name: 'New Clinic',
      });
      prisma.clinicLabConnection.create.mockResolvedValue({});
      prisma.onboardingToken.create.mockResolvedValue({ id: 'token-1' });

      const result = await service.createClient(
        LAB_ID,
        {
          name: 'New Clinic',
          clientType: 'VETERINARY_CLINIC',
          primaryContactEmail: 'new@example.com',
        } as any,
        USER_ID
      );

      expect(result.clientId).toBe('new-client-1');
      expect(result.onboardingLink).toContain('/onboarding/welcome?token=');
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(prisma.tenant.create).toHaveBeenCalled();
      expect(prisma.clinicLabConnection.create).toHaveBeenCalled();
      expect(prisma.onboardingToken.create).toHaveBeenCalled();
    });
  });

  describe('updateClient', () => {
    it('throws NotFoundException when not connected', async () => {
      prisma.clinicLabConnection.findFirst.mockResolvedValue(null);

      await expect(
        service.updateClient(LAB_ID, CLIENT_ID, { name: 'Updated' })
      ).rejects.toThrow(NotFoundException);
    });

    it('updates client fields', async () => {
      prisma.clinicLabConnection.findFirst.mockResolvedValue(mockConnection);
      prisma.tenant.update.mockResolvedValue({
        id: CLIENT_ID,
        name: 'Updated Clinic',
      });

      const result = await service.updateClient(LAB_ID, CLIENT_ID, {
        name: 'Updated Clinic',
      });

      expect(prisma.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: CLIENT_ID },
          data: { name: 'Updated Clinic' },
        })
      );
      expect(result.name).toBe('Updated Clinic');
    });
  });

  describe('suspendClient', () => {
    it('throws BadRequestException if already suspended', async () => {
      prisma.clinicLabConnection.findFirst.mockResolvedValue(mockConnection);
      prisma.tenant.findUniqueOrThrow.mockResolvedValue({
        clientStatus: 'SUSPENDED',
      });

      await expect(service.suspendClient(LAB_ID, CLIENT_ID)).rejects.toThrow(
        BadRequestException
      );
    });

    it('sets client status to SUSPENDED', async () => {
      prisma.clinicLabConnection.findFirst.mockResolvedValue(mockConnection);
      prisma.tenant.findUniqueOrThrow.mockResolvedValue({
        clientStatus: 'ACTIVE',
      });
      prisma.tenant.update.mockResolvedValue({
        id: CLIENT_ID,
        clientStatus: 'SUSPENDED',
      });

      await service.suspendClient(LAB_ID, CLIENT_ID);

      expect(prisma.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { clientStatus: 'SUSPENDED' },
        })
      );
    });
  });

  describe('reactivateClient', () => {
    it('throws BadRequestException if not suspended', async () => {
      prisma.clinicLabConnection.findFirst.mockResolvedValue(mockConnection);
      prisma.tenant.findUniqueOrThrow.mockResolvedValue({
        clientStatus: 'ACTIVE',
      });

      await expect(service.reactivateClient(LAB_ID, CLIENT_ID)).rejects.toThrow(
        BadRequestException
      );
    });

    it('sets client status to ACTIVE', async () => {
      prisma.clinicLabConnection.findFirst.mockResolvedValue(mockConnection);
      prisma.tenant.findUniqueOrThrow.mockResolvedValue({
        clientStatus: 'SUSPENDED',
      });
      prisma.tenant.update.mockResolvedValue({
        id: CLIENT_ID,
        clientStatus: 'ACTIVE',
      });

      await service.reactivateClient(LAB_ID, CLIENT_ID);

      expect(prisma.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { clientStatus: 'ACTIVE' },
        })
      );
    });
  });

  describe('revokeInvitation', () => {
    it('throws NotFoundException when no active invitation exists', async () => {
      prisma.clinicLabConnection.findFirst.mockResolvedValue(mockConnection);
      prisma.tenant.findUniqueOrThrow.mockResolvedValue({
        email: 'clinic@example.com',
      });
      prisma.onboardingToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.revokeInvitation(LAB_ID, CLIENT_ID)).rejects.toThrow(
        NotFoundException
      );
    });

    it('revokes active invitation tokens', async () => {
      prisma.clinicLabConnection.findFirst.mockResolvedValue(mockConnection);
      prisma.tenant.findUniqueOrThrow.mockResolvedValue({
        email: 'clinic@example.com',
      });
      prisma.onboardingToken.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.revokeInvitation(LAB_ID, CLIENT_ID);

      expect(result.revoked).toBe(1);
      expect(prisma.onboardingToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { revokedAt: expect.any(Date) },
        })
      );
    });
  });

  describe('deleteClient', () => {
    it('throws BadRequestException when client has orders', async () => {
      prisma.clinicLabConnection.findFirst.mockResolvedValue(mockConnection);
      prisma.order.count.mockResolvedValue(3);

      await expect(service.deleteClient(LAB_ID, CLIENT_ID)).rejects.toThrow(
        BadRequestException
      );
    });

    it('deletes client with no orders in a transaction', async () => {
      prisma.clinicLabConnection.findFirst.mockResolvedValue(mockConnection);
      prisma.order.count.mockResolvedValue(0);
      prisma.onboardingToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.clinicLabConnection.deleteMany.mockResolvedValue({ count: 1 });
      prisma.userTenantMembership.deleteMany.mockResolvedValue({ count: 0 });
      prisma.tenant.delete.mockResolvedValue({});

      await service.deleteClient(LAB_ID, CLIENT_ID);

      expect(prisma.tenant.delete).toHaveBeenCalledWith({
        where: { id: CLIENT_ID },
      });
    });
  });
});

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

/** Where clause every invitation lookup must use: this lab + this clinic. */
const PENDING_INVITATIONS_WHERE = {
  laboratoryId: LAB_ID,
  clinicTenantId: CLIENT_ID,
  used: false,
  revokedAt: null,
};

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
  city: 'Bogotá',
  country: 'CO',
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
        count: jest.fn().mockResolvedValue(0),
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
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn(),
      },
      user: {
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: CLIENT_ID }]),
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

    it('returns the full shared clinic profile, including fields set during onboarding', async () => {
      prisma.clinicLabConnection.findFirst.mockResolvedValue(mockConnection);
      prisma.tenant.findUniqueOrThrow.mockResolvedValue(mockClientTenant);
      prisma.tenant.findUnique.mockResolvedValue({ name: 'Test Lab' });
      prisma.onboardingToken.findFirst.mockResolvedValue(null);

      const result = await service.getClientDetail(LAB_ID, CLIENT_ID);

      expect(prisma.tenant.findUniqueOrThrow.mock.calls[0][0].select).toEqual(
        expect.objectContaining({
          name: true,
          email: true,
          primaryContactName: true,
          phone: true,
          address: true,
          city: true,
          country: true,
        })
      );
      expect(result).toEqual(
        expect.objectContaining({
          primaryContactName: 'Dr. Smith',
          primaryContactEmail: 'clinic@example.com',
          phone: '+1234567890',
          address: '123 Main St',
          city: 'Bogotá',
          country: 'CO',
        })
      );
    });

    it('looks up the invitation by clinicTenantId scoped to the lab, not by email', async () => {
      prisma.clinicLabConnection.findFirst.mockResolvedValue(mockConnection);
      prisma.tenant.findUniqueOrThrow.mockResolvedValue({
        ...mockClientTenant,
        email: 'renamed@example.com',
      });
      prisma.tenant.findUnique.mockResolvedValue({ name: 'Test Lab' });
      prisma.onboardingToken.findFirst.mockResolvedValue({
        id: 'token-1',
        clinicEmail: 'clinic@example.com',
        expiresAt: new Date('2026-07-08'),
        used: false,
        usedAt: null,
        revokedAt: null,
        createdAt: new Date('2026-07-01'),
      });

      const result = await service.getClientDetail(LAB_ID, CLIENT_ID);

      expect(prisma.onboardingToken.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { laboratoryId: LAB_ID, clinicTenantId: CLIENT_ID },
        })
      );
      expect(result.invitation?.id).toBe('token-1');
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

    it('stores the full profile and links the invitation to the new clinic', async () => {
      prisma.tenant.findFirst.mockResolvedValue(null);
      prisma.tenant.create.mockResolvedValue({ id: 'new-client-1' });
      prisma.clinicLabConnection.create.mockResolvedValue({});
      prisma.onboardingToken.create.mockResolvedValue({ id: 'token-1' });

      await service.createClient(
        LAB_ID,
        {
          name: 'New Clinic',
          clientType: 'VETERINARY_CLINIC',
          primaryContactName: 'Dr. Ana',
          primaryContactEmail: 'new@example.com',
          phone: '+57 300 000 0000',
          address: 'Calle 1 #2-3',
          city: 'Medellín',
          country: 'CO',
        },
        USER_ID
      );

      expect(prisma.tenant.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({
          name: 'New Clinic',
          email: 'new@example.com',
          primaryContactName: 'Dr. Ana',
          phone: '+57 300 000 0000',
          address: 'Calle 1 #2-3',
          city: 'Medellín',
          country: 'CO',
        })
      );
      expect(prisma.onboardingToken.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({
          laboratoryId: LAB_ID,
          clinicTenantId: 'new-client-1',
        })
      );
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

    it('preserves omitted fields and clears fields sent as empty or null', async () => {
      prisma.clinicLabConnection.findFirst.mockResolvedValue(mockConnection);
      prisma.tenant.update.mockResolvedValue({ id: CLIENT_ID });

      await service.updateClient(LAB_ID, CLIENT_ID, {
        phone: '',
        address: null,
        city: 'Cali',
      });

      // name/email/primaryContactName/country omitted → absent from the update
      expect(prisma.tenant.update.mock.calls[0][0].data).toEqual({
        phone: null,
        address: null,
        city: 'Cali',
      });
    });

    it('rejects clearing the clinic name', async () => {
      prisma.clinicLabConnection.findFirst.mockResolvedValue(mockConnection);

      await expect(
        service.updateClient(LAB_ID, CLIENT_ID, { name: '  ' })
      ).rejects.toThrow(BadRequestException);
      expect(prisma.tenant.update).not.toHaveBeenCalled();
    });

    it('keeps pending invitations in sync when the email changes', async () => {
      prisma.clinicLabConnection.findFirst.mockResolvedValue(mockConnection);
      prisma.tenant.update.mockResolvedValue({
        id: CLIENT_ID,
        email: 'renamed@example.com',
      });
      prisma.onboardingToken.updateMany.mockResolvedValue({ count: 1 });

      await service.updateClient(LAB_ID, CLIENT_ID, {
        primaryContactEmail: 'renamed@example.com',
      });

      expect(prisma.tenant.update.mock.calls[0][0].data).toEqual({
        email: 'renamed@example.com',
      });
      expect(prisma.onboardingToken.updateMany).toHaveBeenCalledWith({
        where: PENDING_INVITATIONS_WHERE,
        data: { clinicEmail: 'renamed@example.com' },
      });
    });
  });

  describe('invitation management after an email change', () => {
    // Regression: lookups used to match clinicEmail = tenant.email, so once the
    // lab corrected a client's email the invitation could no longer be found.
    beforeEach(() => {
      prisma.clinicLabConnection.findFirst.mockResolvedValue(mockConnection);
      prisma.tenant.findUniqueOrThrow.mockResolvedValue({
        name: 'Test Clinic',
        email: 'renamed@example.com',
        clientType: 'VETERINARY_CLINIC',
      });
    });

    it('revoke still finds the invitation sent to the old email', async () => {
      prisma.onboardingToken.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.revokeInvitation(LAB_ID, CLIENT_ID);

      expect(result.revoked).toBe(1);
      expect(prisma.onboardingToken.updateMany).toHaveBeenCalledWith({
        where: PENDING_INVITATIONS_WHERE,
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('regenerate revokes the old invitation and issues one for the current email', async () => {
      prisma.onboardingToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.onboardingToken.create.mockResolvedValue({ id: 'token-2' });

      const result = await service.regenerateInvitation(
        LAB_ID,
        CLIENT_ID,
        USER_ID
      );

      expect(prisma.onboardingToken.updateMany).toHaveBeenCalledWith({
        where: PENDING_INVITATIONS_WHERE,
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.onboardingToken.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({
          laboratoryId: LAB_ID,
          clinicTenantId: CLIENT_ID,
          clinicEmail: 'renamed@example.com',
        })
      );
      expect(result.onboardingLink).toContain('/onboarding/welcome?token=');
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
      prisma.onboardingToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.revokeInvitation(LAB_ID, CLIENT_ID)).rejects.toThrow(
        NotFoundException
      );
    });

    it('revokes active invitation tokens', async () => {
      prisma.clinicLabConnection.findFirst.mockResolvedValue(mockConnection);
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
    beforeEach(() => {
      prisma.clinicLabConnection.findFirst.mockResolvedValue(mockConnection);
      prisma.order.count.mockResolvedValue(0);
      prisma.onboardingToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.clinicLabConnection.deleteMany.mockResolvedValue({ count: 1 });
      prisma.tenant.delete.mockResolvedValue({});
    });

    /** Nothing may be revoked or deleted when a guard refuses. */
    function expectNoSideEffects() {
      expect(prisma.onboardingToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.clinicLabConnection.deleteMany).not.toHaveBeenCalled();
      expect(prisma.tenant.delete).not.toHaveBeenCalled();
    }

    it('throws NotFoundException when the client is not connected to this lab', async () => {
      prisma.clinicLabConnection.findFirst.mockResolvedValue(null);

      await expect(service.deleteClient(LAB_ID, CLIENT_ID)).rejects.toThrow(
        NotFoundException
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expectNoSideEffects();
    });

    it('refuses a client with any orders', async () => {
      prisma.order.count.mockResolvedValue(1);

      await expect(service.deleteClient(LAB_ID, CLIENT_ID)).rejects.toThrow(
        /existing orders/
      );
      expect(prisma.order.count).toHaveBeenCalledWith({
        where: { tenantId: CLIENT_ID },
      });
      expectNoSideEffects();
    });

    it('refuses a clinic connected to another lab', async () => {
      prisma.clinicLabConnection.count.mockResolvedValue(1);

      await expect(service.deleteClient(LAB_ID, CLIENT_ID)).rejects.toThrow(
        /another laboratory/
      );
      expect(prisma.clinicLabConnection.count).toHaveBeenCalledWith({
        where: { clinicId: CLIENT_ID, labId: { not: LAB_ID } },
      });
      expectNoSideEffects();
    });

    it('refuses a clinic that completed onboarding (has members)', async () => {
      prisma.userTenantMembership.count.mockResolvedValue(1);

      await expect(service.deleteClient(LAB_ID, CLIENT_ID)).rejects.toThrow(
        /completed onboarding/
      );
      expect(prisma.userTenantMembership.count).toHaveBeenCalledWith({
        where: { tenantId: CLIENT_ID },
      });
      expectNoSideEffects();
    });

    it('locks the clinic row and runs every guard inside the delete transaction', async () => {
      await service.deleteClient(LAB_ID, CLIENT_ID);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const txStart = prisma.$transaction.mock.invocationCallOrder[0];
      const lock = prisma.$queryRaw.mock.invocationCallOrder[0];
      const lockSql = (prisma.$queryRaw.mock.calls[0][0] as string[]).join('?');
      expect(lockSql).toContain('FOR UPDATE');
      expect(prisma.$queryRaw.mock.calls[0][1]).toBe(CLIENT_ID);

      for (const guard of [
        prisma.clinicLabConnection.count,
        prisma.userTenantMembership.count,
        prisma.order.count,
      ]) {
        const at = guard.mock.invocationCallOrder[0];
        expect(at).toBeGreaterThan(txStart);
        expect(at).toBeGreaterThan(lock);
        expect(at).toBeLessThan(
          prisma.tenant.delete.mock.invocationCallOrder[0]
        );
      }
    });

    it("revokes only this client's pending invitations from this lab", async () => {
      // Regression: the revoke used { laboratoryId, clinicEmail: { not: '' } },
      // which killed every pending invitation the lab had sent.
      await service.deleteClient(LAB_ID, CLIENT_ID);

      expect(prisma.onboardingToken.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.onboardingToken.updateMany).toHaveBeenCalledWith({
        where: PENDING_INVITATIONS_WHERE,
        data: { revokedAt: expect.any(Date) },
      });
    });

    it("deletes only this lab's connection and the clinic — never user accounts or memberships", async () => {
      await service.deleteClient(LAB_ID, CLIENT_ID);

      expect(prisma.clinicLabConnection.deleteMany).toHaveBeenCalledWith({
        where: { clinicId: CLIENT_ID, labId: LAB_ID },
      });
      expect(prisma.tenant.delete).toHaveBeenCalledWith({
        where: { id: CLIENT_ID },
      });
      expect(prisma.user.delete).not.toHaveBeenCalled();
      expect(prisma.user.deleteMany).not.toHaveBeenCalled();
      expect(prisma.userTenantMembership.deleteMany).not.toHaveBeenCalled();
    });
  });
});

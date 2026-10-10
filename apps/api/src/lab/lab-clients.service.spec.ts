import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LabClientsService } from './lab-clients.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ImportClientsDto } from './dto/import-clients.dto';

const LAB_ID = 'lab-1';
const CLIENT_ID = 'client-1';
const USER_ID = 'user-1';
const BATCH_ID = '6f1c2a9e-8f0b-4d3a-9c55-2b7e1d4a0c11';

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
  legalName: 'Test Clinic SAS',
  taxIdType: 'NIT',
  taxId: '900.123.456-7',
  clinicConnections: [{ notes: 'Pays monthly' }],
  _count: { memberships: 0, orders: 0 },
  memberships: [],
  orders: [],
};

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

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
        update: jest.fn(),
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
      $executeRaw: jest.fn().mockResolvedValue(0),
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

    it("returns the tax identity and only this lab's notes", async () => {
      prisma.tenant.findMany.mockResolvedValue([mockClientTenant]);
      prisma.tenant.count.mockResolvedValue(1);

      const result = await service.listClients(LAB_ID, {});

      expect(result.data[0]).toMatchObject({
        legalName: 'Test Clinic SAS',
        taxIdType: 'NIT',
        taxId: '900.123.456-7',
        notes: 'Pays monthly',
      });
      expect(
        prisma.tenant.findMany.mock.calls[0][0].select.clinicConnections
      ).toEqual(expect.objectContaining({ where: { labId: LAB_ID } }));
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
    const NEW_CLIENT = {
      name: 'New Clinic',
      clientType: 'VETERINARY_CLINIC',
      primaryContactEmail: 'new@example.com',
    };

    it('throws ConflictException when the email (any letter case) is already a client of this lab', async () => {
      prisma.tenant.findFirst.mockResolvedValueOnce({
        id: 'existing',
        email: 'New@Example.com',
        clinicConnections: [{ importBatchId: null }],
      });

      await expect(
        service.createClient(LAB_ID, NEW_CLIENT, USER_ID)
      ).rejects.toThrow('A client with this email is already connected');

      const where = prisma.tenant.findFirst.mock.calls[0][0].where;
      expect(where.clinicConnections).toEqual({ some: { labId: LAB_ID } });
      expect(where.OR).toContainEqual({
        email: { equals: 'new@example.com', mode: 'insensitive' },
      });
      expect(prisma.tenant.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the tax ID is already a client of this lab', async () => {
      prisma.tenant.findFirst.mockResolvedValueOnce({
        id: 'existing',
        email: 'other@example.com',
        clinicConnections: [{ importBatchId: null }],
      });

      await expect(
        service.createClient(
          LAB_ID,
          {
            ...NEW_CLIENT,
            country: 'CO',
            taxIdType: 'NIT',
            taxId: '900.123.456-7',
          },
          USER_ID
        )
      ).rejects.toThrow(ConflictException);

      expect(prisma.tenant.findFirst.mock.calls[0][0].where.OR).toContainEqual({
        country: 'CO',
        taxIdType: 'NIT',
        taxIdNormalized: '9001234567',
      });
    });

    it('rejects a tax ID without an ID type, or a type from another country', async () => {
      await expect(
        service.createClient(
          LAB_ID,
          { ...NEW_CLIENT, country: 'CO', taxId: '900123456' },
          USER_ID
        )
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createClient(
          LAB_ID,
          { ...NEW_CLIENT, country: 'CO', taxIdType: 'RUT', taxId: '1-9' },
          USER_ID
        )
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
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

      const result = await service.createClient(LAB_ID, NEW_CLIENT, USER_ID);

      expect(result.clientId).toBe('new-client-1');
      expect(result.onboardingLink).toContain('/onboarding/welcome?token=');
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(prisma.tenant.create).toHaveBeenCalled();
      expect(prisma.clinicLabConnection.create).toHaveBeenCalled();
      expect(prisma.onboardingToken.create).toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        maxWait: 5000,
        timeout: 10000,
      });
    });

    it('takes the per-lab lock before checking for duplicates', async () => {
      prisma.tenant.findFirst.mockResolvedValue(null);
      prisma.tenant.create.mockResolvedValue({ id: 'new-client-1' });

      await service.createClient(LAB_ID, NEW_CLIENT, USER_ID);

      const lock = prisma.$executeRaw.mock;
      expect(lock.calls[0][0].join('?')).toContain('pg_advisory_xact_lock');
      expect(lock.calls[0][1]).toBe(`clinic-create:${LAB_ID}`);
      expect(lock.invocationCallOrder[0]).toBeLessThan(
        prisma.tenant.findFirst.mock.invocationCallOrder[0]
      );
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
          legalName: 'New Clinic SAS',
          taxIdType: 'NIT',
          taxId: '900.123.456-7',
          notes: 'Referred by Dr. Ruiz',
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
          legalName: 'New Clinic SAS',
          taxIdType: 'NIT',
          taxId: '900.123.456-7',
          taxIdNormalized: '9001234567',
          clientStatus: 'PENDING',
        })
      );
      expect(prisma.clinicLabConnection.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({
          labId: LAB_ID,
          notes: 'Referred by Dr. Ruiz',
          importBatchId: null,
          importRowNumber: null,
          importRowHash: null,
        })
      );
      expect(prisma.onboardingToken.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({
          laboratoryId: LAB_ID,
          clinicTenantId: 'new-client-1',
        })
      );
    });

    it('retries in a new transaction with a suffixed slug after a slug conflict', async () => {
      prisma.tenant.findFirst.mockResolvedValue(null);
      prisma.tenant.create
        .mockRejectedValueOnce(uniqueViolation())
        .mockResolvedValueOnce({ id: 'new-client-1' });

      const result = await service.createClient(LAB_ID, NEW_CLIENT, USER_ID);

      expect(result.clientId).toBe('new-client-1');
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(prisma.tenant.create.mock.calls[0][0].data.slug).toBe(
        'new-clinic'
      );
      expect(prisma.tenant.create.mock.calls[1][0].data.slug).toMatch(
        /^new-clinic-[0-9a-f]{6}$/
      );
    });
  });

  describe('importClients', () => {
    const row = (
      rowNumber: number,
      overrides: Record<string, unknown> = {}
    ) => ({
      rowNumber,
      name: `Clinic ${rowNumber}`,
      clientType: 'VETERINARY_CLINIC',
      primaryContactEmail: `clinic${rowNumber}@example.com`,
      country: 'CO',
      ...overrides,
    });
    const body = (
      rows: Record<string, unknown>[],
      extra: Partial<ImportClientsDto> = {}
    ): ImportClientsDto => ({ importBatchId: BATCH_ID, rows, ...extra });

    let nextId: number;
    beforeEach(() => {
      nextId = 1;
      prisma.tenant.findFirst.mockResolvedValue(null);
      prisma.clinicLabConnection.findFirst.mockResolvedValue(null);
      prisma.tenant.create.mockImplementation(async () => ({
        id: `new-${nextId++}`,
      }));
      prisma.clinicLabConnection.create.mockResolvedValue({});
    });

    it('creates tenant + connection only: no invitation, no users', async () => {
      const result = await service.importClients(
        LAB_ID,
        body([row(2, { notes: 'Comentarios: pays monthly' })]),
        USER_ID
      );

      expect(result.results).toEqual([
        { rowNumber: 2, status: 'created', clientId: 'new-1' },
      ]);
      expect(result.summary).toMatchObject({ created: 1, failed: 0 });
      expect(prisma.tenant.create.mock.calls[0][0].data).toMatchObject({
        type: 'CLINIC',
        clientStatus: 'PENDING',
      });
      expect(prisma.clinicLabConnection.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({
          clinicId: 'new-1',
          labId: LAB_ID,
          notes: 'Comentarios: pays monthly',
          importBatchId: BATCH_ID,
          importRowNumber: 2,
          importRowHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        })
      );
      expect(prisma.onboardingToken.create).not.toHaveBeenCalled();
      expect(prisma.user.create).toBeUndefined();
      expect(prisma.userTenantMembership.create).toBeUndefined();
    });

    it('reports invalid rows with field codes and still creates the valid ones', async () => {
      const result = await service.importClients(
        LAB_ID,
        body([
          row(2, { primaryContactEmail: '' }),
          row(3, { country: 'Colombia' }),
          row(4, { taxId: '900123456' }),
          row(5),
        ]),
        USER_ID
      );

      expect(result.results).toEqual([
        {
          rowNumber: 2,
          status: 'invalid',
          errors: [{ field: 'primaryContactEmail', code: 'REQUIRED' }],
        },
        {
          rowNumber: 3,
          status: 'invalid',
          errors: [{ field: 'country', code: 'INVALID_COUNTRY' }],
        },
        {
          rowNumber: 4,
          status: 'invalid',
          errors: [{ field: 'taxId', code: 'TAX_ID_INCOMPLETE' }],
        },
        { rowNumber: 5, status: 'created', clientId: 'new-1' },
      ]);
      expect(result.summary).toMatchObject({ created: 1, invalid: 3 });
      expect(prisma.tenant.create).toHaveBeenCalledTimes(1);
    });

    it('skips duplicates within the request before any write, first row wins', async () => {
      const result = await service.importClients(
        LAB_ID,
        body([
          row(2, { taxIdType: 'NIT', taxId: '900.123.456-7' }),
          row(3, { primaryContactEmail: 'CLINIC2@example.com' }),
          row(4, { taxIdType: 'NIT', taxId: '9001234567' }),
        ]),
        USER_ID
      );

      expect(result.results.map((r) => r.status)).toEqual([
        'created',
        'skipped',
        'skipped',
      ]);
      expect(result.results[1]).toMatchObject({ reason: 'DUPLICATE_IN_FILE' });
      expect(result.results[2]).toMatchObject({ reason: 'DUPLICATE_IN_FILE' });
      expect(prisma.tenant.create).toHaveBeenCalledTimes(1);
    });

    it('treats the same number with another ID type or country as different', async () => {
      const result = await service.importClients(
        LAB_ID,
        body([
          row(2, { taxIdType: 'CC', taxId: '1098765' }),
          row(3, { taxIdType: 'CE', taxId: '1098765' }),
          row(4, { country: 'PE', taxIdType: 'CE', taxId: '1098765' }),
        ]),
        USER_ID
      );

      expect(result.summary.created).toBe(3);
    });

    it('skips a row whose email or tax ID is already a client of this lab', async () => {
      prisma.tenant.findFirst
        .mockResolvedValueOnce({
          id: 'existing-1',
          email: 'Clinic2@Example.com',
          clinicConnections: [{ importBatchId: null }],
        })
        .mockResolvedValueOnce({
          id: 'existing-2',
          email: 'someone-else@example.com',
          clinicConnections: [{ importBatchId: 'an-older-batch' }],
        });

      const result = await service.importClients(
        LAB_ID,
        body([row(2), row(3, { taxIdType: 'NIT', taxId: '900123456' })]),
        USER_ID
      );

      expect(result.results).toEqual([
        { rowNumber: 2, status: 'skipped', reason: 'EMAIL_EXISTS' },
        { rowNumber: 3, status: 'skipped', reason: 'TAX_ID_EXISTS' },
      ]);
      expect(prisma.tenant.create).not.toHaveBeenCalled();
    });

    it("only looks for duplicates among this lab's clients", async () => {
      await service.importClients(LAB_ID, body([row(2)]), USER_ID);

      // A clinic connected only to another lab can never match, so it neither
      // blocks the row nor shows up in the response.
      expect(prisma.tenant.findFirst.mock.calls[0][0].where).toMatchObject({
        type: 'CLINIC',
        clinicConnections: { some: { labId: LAB_ID } },
      });
    });

    it('reports DUPLICATE_IN_FILE when the match was created by another row of the same batch', async () => {
      prisma.tenant.findFirst.mockResolvedValueOnce({
        id: 'from-row-2',
        email: 'clinic2@example.com',
        clinicConnections: [{ importBatchId: BATCH_ID }],
      });

      const result = await service.importClients(
        LAB_ID,
        body([row(30, { primaryContactEmail: 'clinic2@example.com' })]),
        USER_ID
      );

      expect(result.results[0]).toEqual({
        rowNumber: 30,
        status: 'skipped',
        reason: 'DUPLICATE_IN_FILE',
      });
    });

    describe('replay with the same batch id', () => {
      async function firstAttemptHash() {
        await service.importClients(LAB_ID, body([row(2)]), USER_ID);
        const hash =
          prisma.clinicLabConnection.create.mock.calls[0][0].data.importRowHash;
        jest.clearAllMocks();
        prisma.tenant.findFirst.mockResolvedValue(null);
        return hash;
      }

      it('returns created with the existing client for the same data, without inserting', async () => {
        const hash = await firstAttemptHash();
        prisma.clinicLabConnection.findFirst.mockResolvedValueOnce({
          clinicId: 'new-1',
          importRowHash: hash,
        });

        const result = await service.importClients(
          LAB_ID,
          body([row(2)]),
          USER_ID
        );

        expect(result.results).toEqual([
          { rowNumber: 2, status: 'created', clientId: 'new-1' },
        ]);
        expect(prisma.clinicLabConnection.findFirst).toHaveBeenCalledWith({
          where: { labId: LAB_ID, importBatchId: BATCH_ID, importRowNumber: 2 },
          select: { clinicId: true, importRowHash: true },
        });
        // Found by row identity, so an email edited since doesn't matter.
        expect(prisma.tenant.findFirst).not.toHaveBeenCalled();
        expect(prisma.tenant.create).not.toHaveBeenCalled();
      });

      it('returns BATCH_ROW_MISMATCH when the row number is reused for different data', async () => {
        const hash = await firstAttemptHash();
        prisma.clinicLabConnection.findFirst.mockResolvedValueOnce({
          clinicId: 'new-1',
          importRowHash: hash,
        });

        const result = await service.importClients(
          LAB_ID,
          body([row(2, { name: 'Another clinic' })]),
          USER_ID
        );

        expect(result.results).toEqual([
          { rowNumber: 2, status: 'conflict', reason: 'BATCH_ROW_MISMATCH' },
        ]);
        expect(prisma.tenant.create).not.toHaveBeenCalled();
      });
    });

    it('runs lock → replay lookup → duplicate lookup → insert, in that order', async () => {
      await service.importClients(LAB_ID, body([row(2)]), USER_ID);

      const order = [
        prisma.$executeRaw,
        prisma.clinicLabConnection.findFirst,
        prisma.tenant.findFirst,
        prisma.tenant.create,
        prisma.clinicLabConnection.create,
      ].map((fn) => fn.mock.invocationCallOrder[0]);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    it('retries the whole row transaction once after a unique violation', async () => {
      prisma.tenant.create
        .mockRejectedValueOnce(uniqueViolation())
        .mockResolvedValueOnce({ id: 'new-1' });

      const result = await service.importClients(
        LAB_ID,
        body([row(2)]),
        USER_ID
      );

      expect(result.results[0]).toMatchObject({ status: 'created' });
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      // Second attempt re-checks everything from the lock on.
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
      expect(prisma.clinicLabConnection.findFirst).toHaveBeenCalledTimes(2);
      expect(prisma.tenant.create.mock.calls[1][0].data.slug).toMatch(
        /^clinic-2-[0-9a-f]{6}$/
      );
    });

    it('marks a row failed after a second unique violation or any other error, and continues', async () => {
      prisma.tenant.create
        .mockRejectedValueOnce(uniqueViolation())
        .mockRejectedValueOnce(uniqueViolation())
        .mockRejectedValueOnce(new Error('connection reset'))
        .mockResolvedValueOnce({ id: 'new-1' });

      const result = await service.importClients(
        LAB_ID,
        body([row(2), row(3), row(4)]),
        USER_ID
      );

      expect(result.results).toEqual([
        { rowNumber: 2, status: 'failed', reason: 'UNEXPECTED' },
        { rowNumber: 3, status: 'failed', reason: 'UNEXPECTED' },
        { rowNumber: 4, status: 'created', clientId: 'new-1' },
      ]);
      expect(result.summary).toMatchObject({ created: 1, failed: 2 });
    });

    it('dry run: no locks and no writes, same statuses as a real import', async () => {
      prisma.tenant.findMany.mockResolvedValue([
        {
          email: 'CLINIC2@example.com',
          country: null,
          taxIdType: null,
          taxIdNormalized: null,
        },
        {
          email: 'x@example.com',
          country: 'CO',
          taxIdType: 'NIT',
          taxIdNormalized: '900123456',
        },
      ]);

      const result = await service.importClients(
        LAB_ID,
        body(
          [
            row(2),
            row(3, { taxIdType: 'NIT', taxId: '900.123.456' }),
            row(4),
            row(5, { primaryContactEmail: 'clinic4@example.com' }),
            row(6, { primaryContactEmail: 'not-an-email' }),
          ],
          { dryRun: true }
        ),
        USER_ID
      );

      expect(result.results).toEqual([
        { rowNumber: 2, status: 'skipped', reason: 'EMAIL_EXISTS' },
        { rowNumber: 3, status: 'skipped', reason: 'TAX_ID_EXISTS' },
        { rowNumber: 4, status: 'would_create' },
        { rowNumber: 5, status: 'skipped', reason: 'DUPLICATE_IN_FILE' },
        {
          rowNumber: 6,
          status: 'invalid',
          errors: [{ field: 'primaryContactEmail', code: 'INVALID_EMAIL' }],
        },
      ]);
      expect(result.summary).toMatchObject({
        wouldCreate: 1,
        skipped: 3,
        invalid: 1,
      });
      expect(prisma.tenant.findMany.mock.calls[0][0].where).toMatchObject({
        clinicConnections: { some: { labId: LAB_ID } },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(prisma.tenant.create).not.toHaveBeenCalled();
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

  describe('updateClient — tax identity and notes', () => {
    beforeEach(() => {
      prisma.clinicLabConnection.findFirst.mockResolvedValue({
        ...mockConnection,
        notes: 'Old note',
      });
      prisma.tenant.update.mockResolvedValue({ id: CLIENT_ID });
    });

    it("writes notes to this lab's connection, not the shared profile", async () => {
      const result = await service.updateClient(LAB_ID, CLIENT_ID, {
        notes: '  Pays monthly  ',
      });

      expect(prisma.clinicLabConnection.update).toHaveBeenCalledWith({
        where: { id: 'conn-1' },
        data: { notes: 'Pays monthly' },
      });
      expect(prisma.tenant.update.mock.calls[0][0].data).not.toHaveProperty(
        'notes'
      );
      expect(result.notes).toBe('Pays monthly');
    });

    it('keeps notes when they are not sent', async () => {
      const result = await service.updateClient(LAB_ID, CLIENT_ID, {
        city: 'Cali',
      });

      expect(prisma.clinicLabConnection.update).not.toHaveBeenCalled();
      expect(result.notes).toBe('Old note');
    });

    it('stores the tax ID with its normalized copy', async () => {
      prisma.tenant.findUniqueOrThrow.mockResolvedValue({
        country: 'CL',
        taxIdType: null,
        taxId: null,
      });

      await service.updateClient(LAB_ID, CLIENT_ID, {
        taxIdType: 'RUT',
        taxId: '12.345.678-k',
      });

      expect(prisma.tenant.update.mock.calls[0][0].data).toMatchObject({
        taxIdType: 'RUT',
        taxId: '12.345.678-k',
        taxIdNormalized: '12345678K',
      });
    });

    it('checks the ID type against the stored country', async () => {
      prisma.tenant.findUniqueOrThrow.mockResolvedValue({
        country: 'CO',
        taxIdType: null,
        taxId: null,
      });

      await expect(
        service.updateClient(LAB_ID, CLIENT_ID, { taxIdType: 'RUT' })
      ).rejects.toThrow(BadRequestException);
      expect(prisma.tenant.update).not.toHaveBeenCalled();
    });

    it('clears the normalized copy with the tax ID', async () => {
      prisma.tenant.findUniqueOrThrow.mockResolvedValue({
        country: 'CO',
        taxIdType: 'NIT',
        taxId: '900123456',
      });

      await service.updateClient(LAB_ID, CLIENT_ID, { taxId: '' });

      expect(prisma.tenant.update.mock.calls[0][0].data).toMatchObject({
        taxId: null,
        taxIdNormalized: null,
      });
    });
  });

  describe('regenerateInvitation for a client that never had one (imported)', () => {
    it('creates a token linked to the clinic', async () => {
      prisma.clinicLabConnection.findFirst.mockResolvedValue(mockConnection);
      prisma.tenant.findUniqueOrThrow.mockResolvedValue({
        name: 'Imported Clinic',
        email: 'imported@example.com',
        clientType: 'VETERINARY_CLINIC',
      });
      prisma.onboardingToken.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.regenerateInvitation(
        LAB_ID,
        CLIENT_ID,
        USER_ID
      );

      expect(prisma.onboardingToken.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({
          laboratoryId: LAB_ID,
          clinicTenantId: CLIENT_ID,
          clinicEmail: 'imported@example.com',
        })
      );
      expect(result.onboardingLink).toContain('/onboarding/welcome?token=');
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

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LabController } from './lab.controller';
import { LabService } from './lab.service';
import { LabUsersService } from './lab-users.service';
import { LabClientsService } from './lab-clients.service';
import { PickupService } from './pickup.service';
import { SpecimenService } from './specimen.service';
import { CatalogService } from '../catalog/catalog.service';
import { ResultEntryService } from './result-entry.service';
import { ResultsService } from '../results/results.service';
import { WorklistService } from './worklist.service';
import { PrismaService } from '../prisma/prisma.service';

describe('LabController', () => {
  let controller: LabController;
  let service: jest.Mocked<LabService>;

  const tenant = {
    tenantId: 'lab-1',
    tenantName: 'Test Lab',
    tenantLogoUrl: null,
    role: 'ADMIN' as const,
    canPerformPickups: false,
  };

  beforeEach(async () => {
    const serviceMock: Partial<jest.Mocked<LabService>> = {
      getLabOrders: jest.fn().mockResolvedValue([]),
      getLabOrderById: jest.fn().mockResolvedValue({}),
      updateOrderStatus: jest.fn().mockResolvedValue({}),
      initOrderedTests: jest.fn().mockResolvedValue([]),
      updateOrderedTest: jest.fn().mockResolvedValue({}),
      getLaboratoryProfile: jest.fn().mockResolvedValue(null),
      upsertLaboratoryProfile: jest.fn().mockResolvedValue({}),
    };

    const usersServiceMock: Partial<jest.Mocked<LabUsersService>> = {
      listMembers: jest.fn().mockResolvedValue([]),
      createLabUser: jest.fn().mockResolvedValue({}),
      updateRole: jest.fn().mockResolvedValue({}),
      removeMember: jest.fn().mockResolvedValue(undefined),
    };

    const clientsServiceMock: Partial<jest.Mocked<LabClientsService>> = {
      listClients: jest.fn().mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      }),
      getClientDetail: jest.fn().mockResolvedValue({}),
      createClient: jest.fn().mockResolvedValue({}),
      updateClient: jest.fn().mockResolvedValue({}),
      suspendClient: jest.fn().mockResolvedValue(undefined),
      reactivateClient: jest.fn().mockResolvedValue(undefined),
      regenerateInvitation: jest.fn().mockResolvedValue({}),
      revokeInvitation: jest.fn().mockResolvedValue({}),
      deleteClient: jest.fn().mockResolvedValue(undefined),
    };

    const pickupServiceMock: Partial<jest.Mocked<PickupService>> = {
      listPickups: jest.fn().mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      }),
      getMyPickups: jest.fn().mockResolvedValue([]),
      getPickupById: jest.fn().mockResolvedValue({}),
      assignMessenger: jest.fn().mockResolvedValue({}),
      confirmReceived: jest.fn().mockResolvedValue({}),
      cancelPickup: jest.fn().mockResolvedValue({}),
      acceptPickup: jest.fn().mockResolvedValue({}),
      markCollected: jest.fn().mockResolvedValue({}),
      reportProblem: jest.fn().mockResolvedValue({ reported: true }),
      getAvailableMessengers: jest.fn().mockResolvedValue([]),
      savePushSubscription: jest.fn().mockResolvedValue({ saved: true }),
      removePushSubscription: jest.fn().mockResolvedValue({ removed: true }),
      getTimelineForOrder: jest.fn().mockResolvedValue([]),
    };

    const specimenServiceMock: Partial<jest.Mocked<SpecimenService>> = {
      getExpectedSpecimens: jest.fn().mockResolvedValue({ expectedSpecimenGroups: [], unconfiguredTests: [], existingSpecimens: [] }),
      accessionOrder: jest.fn().mockResolvedValue({ specimens: [], order: {} }),
      updateSpecimen: jest.fn().mockResolvedValue({}),
      resolveTemplateForBlockedTest: jest.fn().mockResolvedValue({ resolved: false }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LabController],
      providers: [
        { provide: LabService, useValue: serviceMock },
        { provide: LabUsersService, useValue: usersServiceMock },
        { provide: LabClientsService, useValue: clientsServiceMock },
        { provide: PickupService, useValue: pickupServiceMock },
        { provide: SpecimenService, useValue: specimenServiceMock },
        { provide: CatalogService, useValue: { importPlatformCatalog: jest.fn() } },
        { provide: ResultEntryService, useValue: { getResultSession: jest.fn(), saveAnalytes: jest.fn(), submitResults: jest.fn() } },
        { provide: ResultsService, useValue: { releaseReport: jest.fn() } },
        { provide: WorklistService, useValue: { getWorklist: jest.fn(), getWorklistCounts: jest.fn(), claimTest: jest.fn(), unclaimTest: jest.fn(), startTest: jest.fn(), reassignTest: jest.fn() } },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('test-key') },
        },
        {
          provide: PrismaService,
          useValue: { userTenantMembership: { findUnique: jest.fn() } },
        },
      ],
    }).compile();

    controller = module.get<LabController>(LabController);
    service = module.get(LabService);
  });

  it('creates without error', () => {
    expect(controller).toBeDefined();
  });

  it('getMe returns role, tenant info, and canPerformPickups', () => {
    const result = controller.getMe(tenant);
    expect(result).toEqual({
      role: 'ADMIN',
      tenantName: 'Test Lab',
      logoUrl: null,
      canPerformPickups: false,
    });
  });

  it('getMe returns canPerformPickups true when set', () => {
    const result = controller.getMe({ ...tenant, canPerformPickups: true });
    expect(result.canPerformPickups).toBe(true);
  });

  it('getOrders calls service with tenantId and status', async () => {
    await controller.getOrders(tenant, 'RECEIVED_BY_LAB');
    expect(service.getLabOrders).toHaveBeenCalledWith(
      'lab-1',
      'RECEIVED_BY_LAB'
    );
  });

  it('updateOrderStatus delegates to service', async () => {
    await controller.updateOrderStatus(tenant, 'order-1', {
      status: 'PROCESSING',
    });
    expect(service.updateOrderStatus).toHaveBeenCalledWith('lab-1', 'order-1', {
      status: 'PROCESSING',
    });
  });
});

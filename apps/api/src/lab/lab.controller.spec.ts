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
import { ReviewService } from './review.service';
import { ReleaseService } from './release.service';
import { AmendmentService } from './amendment.service';
import { ReadinessService } from './readiness.service';
import { PrismaService } from '../prisma/prisma.service';

describe('LabController', () => {
  let controller: LabController;
  let service: jest.Mocked<LabService>;
  let module: TestingModule;

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
      getExpectedSpecimens: jest.fn().mockResolvedValue({
        expectedSpecimenGroups: [],
        unconfiguredTests: [],
        existingSpecimens: [],
      }),
      accessionOrder: jest.fn().mockResolvedValue({ specimens: [], order: {} }),
      updateSpecimen: jest.fn().mockResolvedValue({}),
      resolveTemplateForBlockedTest: jest
        .fn()
        .mockResolvedValue({ resolved: false }),
    };

    module = await Test.createTestingModule({
      controllers: [LabController],
      providers: [
        { provide: LabService, useValue: serviceMock },
        { provide: LabUsersService, useValue: usersServiceMock },
        { provide: LabClientsService, useValue: clientsServiceMock },
        { provide: PickupService, useValue: pickupServiceMock },
        { provide: SpecimenService, useValue: specimenServiceMock },
        {
          provide: CatalogService,
          useValue: { importPlatformCatalog: jest.fn() },
        },
        {
          provide: ResultEntryService,
          useValue: {
            getResultSession: jest.fn(),
            saveAnalytes: jest.fn(),
            submitResults: jest.fn(),
          },
        },
        { provide: ResultsService, useValue: { releaseReport: jest.fn() } },
        {
          provide: WorklistService,
          useValue: {
            getWorklist: jest.fn(),
            getWorklistCounts: jest.fn(),
            claimTest: jest.fn(),
            unclaimTest: jest.fn(),
            startTest: jest.fn(),
            reassignTest: jest.fn(),
          },
        },
        {
          provide: ReviewService,
          useValue: {
            submitForReview: jest.fn(),
            requestCorrections: jest.fn(),
            getReviewerSigners: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: ReleaseService,
          useValue: {
            approveAndRelease: jest.fn().mockResolvedValue({
              releaseId: 'rel-1',
              releaseSequence: 1,
              releaseType: 'PARTIAL',
            }),
            getReleaseHistory: jest.fn().mockResolvedValue({
              releases: [],
              aggregateReportStatus: 'PARTIAL_RESULTS',
            }),
            getCurrentResults: jest.fn().mockResolvedValue({ tests: [] }),
          },
        },
        {
          provide: AmendmentService,
          useValue: {
            initiateAmendment: jest.fn().mockResolvedValue({
              amendmentId: 'amend-1',
              status: 'DRAFT',
              analytes: [],
            }),
            getAmendment: jest.fn().mockResolvedValue({
              amendment: {},
              sourceAnalytes: [],
            }),
            editAmendmentAnalytes: jest.fn().mockResolvedValue({ updated: 1 }),
            submitForReview: jest
              .fn()
              .mockResolvedValue({ status: 'IN_REVIEW' }),
            approveAmendment: jest.fn().mockResolvedValue({
              releaseId: 'rel-2',
              releaseType: 'AMENDMENT',
            }),
            cancelAmendment: jest
              .fn()
              .mockResolvedValue({ status: 'CANCELLED' }),
          },
        },
        {
          provide: ReadinessService,
          useValue: {
            checkReadiness: jest.fn(),
            checkBulkReadiness: jest.fn(),
          },
        },
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

  describe('release endpoints', () => {
    const user = {
      id: 'user-1',
      email: 'admin@lab.com',
      firstName: 'Admin',
      lastName: 'User',
    } as any;

    let releaseService: any;
    let amendmentService: any;
    let reviewService: any;

    beforeEach(() => {
      releaseService = module.get(ReleaseService);
      amendmentService = module.get(AmendmentService);
      reviewService = module.get(ReviewService);
    });

    it('approveAndRelease delegates to releaseService with testIds', async () => {
      await controller.approveAndRelease(tenant, user, 'order-1', {
        signerId: 'signer-1',
        testIds: ['rt-1', 'rt-2'],
        reviewNotes: 'OK',
      });

      expect(releaseService.approveAndRelease).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'order-1',
          labTenantId: 'lab-1',
          signerId: 'signer-1',
          testIds: ['rt-1', 'rt-2'],
        })
      );
    });

    it('submitForReview passes optional testIds', async () => {
      await controller.submitForReview(tenant, user, 'order-1', {
        testIds: ['ot-1'],
      });

      expect(reviewService.submitForReview).toHaveBeenCalledWith(
        'order-1',
        'lab-1',
        'user-1',
        'Admin User',
        ['ot-1']
      );
    });

    it('getReleaseHistory delegates to releaseService', async () => {
      await controller.getReleaseHistory(tenant, 'order-1');
      expect(releaseService.getReleaseHistory).toHaveBeenCalledWith(
        'order-1',
        'lab-1'
      );
    });

    it('getCurrentResults delegates to releaseService', async () => {
      await controller.getCurrentResults(tenant, 'order-1');
      expect(releaseService.getCurrentResults).toHaveBeenCalledWith(
        'order-1',
        'lab-1'
      );
    });

    it('initiateAmendment delegates to amendmentService', async () => {
      await controller.initiateAmendment(tenant, user, 'order-1', {
        reportTestId: 'rt-1',
        reason: 'Wrong value',
      });

      expect(amendmentService.initiateAmendment).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'order-1',
          labTenantId: 'lab-1',
          reportTestId: 'rt-1',
          reason: 'Wrong value',
        })
      );
    });

    it('getAmendment delegates to amendmentService', async () => {
      await controller.getAmendment(tenant, 'order-1', 'amend-1');
      expect(amendmentService.getAmendment).toHaveBeenCalledWith(
        'order-1',
        'lab-1',
        'amend-1'
      );
    });

    it('editAmendmentAnalytes delegates to amendmentService', async () => {
      await controller.editAmendmentAnalytes(tenant, 'order-1', 'amend-1', {
        analytes: [{ id: 'ama-1', numericValue: 15.0 }],
      });

      expect(amendmentService.editAmendmentAnalytes).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'order-1',
          amendmentId: 'amend-1',
          analytes: [{ id: 'ama-1', numericValue: 15.0 }],
        })
      );
    });

    it('submitAmendmentForReview delegates to amendmentService', async () => {
      await controller.submitAmendmentForReview(
        tenant,
        user,
        'order-1',
        'amend-1'
      );

      expect(amendmentService.submitForReview).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'order-1',
          amendmentId: 'amend-1',
        })
      );
    });

    it('approveAmendment delegates to amendmentService', async () => {
      await controller.approveAmendment(tenant, user, 'order-1', 'amend-1', {
        signerId: 'signer-1',
      });

      expect(amendmentService.approveAmendment).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'order-1',
          amendmentId: 'amend-1',
          signerId: 'signer-1',
        })
      );
    });

    it('cancelAmendment delegates to amendmentService', async () => {
      await controller.cancelAmendment(tenant, user, 'order-1', 'amend-1');

      expect(amendmentService.cancelAmendment).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'order-1',
          amendmentId: 'amend-1',
        })
      );
    });
  });
});

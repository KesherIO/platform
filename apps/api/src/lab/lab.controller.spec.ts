import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LabController } from './lab.controller';
import { LabService } from './lab.service';
import { LabUsersService } from './lab-users.service';
import { OrderAttentionService } from './order-attention.service';
import { KnowledgeSearchService } from '../rag/knowledge-search.service';
import { PrismaService } from '../prisma/prisma.service';

describe('LabController', () => {
  let controller: LabController;
  let service: jest.Mocked<LabService>;
  let orderAttentionService: jest.Mocked<OrderAttentionService>;
  let knowledgeSearchService: jest.Mocked<KnowledgeSearchService>;

  const tenant = {
    tenantId: 'lab-1',
    tenantName: 'Test Lab',
    role: 'ADMIN' as const,
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

    const orderAttentionServiceMock: Partial<
      jest.Mocked<OrderAttentionService>
    > = {
      getOrdersNeedingAttention: jest.fn().mockResolvedValue([]),
    };

    const knowledgeSearchServiceMock: Partial<
      jest.Mocked<KnowledgeSearchService>
    > = {
      search: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LabController],
      providers: [
        { provide: LabService, useValue: serviceMock },
        { provide: LabUsersService, useValue: usersServiceMock },
        { provide: OrderAttentionService, useValue: orderAttentionServiceMock },
        {
          provide: KnowledgeSearchService,
          useValue: knowledgeSearchServiceMock,
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
    orderAttentionService = module.get(OrderAttentionService);
    knowledgeSearchService = module.get(KnowledgeSearchService);
  });

  it('creates without error', () => {
    expect(controller).toBeDefined();
  });

  it('getOrdersNeedingAttention calls service with tenantId', async () => {
    await controller.getOrdersNeedingAttention(tenant);
    expect(
      orderAttentionService.getOrdersNeedingAttention
    ).toHaveBeenCalledWith('lab-1');
  });

  it('searchKnowledge delegates the validated query to the service', async () => {
    await controller.searchKnowledge({
      species: 'DOG' as never,
      symptoms: 'lethargy',
      topK: 5,
    });
    expect(knowledgeSearchService.search).toHaveBeenCalledWith({
      species: 'DOG',
      symptoms: 'lethargy',
      topK: 5,
    });
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

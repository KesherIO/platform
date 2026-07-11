import { Test, TestingModule } from '@nestjs/testing';
import { LabController } from './lab.controller';
import { LabService } from './lab.service';

describe('LabController', () => {
  let controller: LabController;
  let service: jest.Mocked<LabService>;

  const tenant = { tenantId: 'lab-1', role: 'ADMIN' as const };

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

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LabController],
      providers: [{ provide: LabService, useValue: serviceMock }],
    }).compile();

    controller = module.get<LabController>(LabController);
    service = module.get(LabService);
  });

  it('creates without error', () => {
    expect(controller).toBeDefined();
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

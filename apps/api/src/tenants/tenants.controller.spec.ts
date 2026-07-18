import { Test } from '@nestjs/testing';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { TenantGuard } from '../auth/guards/tenant.guard';

const TENANT_CTX = {
  tenantId: 'tenant-1',
  tenantName: 'Test Tenant',
  userId: 'user-1',
  role: 'ADMIN',
};

describe('TenantsController', () => {
  let controller: TenantsController;
  let service: {
    findOne: ReturnType<typeof jest.fn>;
    updateClinic: ReturnType<typeof jest.fn>;
    getStaff: ReturnType<typeof jest.fn>;
    removeStaff: ReturnType<typeof jest.fn>;
    updateStaffRole: ReturnType<typeof jest.fn>;
  };

  beforeEach(async () => {
    service = {
      findOne: jest.fn().mockResolvedValue(null),
      updateClinic: jest.fn().mockResolvedValue({}),
      getStaff: jest.fn().mockResolvedValue([]),
      removeStaff: jest.fn().mockResolvedValue(undefined),
      updateStaffRole: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      controllers: [TenantsController],
      providers: [{ provide: TenantsService, useValue: service }],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(TenantsController);
  });

  it('creates without error', () => {
    expect(controller).toBeTruthy();
  });

  describe('updateClinic', () => {
    it('delegates to service with tenantId, body, and logo', async () => {
      const body = { name: 'New Name', phone: '555-0001', address: '123 Main' };
      const logo = { buffer: Buffer.from('img') } as Express.Multer.File;

      await controller.updateClinic(TENANT_CTX as any, body, logo);

      expect(service.updateClinic).toHaveBeenCalledWith('tenant-1', body, logo);
    });

    it('delegates without logo when none uploaded', async () => {
      const body = { name: 'New Name' };

      await controller.updateClinic(TENANT_CTX as any, body, undefined);

      expect(service.updateClinic).toHaveBeenCalledWith(
        'tenant-1',
        body,
        undefined
      );
    });
  });

  describe('getStaff', () => {
    it('delegates to service with tenantId from context', async () => {
      await controller.getStaff(TENANT_CTX as any);
      expect(service.getStaff).toHaveBeenCalledWith('tenant-1');
    });
  });

  describe('removeStaff', () => {
    it('delegates to service with tenantId and userId', async () => {
      await controller.removeStaff(TENANT_CTX as any, 'user-2');
      expect(service.removeStaff).toHaveBeenCalledWith('tenant-1', 'user-2');
    });
  });

  describe('updateStaffRole', () => {
    it('maps "admin" body role to TenantRole.ADMIN', async () => {
      await controller.updateStaffRole(TENANT_CTX as any, 'user-2', {
        role: 'admin',
      });
      expect(service.updateStaffRole).toHaveBeenCalledWith(
        'tenant-1',
        'user-2',
        'ADMIN'
      );
    });

    it('maps "staff" body role to TenantRole.VET', async () => {
      await controller.updateStaffRole(TENANT_CTX as any, 'user-2', {
        role: 'staff',
      });
      expect(service.updateStaffRole).toHaveBeenCalledWith(
        'tenant-1',
        'user-2',
        'VET'
      );
    });
  });
});

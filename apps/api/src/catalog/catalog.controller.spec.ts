import { Test } from '@nestjs/testing';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { InternalApiKeyGuard } from '../auth/guards/internal-api-key.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { LabTenantGuard } from '../lab/lab-tenant.guard';
import type { TenantContext } from '@vet-ai/shared-types';

const TENANT: TenantContext = {
  tenantId: 'lab-1',
  tenantName: 'Test Lab',
  tenantLogoUrl: null,
  role: 'ADMIN' as TenantContext['role'],
};

describe('CatalogController', () => {
  let controller: CatalogController;
  let service: {
    findAll: ReturnType<typeof jest.fn>;
    import: ReturnType<typeof jest.fn>;
    findAllAdmin: ReturnType<typeof jest.fn>;
    createItem: ReturnType<typeof jest.fn>;
    updateItem: ReturnType<typeof jest.fn>;
    setActive: ReturnType<typeof jest.fn>;
  };

  beforeEach(async () => {
    service = {
      findAll: jest.fn().mockResolvedValue([]),
      import: jest.fn().mockResolvedValue({ created: 1, updated: 0 }),
      findAllAdmin: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      createItem: jest.fn().mockResolvedValue({ id: 'new1' }),
      updateItem: jest.fn().mockResolvedValue({ id: 'item1' }),
      setActive: jest.fn().mockResolvedValue({ id: 'item1' }),
    };

    const module = await Test.createTestingModule({
      controllers: [CatalogController],
      providers: [{ provide: CatalogService, useValue: service }],
    })
      .overrideGuard(InternalApiKeyGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(LabTenantGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(CatalogController);
  });

  it('creates without error', () => {
    expect(controller).toBeTruthy();
  });

  it('findAll calls service.findAll with the resolved tenant id', async () => {
    await controller.findAll(TENANT);
    expect(service.findAll).toHaveBeenCalledWith('lab-1');
  });

  it('import calls service.import with body only', async () => {
    const body = {
      labTenantId: 'lab-1',
      items: [{ kind: 'TEST' as const, name: 'CBC', code: 'CBC' }],
    };
    await controller.import(body);
    expect(service.import).toHaveBeenCalledWith(body);
  });

  it('findAllAdmin calls service.findAllAdmin with tenant id + query', async () => {
    await controller.findAllAdmin(TENANT, { search: 'cbc' });
    expect(service.findAllAdmin).toHaveBeenCalledWith('lab-1', {
      search: 'cbc',
    });
  });

  it('create calls service.createItem with tenant id + body', async () => {
    const body = { kind: 'TEST' as const, name: 'Glucose' };
    await controller.create(TENANT, body);
    expect(service.createItem).toHaveBeenCalledWith('lab-1', body);
  });

  it('update calls service.updateItem with tenant id + id + body', async () => {
    const body = { name: 'Renamed' };
    await controller.update(TENANT, 'item1', body);
    expect(service.updateItem).toHaveBeenCalledWith('lab-1', 'item1', body);
  });

  it('enable calls service.setActive with active:true', async () => {
    await controller.enable(TENANT, 'item1');
    expect(service.setActive).toHaveBeenCalledWith('lab-1', 'item1', true);
  });

  it('disable calls service.setActive with active:false', async () => {
    await controller.disable(TENANT, 'item1');
    expect(service.setActive).toHaveBeenCalledWith('lab-1', 'item1', false);
  });
});

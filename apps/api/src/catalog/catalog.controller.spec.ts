import { Test } from '@nestjs/testing';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { InternalApiKeyGuard } from '../auth/guards/internal-api-key.guard';

describe('CatalogController', () => {
  let controller: CatalogController;
  let service: {
    findAll: ReturnType<typeof jest.fn>;
    import: ReturnType<typeof jest.fn>;
  };

  beforeEach(async () => {
    service = {
      findAll: jest.fn().mockResolvedValue([]),
      import: jest.fn().mockResolvedValue({ created: 1, updated: 0 }),
    };

    const module = await Test.createTestingModule({
      controllers: [CatalogController],
      providers: [{ provide: CatalogService, useValue: service }],
    })
      .overrideGuard(InternalApiKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(CatalogController);
  });

  it('creates without error', () => {
    expect(controller).toBeTruthy();
  });

  it('findAll calls service.findAll with no arguments', async () => {
    await controller.findAll();
    expect(service.findAll).toHaveBeenCalledWith();
  });

  it('import calls service.import with body only', async () => {
    const body = {
      items: [{ kind: 'TEST' as const, name: 'CBC', code: 'CBC' }],
    };
    await controller.import(body);
    expect(service.import).toHaveBeenCalledWith(body);
  });
});

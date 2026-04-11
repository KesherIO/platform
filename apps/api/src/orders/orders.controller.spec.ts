import { Test } from '@nestjs/testing';
import { OrdersController } from './orders.controller';
import { TenantGuard } from '../auth/guards/tenant.guard';

describe('OrdersController', () => {
  let controller: OrdersController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [OrdersController],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(OrdersController);
  });

  it('creates without error', () => {
    expect(controller).toBeTruthy();
  });
});

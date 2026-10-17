import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser, TenantContext } from '@vet-ai/shared-types';
import { LabNotificationsController } from './lab-notifications.controller';
import { NotificationService } from '../notifications/notification.service';
import { LabTenantGuard } from './lab-tenant.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

describe('LabNotificationsController', () => {
  let controller: LabNotificationsController;
  const notifications = {
    list: jest.fn(),
    unreadCount: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
  };
  const user = { id: 'messenger-1' } as AuthenticatedUser;
  const tenant = { tenantId: 'lab-1' } as TenantContext;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LabNotificationsController],
      providers: [{ provide: NotificationService, useValue: notifications }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(LabTenantGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(LabNotificationsController);
  });

  it('creates without error', () => {
    expect(controller).toBeDefined();
  });

  it('lists my notifications in this lab', async () => {
    await controller.list(user, tenant, {});
    expect(notifications.list).toHaveBeenCalledWith('messenger-1', 'lab-1', {});
  });

  it('counts unread as a lab inbox', async () => {
    await controller.unreadCount(user, tenant);
    expect(notifications.unreadCount).toHaveBeenCalledWith(
      'messenger-1',
      'lab-1',
      'LAB'
    );
  });

  it('marks read scoped to me and the lab', async () => {
    await controller.markRead(user, tenant, 'n-1');
    expect(notifications.markRead).toHaveBeenCalledWith(
      'messenger-1',
      'lab-1',
      'n-1'
    );
    await controller.markAllRead(user, tenant);
    expect(notifications.markAllRead).toHaveBeenCalledWith(
      'messenger-1',
      'lab-1'
    );
  });
});

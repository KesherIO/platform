import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser, TenantContext } from '@vet-ai/shared-types';
import { NotificationsController } from './notifications.controller';
import { NotificationService } from './notification.service';
import { PushService } from './push.service';
import { TenantGuard } from '../auth/guards/tenant.guard';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  const notifications = {
    list: jest.fn(),
    unreadCount: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
    savePushSubscription: jest.fn(),
    removePushSubscription: jest.fn(),
  };
  const push = { getPublicKey: jest.fn() };
  const user = { id: 'user-1' } as AuthenticatedUser;
  const tenant = { tenantId: 'clinic-1' } as TenantContext;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        { provide: NotificationService, useValue: notifications },
        { provide: PushService, useValue: push },
      ],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(NotificationsController);
  });

  it('creates without error', () => {
    expect(controller).toBeDefined();
  });

  it('lists my notifications in the active clinic', async () => {
    notifications.list.mockResolvedValue({ items: [], nextCursor: null });
    await expect(
      controller.list(user, tenant, { cursor: 'n-1', limit: 10 })
    ).resolves.toEqual({ items: [], nextCursor: null });
    expect(notifications.list).toHaveBeenCalledWith('user-1', 'clinic-1', {
      cursor: 'n-1',
      limit: 10,
    });
  });

  it('counts unread as a clinic inbox', async () => {
    await controller.unreadCount(user, tenant);
    expect(notifications.unreadCount).toHaveBeenCalledWith(
      'user-1',
      'clinic-1',
      'CLINIC'
    );
  });

  it('marks read scoped to me and the clinic', async () => {
    await controller.markRead(user, tenant, 'n-1');
    expect(notifications.markRead).toHaveBeenCalledWith(
      'user-1',
      'clinic-1',
      'n-1'
    );
    await controller.markAllRead(user, tenant);
    expect(notifications.markAllRead).toHaveBeenCalledWith(
      'user-1',
      'clinic-1'
    );
  });

  it('returns the push public key', () => {
    push.getPublicKey.mockReturnValue('pub');
    expect(controller.pushPublicKey()).toEqual({ publicKey: 'pub' });
  });

  it('saves and removes clinic-app push subscriptions for me', async () => {
    const dto = {
      endpoint: 'https://push/1',
      keys: { p256dh: 'k', auth: 'a' },
    };
    await controller.savePushSubscription(user, dto);
    expect(notifications.savePushSubscription).toHaveBeenCalledWith(
      'user-1',
      'CLINIC',
      dto
    );
    await controller.removePushSubscription(user, {
      endpoint: 'https://push/1',
    });
    expect(notifications.removePushSubscription).toHaveBeenCalledWith(
      'user-1',
      'https://push/1'
    );
  });
});

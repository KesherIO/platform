import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PushService } from './push.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

const USER_ID = 'user-1';

const mockSubscription = {
  id: 'sub-1',
  userId: USER_ID,
  endpoint: 'https://push.example.com/abc',
  p256dh: 'p256dh-key',
  auth: 'auth-key',
};

describe('PushService', () => {
  let service: PushService;
  let prisma: Record<string, any>;
  let config: Record<string, any>;

  const buildService = async (env: Record<string, string | undefined>) => {
    prisma = {
      pushSubscription: {
        findMany: jest.fn(),
        delete: jest.fn(),
      },
    };
    config = { get: jest.fn((key: string) => env[key]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PushService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get<PushService>(PushService);
  };

  afterEach(() => jest.clearAllMocks());

  it('creates without error', async () => {
    await buildService({});
    expect(service).toBeDefined();
  });

  it('is not configured without VAPID env vars', async () => {
    await buildService({});
    expect(service.isConfigured()).toBe(false);
  });

  it('is configured when all VAPID env vars are set', async () => {
    await buildService({
      VAPID_PUBLIC_KEY: 'pub',
      VAPID_PRIVATE_KEY: 'priv',
      VAPID_SUBJECT: 'mailto:ops@example.com',
    });
    expect(service.isConfigured()).toBe(true);
    expect(webpush.setVapidDetails).toHaveBeenCalledWith(
      'mailto:ops@example.com',
      'pub',
      'priv'
    );
  });

  it('exposes the VAPID public key only when configured', async () => {
    await buildService({});
    expect(service.getPublicKey()).toBeNull();
    await buildService({
      VAPID_PUBLIC_KEY: 'pub',
      VAPID_PRIVATE_KEY: 'priv',
      VAPID_SUBJECT: 'mailto:ops@example.com',
    });
    expect(service.getPublicKey()).toBe('pub');
  });

  describe('sendToUserApp', () => {
    const message = {
      title: 'Resultados disponibles',
      body: 'REQ-1: hay resultados parciales disponibles.',
      url: '/cases/case-1/report?clinic=clinic-1',
      tag: 'order:order-1',
    };
    const sentPayload = () =>
      JSON.parse((webpush.sendNotification as jest.Mock).mock.calls[0][1]);

    beforeEach(async () => {
      await buildService({
        VAPID_PUBLIC_KEY: 'pub',
        VAPID_PRIVATE_KEY: 'priv',
        VAPID_SUBJECT: 'mailto:ops@example.com',
      });
    });

    it('is NOT_CONFIGURED without VAPID keys', async () => {
      await buildService({});
      await expect(
        service.sendToUserApp(USER_ID, 'CLINIC', message, 3600)
      ).resolves.toEqual({ kind: 'NOT_CONFIGURED' });
      expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
    });

    it("only targets the user's subscriptions from that app", async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([]);
      await expect(
        service.sendToUserApp(USER_ID, 'CLINIC', message, 3600)
      ).resolves.toEqual({ kind: 'NO_SUBSCRIPTION' });
      expect(prisma.pushSubscription.findMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, app: 'CLINIC' },
      });
    });

    it('sends the Angular service worker format to the clinic app, with a TTL', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([mockSubscription]);
      (webpush.sendNotification as jest.Mock).mockResolvedValue({});

      await expect(
        service.sendToUserApp(USER_ID, 'CLINIC', message, 3600)
      ).resolves.toEqual({ kind: 'SENT' });
      expect(sentPayload()).toEqual({
        notification: {
          title: message.title,
          body: message.body,
          tag: 'order:order-1',
          icon: '/assets/icons/icon-192.png',
          data: {
            onActionClick: {
              default: {
                operation: 'navigateLastFocusedOrOpen',
                url: message.url,
              },
            },
          },
        },
      });
      expect((webpush.sendNotification as jest.Mock).mock.calls[0][2]).toEqual({
        TTL: 3600,
      });
    });

    it('sends the lab sw.js format to the lab app', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([mockSubscription]);
      (webpush.sendNotification as jest.Mock).mockResolvedValue({});

      await service.sendToUserApp(USER_ID, 'LAB', message, 3600);
      expect(sentPayload()).toEqual({ ...message, icon: '/icon-128x128.png' });
    });

    it('drops unsubscribed devices; none left is NO_SUBSCRIPTION', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([mockSubscription]);
      prisma.pushSubscription.delete.mockResolvedValue({});
      (webpush.sendNotification as jest.Mock).mockRejectedValue({
        statusCode: 410,
      });

      await expect(
        service.sendToUserApp(USER_ID, 'LAB', message, 3600)
      ).resolves.toEqual({ kind: 'NO_SUBSCRIPTION' });
      expect(prisma.pushSubscription.delete).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
      });
    });

    it('any other error is FAILED so the worker retries', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([
        mockSubscription,
        { ...mockSubscription, id: 'sub-2', endpoint: 'https://push/2' },
      ]);
      (webpush.sendNotification as jest.Mock)
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('ECONNRESET'));

      await expect(
        service.sendToUserApp(USER_ID, 'LAB', message, 3600)
      ).resolves.toEqual({ kind: 'FAILED', error: 'ECONNRESET' });
      expect(prisma.pushSubscription.delete).not.toHaveBeenCalled();
    });
  });
});

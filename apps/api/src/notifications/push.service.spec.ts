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

  describe('sendToUser', () => {
    beforeEach(async () => {
      await buildService({
        VAPID_PUBLIC_KEY: 'pub',
        VAPID_PRIVATE_KEY: 'priv',
        VAPID_SUBJECT: 'mailto:ops@example.com',
      });
    });

    it('returns false immediately when not configured', async () => {
      await buildService({});
      const result = await service.sendToUser(USER_ID, {
        title: 't',
        body: 'b',
        url: '/my-pickups',
      });
      expect(result).toBe(false);
      expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
    });

    it('returns false when the user has no subscriptions', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([]);
      const result = await service.sendToUser(USER_ID, {
        title: 't',
        body: 'b',
        url: '/my-pickups',
      });
      expect(result).toBe(false);
    });

    it('returns true when at least one subscription succeeds', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([mockSubscription]);
      (webpush.sendNotification as jest.Mock).mockResolvedValue(undefined);

      const result = await service.sendToUser(USER_ID, {
        title: 'New pickup',
        body: 'REQ-1',
        url: '/my-pickups',
      });

      expect(result).toBe(true);
      expect(webpush.sendNotification).toHaveBeenCalledWith(
        {
          endpoint: mockSubscription.endpoint,
          keys: {
            p256dh: mockSubscription.p256dh,
            auth: mockSubscription.auth,
          },
        },
        JSON.stringify({
          title: 'New pickup',
          body: 'REQ-1',
          url: '/my-pickups',
        })
      );
    });

    it('deletes the subscription on a 410 Gone response and returns false', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([mockSubscription]);
      prisma.pushSubscription.delete.mockResolvedValue(mockSubscription);
      (webpush.sendNotification as jest.Mock).mockRejectedValue({
        statusCode: 410,
      });

      const result = await service.sendToUser(USER_ID, {
        title: 't',
        body: 'b',
        url: '/my-pickups',
      });

      expect(result).toBe(false);
      expect(prisma.pushSubscription.delete).toHaveBeenCalledWith({
        where: { id: mockSubscription.id },
      });
    });

    it('keeps the subscription and returns false on a non-410 failure', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([mockSubscription]);
      (webpush.sendNotification as jest.Mock).mockRejectedValue(
        new Error('network error')
      );

      const result = await service.sendToUser(USER_ID, {
        title: 't',
        body: 'b',
        url: '/my-pickups',
      });

      expect(result).toBe(false);
      expect(prisma.pushSubscription.delete).not.toHaveBeenCalled();
    });
  });
});

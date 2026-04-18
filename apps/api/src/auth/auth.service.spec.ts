import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'test@example.com',
    firstName: 'John',
    lastName: 'Smith',
    phone: null,
    createdAt: new Date('2024-01-01'),
    memberships: [
      {
        role: 'ADMIN',
        createdAt: new Date('2024-01-01'),
        tenant: {
          id: 'tenant-1',
          name: 'City Vet',
          slug: 'city-vet',
          email: 'info@cityvet.com',
          phone: null,
          address: null,
          logoUrl: null,
          primaryColor: null,
        },
      },
    ],
    ...overrides,
  };
}

function makePrismaMock() {
  return {
    user: {
      upsert: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthService', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockImplementation((key: string) => {
              if (key === 'SUPABASE_URL') return 'https://fake.supabase.co';
              return 'fake-key';
            }),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  // ── getMe ─────────────────────────────────────────────────────────────────

  describe('getMe', () => {
    it('returns user profile with tenants and memberships', async () => {
      const user = makeUser();
      prisma.user.findUniqueOrThrow.mockResolvedValue(user);

      const result = await service.getMe('user-1');

      expect(result.user.id).toBe('user-1');
      expect(result.user.email).toBe('test@example.com');
      expect(result.tenants).toHaveLength(1);
      expect(result.tenants[0].id).toBe('tenant-1');
      expect(result.memberships).toHaveLength(1);
    });

    it('onboardingCompleted is true when user has a tenant with a name and firstName set', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(makeUser());

      const result = await service.getMe('user-1');

      expect(result.onboardingCompleted).toBe(true);
    });

    it('onboardingCompleted is false when user has no memberships', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(
        makeUser({ memberships: [] })
      );

      const result = await service.getMe('user-1');

      expect(result.onboardingCompleted).toBe(false);
    });

    it('onboardingCompleted is false when firstName is not set', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(
        makeUser({ firstName: null })
      );

      const result = await service.getMe('user-1');

      expect(result.onboardingCompleted).toBe(false);
    });

    it('activeTenantId is the first tenant id', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(makeUser());

      const result = await service.getMe('user-1');

      expect(result.activeTenantId).toBe('tenant-1');
    });

    it('activeTenantId is null when user has no tenants', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(
        makeUser({ memberships: [] })
      );

      const result = await service.getMe('user-1');

      expect(result.activeTenantId).toBeNull();
    });
  });

  // ── updateMe ──────────────────────────────────────────────────────────────

  describe('updateMe', () => {
    it('updates firstName and returns refreshed profile', async () => {
      const updated = makeUser({ firstName: 'Jane' });
      prisma.user.update.mockResolvedValue(updated);
      prisma.user.findUniqueOrThrow.mockResolvedValue(updated);

      const result = await service.updateMe('user-1', { firstName: 'Jane' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { firstName: 'Jane' },
      });
      expect(result.user.firstName).toBe('Jane');
    });

    it('updates phone and returns refreshed profile', async () => {
      const updated = makeUser({ phone: '+52 555 0001' });
      prisma.user.update.mockResolvedValue(updated);
      prisma.user.findUniqueOrThrow.mockResolvedValue(updated);

      const result = await service.updateMe('user-1', {
        phone: '+52 555 0001',
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { phone: '+52 555 0001' },
      });
      expect(result.user.phone).toBe('+52 555 0001');
    });

    it('sets phone to null when empty string is passed', async () => {
      prisma.user.update.mockResolvedValue(makeUser({ phone: null }));
      prisma.user.findUniqueOrThrow.mockResolvedValue(
        makeUser({ phone: null })
      );

      await service.updateMe('user-1', { phone: '' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { phone: null },
      });
    });

    it('does not include undefined fields in the update', async () => {
      prisma.user.update.mockResolvedValue(makeUser());
      prisma.user.findUniqueOrThrow.mockResolvedValue(makeUser());

      await service.updateMe('user-1', { firstName: 'Jane' });

      const callData = prisma.user.update.mock.calls[0][0].data;
      expect(callData).not.toHaveProperty('lastName');
      expect(callData).not.toHaveProperty('phone');
    });

    it('calls getMe after update to return fresh data', async () => {
      prisma.user.update.mockResolvedValue(makeUser());
      prisma.user.findUniqueOrThrow.mockResolvedValue(makeUser());

      await service.updateMe('user-1', { firstName: 'Jane' });

      expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1' } })
      );
    });
  });
});

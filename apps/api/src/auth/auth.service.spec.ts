import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type { JwtPayload } from '@vet-ai/shared-types';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

const updateUserById = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: {
      admin: {
        createUser: jest.fn(),
        deleteUser: jest.fn(),
        updateUserById: (...args: unknown[]) => updateUserById(...args),
      },
    },
  })),
}));

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
    veterinarianProfile: null,
    memberships: [
      {
        role: 'ADMIN',
        status: 'ACTIVE',
        isOrderingVet: false,
        createdAt: new Date('2024-01-01'),
        tenant: {
          id: 'tenant-1',
          name: 'City Vet',
          slug: 'city-vet',
          type: 'CLINIC',
          email: 'info@cityvet.com',
          phone: null,
          address: null,
          logoUrl: null,
          primaryColor: null,
          clinicConnections: [],
        },
      },
    ],
    ...overrides,
  };
}

function makePrismaMock() {
  return {
    user: {
      findUnique: jest.fn(),
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
    updateUserById.mockReset();
  });

  // ── updateSupabaseUserEmail ───────────────────────────────────────────────

  describe('updateSupabaseUserEmail', () => {
    it('changes the login email, confirmed, via the Admin API', async () => {
      updateUserById.mockResolvedValue({ data: {}, error: null });

      await service.updateSupabaseUserEmail('user-1', 'new@lab.com');

      expect(updateUserById).toHaveBeenCalledWith('user-1', {
        email: 'new@lab.com',
        email_confirm: true,
      });
    });

    it('maps an address already in use to a 409', async () => {
      updateUserById.mockResolvedValue({
        data: {},
        error: { message: 'taken', status: 422, code: 'email_exists' },
      });

      await expect(
        service.updateSupabaseUserEmail('user-1', 'x@lab.com')
      ).rejects.toThrow(ConflictException);
    });

    it("surfaces Supabase's message for other refusals", async () => {
      updateUserById.mockResolvedValue({
        data: {},
        error: { message: 'Unable to validate email address', status: 400 },
      });

      await expect(
        service.updateSupabaseUserEmail('user-1', 'x@lab.com')
      ).rejects.toThrow(
        new BadRequestException(
          'The login email could not be changed: Unable to validate email address'
        )
      );
    });

    it('treats a Supabase outage as a 502', async () => {
      updateUserById.mockResolvedValue({
        data: {},
        error: { message: 'boom', status: 500 },
      });

      await expect(
        service.updateSupabaseUserEmail('user-1', 'x@lab.com')
      ).rejects.toThrow(BadGatewayException);
    });
  });

  // ── upsertUserFromJwt ─────────────────────────────────────────────────────

  describe('upsertUserFromJwt', () => {
    const row = {
      id: 'user-1',
      email: 'new@lab.com',
      firstName: 'Jane',
      lastName: 'Doe',
      updatedAt: new Date('2026-10-15T12:00:00Z'),
    };
    const jwt = (email: string, issuedAt: string) =>
      ({
        sub: 'user-1',
        email,
        iat: new Date(issuedAt).getTime() / 1000,
      } as JwtPayload);

    it('returns the row without writing when the email matches', async () => {
      prisma.user.findUnique.mockResolvedValue(row);

      const result = await service.upsertUserFromJwt(
        jwt('new@lab.com', '2026-10-15T11:00:00Z')
      );

      expect(result).toEqual({
        id: 'user-1',
        email: 'new@lab.com',
        firstName: 'Jane',
        lastName: 'Doe',
      });
      expect(prisma.user.upsert).not.toHaveBeenCalled();
    });

    it('a token from before a lab-side email change does not revert it', async () => {
      prisma.user.findUnique.mockResolvedValue(row);

      const result = await service.upsertUserFromJwt(
        jwt('old@lab.com', '2026-10-15T11:59:00Z')
      );

      expect(result.email).toBe('new@lab.com');
      expect(prisma.user.upsert).not.toHaveBeenCalled();
    });

    it('a newer token syncs an email changed in Supabase', async () => {
      prisma.user.findUnique.mockResolvedValue(row);
      prisma.user.upsert.mockResolvedValue({ ...row, email: 'other@lab.com' });

      await service.upsertUserFromJwt(
        jwt('other@lab.com', '2026-10-15T12:05:00Z')
      );

      expect(prisma.user.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { email: 'other@lab.com' } })
      );
    });
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

    it('onboardingCompleted is false when membership status is not ACTIVE', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(
        makeUser({
          memberships: [
            {
              role: 'VET',
              status: 'VERIFICATION_PENDING',
              isOrderingVet: true,
              createdAt: new Date('2024-01-01'),
              tenant: {
                id: 'tenant-1',
                name: 'City Vet',
                slug: 'city-vet',
                type: 'CLINIC',
                email: null,
                phone: null,
                address: null,
                logoUrl: null,
                primaryColor: null,
                clinicConnections: [],
              },
            },
          ],
        })
      );

      const result = await service.getMe('user-1');

      expect(result.onboardingCompleted).toBe(false);
    });

    it("flags a clinic whose lab suspended services, and doesn't leak the connection", async () => {
      const user = makeUser();
      user.memberships[0].tenant.clinicConnections = [
        { labId: 'lab-1', status: 'SUSPENDED' },
      ] as never[];
      prisma.user.findUniqueOrThrow.mockResolvedValue(user);

      const result = await service.getMe('user-1');

      expect(result.memberships[0].labServicesSuspended).toBe(true);
      expect(result.memberships[0].tenant).not.toHaveProperty(
        'clinicConnections'
      );
      // Same lab pick as order creation: the default connection first
      expect(
        prisma.user.findUniqueOrThrow.mock.calls[0][0].select.memberships.select
          .tenant.select.clinicConnections
      ).toMatchObject({ orderBy: { isDefault: 'desc' } });
    });

    it('is not suspended for an active lab or no lab at all', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(makeUser());

      const result = await service.getMe('user-1');

      expect(result.memberships[0].labServicesSuspended).toBe(false);
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

    it('excludes LAB/PLATFORM memberships from tenants, memberships, and activeTenantId', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(
        makeUser({
          memberships: [
            {
              role: 'TECHNICIAN',
              status: 'ACTIVE',
              isOrderingVet: false,
              createdAt: new Date('2024-01-01'),
              tenant: {
                id: 'lab-1',
                name: 'Ramat Gan Laboratory',
                slug: 'biomet-lab',
                type: 'LAB',
                email: null,
                phone: null,
                address: null,
                logoUrl: null,
                primaryColor: null,
                clinicConnections: [],
              },
            },
          ],
        })
      );

      const result = await service.getMe('user-1');

      expect(result.tenants).toHaveLength(0);
      expect(result.memberships).toHaveLength(0);
      expect(result.activeTenantId).toBeNull();
      expect(result.onboardingCompleted).toBe(false);
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

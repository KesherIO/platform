import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { TenantRole } from '@prisma/client';
import { OnboardingService } from './onboarding.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { StorageService } from '../storage/storage.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const PAST   = new Date(Date.now() - 1000);

function makeInvite(overrides: Record<string, unknown> = {}) {
  return {
    token: 'invite-token',
    tenantId: 'tenant-1',
    email: 'staff@example.com',
    role: TenantRole.VET,
    acceptedAt: null,
    expiresAt: FUTURE,
    tenant: {
      id: 'tenant-1',
      name: 'City Vet',
      logoUrl: null,
      primaryColor: null,
    },
    ...overrides,
  };
}

function makeOnboardingToken(overrides: Record<string, unknown> = {}) {
  return {
    token: 'hex-token',
    type: 'ADMIN',
    clinicName: 'City Vet Clinic',
    clinicEmail: 'info@cityvet.com',
    used: false,
    expiresAt: FUTURE,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makePrismaMock() {
  return {
    tenant: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    userTenantMembership: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    tenantInvitation: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    onboardingToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

function makeAuthMock() {
  return {
    createSupabaseUser: jest.fn(),
    deleteSupabaseUser: jest.fn(),
  };
}

function makeStorageMock() {
  return {
    uploadClinicLogo: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OnboardingService', () => {
  let service: OnboardingService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let auth: ReturnType<typeof makeAuthMock>;
  let storage: ReturnType<typeof makeStorageMock>;

  beforeEach(async () => {
    prisma  = makePrismaMock();
    auth    = makeAuthMock();
    storage = makeStorageMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingService,
        { provide: PrismaService,  useValue: prisma  },
        { provide: AuthService,    useValue: auth    },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    service = module.get(OnboardingService);
  });

  // ── generateInvite ────────────────────────────────────────────────────────

  describe('generateInvite', () => {
    const tenantId = 'tenant-1';
    const invitedBy = 'admin-user';

    it('throws ConflictException when the email is already an active member', async () => {
      prisma.userTenantMembership.findFirst.mockResolvedValue({ userId: 'u1', tenantId });

      await expect(service.generateInvite(invitedBy, tenantId, { email: 'staff@example.com', role: 'staff' }))
        .rejects.toThrow(ConflictException);
    });

    it('returns existing token with alreadyExists:true when pending invite exists', async () => {
      prisma.userTenantMembership.findFirst.mockResolvedValue(null);
      const existing = { token: 'existing-token', tenantId, expiresAt: FUTURE };
      prisma.tenantInvitation.findFirst.mockResolvedValue(existing);

      const result = await service.generateInvite(invitedBy, tenantId, { email: 'staff@example.com', role: 'staff' });

      expect(result).toMatchObject({ token: 'existing-token', alreadyExists: true });
      expect(prisma.tenantInvitation.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the pending invite cap (10) is reached', async () => {
      prisma.userTenantMembership.findFirst.mockResolvedValue(null);
      prisma.tenantInvitation.findFirst.mockResolvedValue(null);
      prisma.tenantInvitation.count.mockResolvedValue(10);

      await expect(service.generateInvite(invitedBy, tenantId, { email: 'new@example.com', role: 'staff' }))
        .rejects.toThrow(BadRequestException);
    });

    it('normalizes email to lowercase before deduplication check', async () => {
      prisma.userTenantMembership.findFirst.mockResolvedValue(null);
      prisma.tenantInvitation.findFirst.mockResolvedValue(null);
      prisma.tenantInvitation.count.mockResolvedValue(0);
      prisma.tenantInvitation.create.mockResolvedValue({ token: 'new-token', tenantId, expiresAt: FUTURE });

      await service.generateInvite(invitedBy, tenantId, { email: 'STAFF@EXAMPLE.COM', role: 'staff' });

      // The findFirst deduplication query should use the lowercased email
      expect(prisma.tenantInvitation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ email: 'staff@example.com' }) }),
      );
    });

    it('maps admin role to TenantRole.ADMIN', async () => {
      prisma.userTenantMembership.findFirst.mockResolvedValue(null);
      prisma.tenantInvitation.findFirst.mockResolvedValue(null);
      prisma.tenantInvitation.count.mockResolvedValue(0);
      prisma.tenantInvitation.create.mockResolvedValue({ token: 't', tenantId, expiresAt: FUTURE });

      await service.generateInvite(invitedBy, tenantId, { email: 'admin@example.com', role: 'admin' });

      expect(prisma.tenantInvitation.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ role: TenantRole.ADMIN }) }),
      );
    });

    it('maps staff role (default) to TenantRole.VET', async () => {
      prisma.userTenantMembership.findFirst.mockResolvedValue(null);
      prisma.tenantInvitation.findFirst.mockResolvedValue(null);
      prisma.tenantInvitation.count.mockResolvedValue(0);
      prisma.tenantInvitation.create.mockResolvedValue({ token: 't', tenantId, expiresAt: FUTURE });

      await service.generateInvite(invitedBy, tenantId, { email: 'staff@example.com', role: 'staff' });

      expect(prisma.tenantInvitation.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ role: TenantRole.VET }) }),
      );
    });

    it('skips email guardrails and creates generic invite when no email provided', async () => {
      prisma.tenantInvitation.count.mockResolvedValue(0);
      prisma.tenantInvitation.create.mockResolvedValue({ token: 'generic-token', tenantId, expiresAt: FUTURE });

      const result = await service.generateInvite(invitedBy, tenantId, {});

      expect(prisma.userTenantMembership.findFirst).not.toHaveBeenCalled();
      expect(prisma.tenantInvitation.findFirst).not.toHaveBeenCalled();
      expect(result.alreadyExists).toBe(false);
    });
  });

  // ── verifyInvite ──────────────────────────────────────────────────────────

  describe('verifyInvite', () => {
    it('throws NotFoundException when token does not exist', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(null);

      await expect(service.verifyInvite('bad-token')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when invite is already accepted', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(
        makeInvite({ acceptedAt: new Date() }),
      );

      await expect(service.verifyInvite('invite-token')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when invite is expired', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(
        makeInvite({ expiresAt: PAST }),
      );

      await expect(service.verifyInvite('invite-token')).rejects.toThrow(BadRequestException);
    });

    it('returns userExists:true when the invited email already has a User record', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite());
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });

      const result = await service.verifyInvite('invite-token');

      expect(result.userExists).toBe(true);
    });

    it('returns userExists:false when the invited email has no User record', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite());
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.verifyInvite('invite-token');

      expect(result.userExists).toBe(false);
    });

    it('maps ADMIN role to "admin"', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite({ role: TenantRole.ADMIN }));
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.verifyInvite('invite-token');

      expect(result.role).toBe('admin');
    });

    it('maps VET role to "staff"', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite({ role: TenantRole.VET }));
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.verifyInvite('invite-token');

      expect(result.role).toBe('staff');
    });
  });

  // ── saveStaffProfile ──────────────────────────────────────────────────────

  describe('saveStaffProfile', () => {
    const userId   = 'user-1';
    const tenantId = 'tenant-1';
    const dto      = { fullName: 'John Smith', telephone: '555-0100', email: 'john@example.com', role: 'staff' as const, token: 'invite-token' };

    it('throws NotFoundException when token does not exist', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(null);

      await expect(service.saveStaffProfile(userId, tenantId, 'bad-token', dto))
        .rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when token belongs to a different tenant', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite({ tenantId: 'other-tenant' }));

      await expect(service.saveStaffProfile(userId, tenantId, 'invite-token', dto))
        .rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when invite is already accepted', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(
        makeInvite({ acceptedAt: new Date() }),
      );

      await expect(service.saveStaffProfile(userId, tenantId, 'invite-token', dto))
        .rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when invite is expired', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite({ expiresAt: PAST }));

      await expect(service.saveStaffProfile(userId, tenantId, 'invite-token', dto))
        .rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when user is already a member', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite());
      prisma.userTenantMembership.findUnique.mockResolvedValue({ userId, tenantId });

      await expect(service.saveStaffProfile(userId, tenantId, 'invite-token', dto))
        .rejects.toThrow(ConflictException);
    });

    it('creates membership and marks invite accepted on happy path', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite());
      prisma.userTenantMembership.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockResolvedValue([]);

      const result = await service.saveStaffProfile(userId, tenantId, 'invite-token', dto);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toEqual({ userId });
    });
  });

  // ── completeStaffOnboarding ───────────────────────────────────────────────

  describe('completeStaffOnboarding', () => {
    const baseDto = {
      token: 'invite-token',
      email: 'staff@example.com',
      role: 'staff' as const,
      fullName: 'Jane Doe',
      password: 'password123',
    };

    it('throws NotFoundException when token does not exist', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(null);

      await expect(service.completeStaffOnboarding(baseDto)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when invite is already accepted', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite({ acceptedAt: new Date() }));

      await expect(service.completeStaffOnboarding(baseDto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when invite is expired', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite({ expiresAt: PAST }));

      await expect(service.completeStaffOnboarding(baseDto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for unknown role', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite());
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.completeStaffOnboarding({ ...baseDto, role: 'unknown' as 'staff' }))
        .rejects.toThrow(BadRequestException);
    });

    describe('re-invite path (user already exists)', () => {
      it('creates membership and marks invite accepted without creating Supabase user', async () => {
        prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite());
        prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });
        prisma.userTenantMembership.findUnique.mockResolvedValue(null);
        prisma.$transaction.mockResolvedValue([]);

        const result = await service.completeStaffOnboarding(baseDto);

        expect(auth.createSupabaseUser).not.toHaveBeenCalled();
        expect(result).toEqual({ userId: 'existing-user' });
      });

      it('throws ConflictException when the existing user is already a member', async () => {
        prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite());
        prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });
        prisma.userTenantMembership.findUnique.mockResolvedValue({ userId: 'existing-user', tenantId: 'tenant-1' });

        await expect(service.completeStaffOnboarding(baseDto)).rejects.toThrow(ConflictException);
      });
    });

    describe('new user path', () => {
      it('throws BadRequestException when fullName is missing', async () => {
        prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite());
        prisma.user.findUnique.mockResolvedValue(null);

        await expect(service.completeStaffOnboarding({ ...baseDto, fullName: undefined }))
          .rejects.toThrow(BadRequestException);
      });

      it('throws BadRequestException when password is missing', async () => {
        prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite());
        prisma.user.findUnique.mockResolvedValue(null);

        await expect(service.completeStaffOnboarding({ ...baseDto, password: undefined }))
          .rejects.toThrow(BadRequestException);
      });

      it('creates Supabase user, User row, and membership using normalized email', async () => {
        prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite());
        prisma.user.findUnique.mockResolvedValue(null);
        auth.createSupabaseUser.mockResolvedValue('supabase-uid');
        prisma.$transaction.mockResolvedValue([]);

        await service.completeStaffOnboarding({ ...baseDto, email: 'STAFF@EXAMPLE.COM' });

        expect(auth.createSupabaseUser).toHaveBeenCalledWith(
          'staff@example.com', // normalized
          baseDto.password,
          'Jane',
          'Doe',
        );
      });
    });
  });

  // ── verifyOnboardingToken ─────────────────────────────────────────────────

  describe('verifyOnboardingToken', () => {
    it('returns { valid: false, reason: "not_found" } when token does not exist', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(null);

      const result = await service.verifyOnboardingToken('missing');

      expect(result).toEqual({ valid: false, reason: 'not_found' });
    });

    it('returns { valid: false, reason: "used" } when token was already used', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(makeOnboardingToken({ used: true }));

      const result = await service.verifyOnboardingToken('hex-token');

      expect(result).toEqual({ valid: false, reason: 'used' });
    });

    it('returns { valid: false, reason: "expired" } when token is past expiresAt', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(makeOnboardingToken({ expiresAt: PAST }));

      const result = await service.verifyOnboardingToken('hex-token');

      expect(result).toEqual({ valid: false, reason: 'expired' });
    });

    it('returns valid token data without throwing', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(makeOnboardingToken());

      const result = await service.verifyOnboardingToken('hex-token');

      expect(result).toMatchObject({
        valid: true,
        type: 'ADMIN',
        clinicName: 'City Vet Clinic',
        clinicEmail: 'info@cityvet.com',
      });
    });

    it('never throws even for invalid tokens', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(null);

      await expect(service.verifyOnboardingToken('garbage')).resolves.toBeDefined();
    });
  });

  // ── completeAdminOnboarding ───────────────────────────────────────────────

  describe('completeAdminOnboarding', () => {
    const dto = {
      token: 'hex-token',
      adminFirstName: 'Jane',
      adminLastName: 'Doe',
      adminEmail: 'jane@cityvet.com',
      password: 'password123',
      clinicName: 'City Vet Clinic',
      clinicAddress: '123 Main St',
      clinicCity: 'Austin',
      clinicEmail: 'info@cityvet.com',
      clinicPhone: '+15125550100',
      notificationMethod: 'email' as const,
    };

    function setupHappyPath() {
      prisma.onboardingToken.findUnique.mockResolvedValue(makeOnboardingToken());
      auth.createSupabaseUser.mockResolvedValue('supabase-uid');
      prisma.tenant.findFirst.mockResolvedValue(null); // no slug conflict

      const mockTx = {
        tenant: { create: jest.fn().mockResolvedValue({ id: 'tenant-id' }) },
        user: { create: jest.fn().mockResolvedValue({}) },
        userTenantMembership: { create: jest.fn().mockResolvedValue({}) },
        onboardingToken: { update: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));
    }

    it('throws NotFoundException when token does not exist', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(null);

      await expect(service.completeAdminOnboarding(dto)).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when token has already been used', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(makeOnboardingToken({ used: true }));

      await expect(service.completeAdminOnboarding(dto)).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when token has expired', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(makeOnboardingToken({ expiresAt: PAST }));

      await expect(service.completeAdminOnboarding(dto)).rejects.toThrow(BadRequestException);
    });

    it('does not write to DB when Supabase user creation fails', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(makeOnboardingToken());
      auth.createSupabaseUser.mockRejectedValue(
        new InternalServerErrorException('Supabase error'),
      );

      await expect(service.completeAdminOnboarding(dto)).rejects.toThrow();

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('deletes the Supabase user when the Prisma transaction fails', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(makeOnboardingToken());
      auth.createSupabaseUser.mockResolvedValue('supabase-uid');
      prisma.tenant.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockRejectedValue(new Error('DB connection lost'));

      await expect(service.completeAdminOnboarding(dto)).rejects.toThrow('DB connection lost');

      expect(auth.deleteSupabaseUser).toHaveBeenCalledWith('supabase-uid');
    });

    it('returns tenantId and userId on happy path', async () => {
      setupHappyPath();

      const result = await service.completeAdminOnboarding(dto);

      expect(result).toMatchObject({ tenantId: 'tenant-id', userId: 'supabase-uid' });
    });

    it('appends a suffix to the slug when there is a slug conflict', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(makeOnboardingToken());
      auth.createSupabaseUser.mockResolvedValue('supabase-uid');
      prisma.tenant.findFirst.mockResolvedValue({ id: 'existing-tenant' }); // conflict

      const mockTx = {
        tenant: { create: jest.fn().mockResolvedValue({ id: 'tenant-id' }) },
        user: { create: jest.fn().mockResolvedValue({}) },
        userTenantMembership: { create: jest.fn().mockResolvedValue({}) },
        onboardingToken: { update: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));

      await service.completeAdminOnboarding(dto);

      const createdWith = mockTx.tenant.create.mock.calls[0][0].data.slug as string;
      expect(createdWith).toMatch(/^city-vet-clinic-[a-z0-9]{6}$/);
    });

    it('returns logoUploadFailed:true when logo upload throws', async () => {
      setupHappyPath();
      storage.uploadClinicLogo.mockRejectedValue(new Error('S3 error'));

      const logoFile = { originalname: 'logo.png' } as Express.Multer.File;
      const result = await service.completeAdminOnboarding(dto, logoFile);

      expect(result).toMatchObject({ tenantId: 'tenant-id', logoUploadFailed: true });
    });
  });
});

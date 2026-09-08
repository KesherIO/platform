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
const PAST = new Date(Date.now() - 1000);

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
    id: 'token-id',
    token: 'hex-token',
    type: 'ADMIN',
    clinicName: 'City Vet Clinic',
    clinicEmail: 'info@cityvet.com',
    labName: null,
    labEmail: null,
    used: false,
    revokedAt: null,
    expiresAt: FUTURE,
    ...overrides,
  };
}

function makeLabOnboardingToken(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lab-token-id',
    token: 'lab-hex-token',
    type: 'LAB_ADMIN',
    clinicName: '',
    clinicEmail: '',
    labName: 'Kesher Diagnostics',
    labEmail: 'info@kesherlab.com',
    used: false,
    revokedAt: null,
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
      delete: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
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
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    laboratoryProfile: {
      create: jest.fn(),
    },
    clinicLabConnection: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    veterinarianProfile: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    vetLabVerification: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    veterinarianCredential: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    vetVerificationEvent: {
      create: jest.fn(),
    },
    order: {
      updateMany: jest.fn(),
    },
    resultTemplateDefinition: {
      updateMany: jest.fn(),
    },
    pickup: {
      deleteMany: jest.fn(),
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
    prisma = makePrismaMock();
    auth = makeAuthMock();
    storage = makeStorageMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuthService, useValue: auth },
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
      prisma.userTenantMembership.findFirst.mockResolvedValue({
        userId: 'u1',
        tenantId,
      });

      await expect(
        service.generateInvite(invitedBy, tenantId, {
          email: 'staff@example.com',
          role: 'vet',
        })
      ).rejects.toThrow(ConflictException);
    });

    it('returns existing token with alreadyExists:true when pending invite exists', async () => {
      prisma.userTenantMembership.findFirst.mockResolvedValue(null);
      const existing = { token: 'existing-token', tenantId, expiresAt: FUTURE };
      prisma.tenantInvitation.findFirst.mockResolvedValue(existing);

      const result = await service.generateInvite(invitedBy, tenantId, {
        email: 'staff@example.com',
        role: 'vet',
      });

      expect(result).toMatchObject({
        token: 'existing-token',
        alreadyExists: true,
      });
      expect(prisma.tenantInvitation.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the pending invite cap (10) is reached', async () => {
      prisma.userTenantMembership.findFirst.mockResolvedValue(null);
      prisma.tenantInvitation.findFirst.mockResolvedValue(null);
      prisma.tenantInvitation.count.mockResolvedValue(10);

      await expect(
        service.generateInvite(invitedBy, tenantId, {
          email: 'new@example.com',
          role: 'vet',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('normalizes email to lowercase before deduplication check', async () => {
      prisma.userTenantMembership.findFirst.mockResolvedValue(null);
      prisma.tenantInvitation.findFirst.mockResolvedValue(null);
      prisma.tenantInvitation.count.mockResolvedValue(0);
      prisma.tenantInvitation.create.mockResolvedValue({
        token: 'new-token',
        tenantId,
        expiresAt: FUTURE,
      });

      await service.generateInvite(invitedBy, tenantId, {
        email: 'STAFF@EXAMPLE.COM',
        role: 'vet',
      });

      // The findFirst deduplication query should use the lowercased email
      expect(prisma.tenantInvitation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ email: 'staff@example.com' }),
        })
      );
    });

    it('maps admin role to TenantRole.ADMIN', async () => {
      prisma.userTenantMembership.findFirst.mockResolvedValue(null);
      prisma.tenantInvitation.findFirst.mockResolvedValue(null);
      prisma.tenantInvitation.count.mockResolvedValue(0);
      prisma.tenantInvitation.create.mockResolvedValue({
        token: 't',
        tenantId,
        expiresAt: FUTURE,
      });

      await service.generateInvite(invitedBy, tenantId, {
        email: 'admin@example.com',
        role: 'admin',
      });

      expect(prisma.tenantInvitation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ role: TenantRole.ADMIN }),
        })
      );
    });

    it('maps staff role (default) to TenantRole.VET', async () => {
      prisma.userTenantMembership.findFirst.mockResolvedValue(null);
      prisma.tenantInvitation.findFirst.mockResolvedValue(null);
      prisma.tenantInvitation.count.mockResolvedValue(0);
      prisma.tenantInvitation.create.mockResolvedValue({
        token: 't',
        tenantId,
        expiresAt: FUTURE,
      });

      await service.generateInvite(invitedBy, tenantId, {
        email: 'staff@example.com',
        role: 'vet',
      });

      expect(prisma.tenantInvitation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ role: TenantRole.VET }),
        })
      );
    });

    it('skips email guardrails and creates generic invite when no email provided', async () => {
      prisma.tenantInvitation.count.mockResolvedValue(0);
      prisma.tenantInvitation.create.mockResolvedValue({
        token: 'generic-token',
        tenantId,
        expiresAt: FUTURE,
      });

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

      await expect(service.verifyInvite('bad-token')).rejects.toThrow(
        NotFoundException
      );
    });

    it('throws BadRequestException when invite is already accepted', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(
        makeInvite({ acceptedAt: new Date() })
      );

      await expect(service.verifyInvite('invite-token')).rejects.toThrow(
        BadRequestException
      );
    });

    it('throws BadRequestException when invite is expired', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(
        makeInvite({ expiresAt: PAST })
      );

      await expect(service.verifyInvite('invite-token')).rejects.toThrow(
        BadRequestException
      );
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
      prisma.tenantInvitation.findUnique.mockResolvedValue(
        makeInvite({ role: TenantRole.ADMIN })
      );
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.verifyInvite('invite-token');

      expect(result.role).toBe('admin');
    });

    it('maps VET role to "vet"', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(
        makeInvite({ role: TenantRole.VET })
      );
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.verifyInvite('invite-token');

      expect(result.role).toBe('vet');
    });
  });

  // ── saveStaffProfile ──────────────────────────────────────────────────────

  describe('saveStaffProfile', () => {
    const userId = 'user-1';
    const tenantId = 'tenant-1';
    const dto = {
      fullName: 'John Smith',
      telephone: '555-0100',
      email: 'john@example.com',
      role: 'vet' as const,
      token: 'invite-token',
    };

    it('throws NotFoundException when token does not exist', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(null);

      await expect(
        service.saveStaffProfile(userId, tenantId, 'bad-token', dto)
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when token belongs to a different tenant', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(
        makeInvite({ tenantId: 'other-tenant' })
      );

      await expect(
        service.saveStaffProfile(userId, tenantId, 'invite-token', dto)
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when invite is already accepted', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(
        makeInvite({ acceptedAt: new Date() })
      );

      await expect(
        service.saveStaffProfile(userId, tenantId, 'invite-token', dto)
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when invite is expired', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(
        makeInvite({ expiresAt: PAST })
      );

      await expect(
        service.saveStaffProfile(userId, tenantId, 'invite-token', dto)
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when user is already a member', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite());
      prisma.userTenantMembership.findUnique.mockResolvedValue({
        userId,
        tenantId,
      });

      await expect(
        service.saveStaffProfile(userId, tenantId, 'invite-token', dto)
      ).rejects.toThrow(ConflictException);
    });

    it('creates membership and marks invite accepted on happy path', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite());
      prisma.userTenantMembership.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockResolvedValue([]);

      const result = await service.saveStaffProfile(
        userId,
        tenantId,
        'invite-token',
        dto
      );

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toEqual({ userId });
    });
  });

  // ── completeStaffOnboarding ───────────────────────────────────────────────

  describe('completeStaffOnboarding', () => {
    const baseDto = {
      token: 'invite-token',
      email: 'staff@example.com',
      role: 'vet' as const,
      fullName: 'Jane Doe',
      password: 'password123',
    };

    it('throws NotFoundException when token does not exist', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(null);

      await expect(service.completeStaffOnboarding(baseDto)).rejects.toThrow(
        NotFoundException
      );
    });

    it('throws BadRequestException when invite is already accepted', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(
        makeInvite({ acceptedAt: new Date() })
      );

      await expect(service.completeStaffOnboarding(baseDto)).rejects.toThrow(
        BadRequestException
      );
    });

    it('throws BadRequestException when invite is expired', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(
        makeInvite({ expiresAt: PAST })
      );

      await expect(service.completeStaffOnboarding(baseDto)).rejects.toThrow(
        BadRequestException
      );
    });

    it('throws BadRequestException for unknown role', async () => {
      prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite());
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.completeStaffOnboarding({
          ...baseDto,
          role: 'unknown' as 'vet',
        })
      ).rejects.toThrow(BadRequestException);
    });

    describe('re-invite path (user already exists)', () => {
      it('creates membership and marks invite accepted without creating Supabase user', async () => {
        prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite());
        prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });
        prisma.userTenantMembership.findUnique.mockResolvedValue(null);
        prisma.$transaction.mockResolvedValue([]);

        const result = await service.completeStaffOnboarding(baseDto);

        expect(auth.createSupabaseUser).not.toHaveBeenCalled();
        expect(result).toEqual({
          userId: 'existing-user',
          tenantId: 'tenant-1',
        });
      });

      it('throws ConflictException when the existing user is already a member', async () => {
        prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite());
        prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });
        prisma.userTenantMembership.findUnique.mockResolvedValue({
          userId: 'existing-user',
          tenantId: 'tenant-1',
        });

        await expect(service.completeStaffOnboarding(baseDto)).rejects.toThrow(
          ConflictException
        );
      });

      it('sets ACTIVE status when existing vet is already approved at the lab', async () => {
        prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite());
        prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });
        prisma.userTenantMembership.findUnique.mockResolvedValue(null);
        prisma.clinicLabConnection.findFirst.mockResolvedValue({
          labId: 'lab-1',
          lab: { laboratoryProfile: { vetVerificationRequired: true } },
        });
        prisma.veterinarianProfile.findUnique.mockResolvedValue({
          id: 'vet-profile-1',
        });
        prisma.vetLabVerification.findUnique.mockResolvedValue({
          status: 'APPROVED',
        });
        prisma.$transaction.mockResolvedValue([]);

        await service.completeStaffOnboarding(baseDto);

        expect(prisma.userTenantMembership.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: 'ACTIVE' }),
          })
        );
      });

      it('sets VERIFICATION_PENDING when existing vet has profile but no verification at this lab', async () => {
        prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite());
        prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });
        prisma.userTenantMembership.findUnique.mockResolvedValue(null);
        prisma.clinicLabConnection.findFirst.mockResolvedValue({
          labId: 'lab-1',
          lab: { laboratoryProfile: { vetVerificationRequired: true } },
        });
        prisma.veterinarianProfile.findUnique.mockResolvedValue({
          id: 'vet-profile-1',
        });
        prisma.vetLabVerification.findUnique.mockResolvedValue(null);
        prisma.veterinarianCredential.findFirst.mockResolvedValue(null);
        prisma.$transaction.mockResolvedValue([]);

        await service.completeStaffOnboarding(baseDto);

        expect(prisma.userTenantMembership.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: 'VERIFICATION_PENDING' }),
          })
        );
      });

      it('auto-submits VetLabVerification when existing vet has profile and credential but no verification at new lab', async () => {
        prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite());
        prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });
        prisma.userTenantMembership.findUnique.mockResolvedValue(null);
        prisma.clinicLabConnection.findFirst.mockResolvedValue({
          labId: 'lab-2',
          lab: { laboratoryProfile: { vetVerificationRequired: true } },
        });
        prisma.veterinarianProfile.findUnique.mockResolvedValue({
          id: 'vet-profile-1',
        });
        prisma.vetLabVerification.findUnique.mockResolvedValue(null);
        prisma.veterinarianCredential.findFirst.mockResolvedValue({
          id: 'cred-1',
        });

        const mockTx = {
          vetLabVerification: {
            create: jest.fn().mockResolvedValue({ id: 'vlv-1' }),
          },
          vetVerificationEvent: { create: jest.fn().mockResolvedValue({}) },
        };
        prisma.$transaction
          .mockResolvedValueOnce([])
          .mockImplementationOnce(
            (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)
          );

        await service.completeStaffOnboarding(baseDto);

        expect(mockTx.vetLabVerification.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              vetProfileId: 'vet-profile-1',
              labTenantId: 'lab-2',
              initiatingClinicId: 'tenant-1',
              status: 'PENDING',
            }),
          })
        );
        expect(mockTx.vetVerificationEvent.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              eventType: 'SUBMITTED',
              actorId: 'existing-user',
              credentialVersionId: 'cred-1',
            }),
          })
        );
      });

      it('sets PROFILE_REQUIRED when existing user has no vet profile', async () => {
        prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite());
        prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });
        prisma.userTenantMembership.findUnique.mockResolvedValue(null);
        prisma.clinicLabConnection.findFirst.mockResolvedValue({
          labId: 'lab-1',
          lab: { laboratoryProfile: { vetVerificationRequired: true } },
        });
        prisma.veterinarianProfile.findUnique.mockResolvedValue(null);
        prisma.$transaction.mockResolvedValue([]);

        await service.completeStaffOnboarding(baseDto);

        expect(prisma.userTenantMembership.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: 'PROFILE_REQUIRED' }),
          })
        );
      });
    });

    describe('new user path', () => {
      it('throws BadRequestException when fullName is missing', async () => {
        prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite());
        prisma.user.findUnique.mockResolvedValue(null);

        await expect(
          service.completeStaffOnboarding({ ...baseDto, fullName: undefined })
        ).rejects.toThrow(BadRequestException);
      });

      it('throws BadRequestException when password is missing', async () => {
        prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite());
        prisma.user.findUnique.mockResolvedValue(null);

        await expect(
          service.completeStaffOnboarding({ ...baseDto, password: undefined })
        ).rejects.toThrow(BadRequestException);
      });

      it('creates Supabase user, User row, and membership using normalized email', async () => {
        prisma.tenantInvitation.findUnique.mockResolvedValue(makeInvite());
        prisma.user.findUnique.mockResolvedValue(null);
        auth.createSupabaseUser.mockResolvedValue('supabase-uid');
        prisma.$transaction.mockResolvedValue([]);

        await service.completeStaffOnboarding({
          ...baseDto,
          email: 'STAFF@EXAMPLE.COM',
        });

        expect(auth.createSupabaseUser).toHaveBeenCalledWith(
          'staff@example.com', // normalized
          baseDto.password,
          'Jane',
          'Doe'
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
      prisma.onboardingToken.findUnique.mockResolvedValue(
        makeOnboardingToken({ used: true })
      );

      const result = await service.verifyOnboardingToken('hex-token');

      expect(result).toEqual({ valid: false, reason: 'used' });
    });

    it('returns { valid: false, reason: "expired" } when token is past expiresAt', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(
        makeOnboardingToken({ expiresAt: PAST })
      );

      const result = await service.verifyOnboardingToken('hex-token');

      expect(result).toEqual({ valid: false, reason: 'expired' });
    });

    it('returns valid token data without throwing', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(
        makeOnboardingToken()
      );

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

      await expect(
        service.verifyOnboardingToken('garbage')
      ).resolves.toBeDefined();
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
      prisma.onboardingToken.findUnique.mockResolvedValue(
        makeOnboardingToken()
      );
      auth.createSupabaseUser.mockResolvedValue('supabase-uid');
      prisma.tenant.findFirst.mockResolvedValue(null); // no slug conflict

      const mockTx = {
        tenant: { create: jest.fn().mockResolvedValue({ id: 'tenant-id' }) },
        user: { create: jest.fn().mockResolvedValue({}) },
        userTenantMembership: { create: jest.fn().mockResolvedValue({}) },
        onboardingToken: { update: jest.fn().mockResolvedValue({}) },
        clinicLabConnection: {
          create: jest.fn().mockResolvedValue({}),
          findFirst: jest.fn().mockResolvedValue(null),
        },
        veterinarianProfile: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
        vetLabVerification: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
        veterinarianCredential: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      };
      prisma.$transaction.mockImplementation(
        (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)
      );
      return mockTx;
    }

    it('throws NotFoundException when token does not exist', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(null);

      await expect(service.completeAdminOnboarding(dto)).rejects.toThrow(
        NotFoundException
      );
    });

    it('throws ConflictException when token has already been used', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(
        makeOnboardingToken({ used: true })
      );

      await expect(service.completeAdminOnboarding(dto)).rejects.toThrow(
        ConflictException
      );
    });

    it('throws BadRequestException when token has expired', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(
        makeOnboardingToken({ expiresAt: PAST })
      );

      await expect(service.completeAdminOnboarding(dto)).rejects.toThrow(
        BadRequestException
      );
    });

    it('does not write to DB when Supabase user creation fails', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(
        makeOnboardingToken()
      );
      auth.createSupabaseUser.mockRejectedValue(
        new InternalServerErrorException('Supabase error')
      );

      await expect(service.completeAdminOnboarding(dto)).rejects.toThrow();

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('deletes the Supabase user when the Prisma transaction fails', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(
        makeOnboardingToken()
      );
      auth.createSupabaseUser.mockResolvedValue('supabase-uid');
      prisma.tenant.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockRejectedValue(new Error('DB connection lost'));

      await expect(service.completeAdminOnboarding(dto)).rejects.toThrow(
        'DB connection lost'
      );

      expect(auth.deleteSupabaseUser).toHaveBeenCalledWith('supabase-uid');
    });

    it('returns tenantId and userId on happy path', async () => {
      setupHappyPath();

      const result = await service.completeAdminOnboarding(dto);

      expect(result).toMatchObject({
        tenantId: 'tenant-id',
        userId: 'supabase-uid',
      });
    });

    it('appends a suffix to the slug when there is a slug conflict', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(
        makeOnboardingToken()
      );
      auth.createSupabaseUser.mockResolvedValue('supabase-uid');
      prisma.tenant.findFirst.mockResolvedValue({ id: 'existing-tenant' }); // conflict

      const mockTx = {
        tenant: { create: jest.fn().mockResolvedValue({ id: 'tenant-id' }) },
        user: { create: jest.fn().mockResolvedValue({}) },
        userTenantMembership: { create: jest.fn().mockResolvedValue({}) },
        onboardingToken: { update: jest.fn().mockResolvedValue({}) },
        clinicLabConnection: { create: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation(
        (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)
      );

      await service.completeAdminOnboarding(dto);

      const createdWith = mockTx.tenant.create.mock.calls[0][0].data
        .slug as string;
      expect(createdWith).toMatch(/^city-vet-clinic-[a-z0-9]{6}$/);
    });

    it('returns logoUploadFailed:true when logo upload throws', async () => {
      setupHappyPath();
      storage.uploadClinicLogo.mockRejectedValue(new Error('S3 error'));

      const logoFile = { originalname: 'logo.png' } as Express.Multer.File;
      const result = await service.completeAdminOnboarding(dto, logoFile);

      expect(result).toMatchObject({
        tenantId: 'tenant-id',
        logoUploadFailed: true,
      });
    });

    it('sets isOrderingVet and PROFILE_REQUIRED when isVet is true and lab requires verification', async () => {
      const mockTx = setupHappyPath();
      mockTx.clinicLabConnection.findFirst.mockResolvedValue({
        labId: 'lab-1',
        lab: { laboratoryProfile: { vetVerificationRequired: true } },
      });

      const result = await service.completeAdminOnboarding({
        ...dto,
        isVet: true,
      });

      expect(mockTx.userTenantMembership.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: TenantRole.ADMIN,
            isOrderingVet: true,
            status: 'PROFILE_REQUIRED',
          }),
        })
      );
      expect(result.membershipStatus).toBe('PROFILE_REQUIRED');
    });

    it('sets isOrderingVet and ACTIVE when isVet is true but lab does not require verification', async () => {
      const mockTx = setupHappyPath();
      prisma.clinicLabConnection.findFirst.mockResolvedValue(null);

      const result = await service.completeAdminOnboarding({
        ...dto,
        isVet: true,
      });

      expect(mockTx.userTenantMembership.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: TenantRole.ADMIN,
            isOrderingVet: true,
            status: 'ACTIVE',
          }),
        })
      );
      expect(result.membershipStatus).toBe('ACTIVE');
    });

    it('does not set isOrderingVet when isVet is false or omitted', async () => {
      const mockTx = setupHappyPath();

      await service.completeAdminOnboarding(dto);

      const membershipData =
        mockTx.userTenantMembership.create.mock.calls[0][0].data;
      expect(membershipData.isOrderingVet).toBeUndefined();
      expect(membershipData.status).toBeUndefined();
    });

    it('creates lab connection before checking vet membership status', async () => {
      const tokenWithLab = makeOnboardingToken({ laboratoryId: 'lab-1' });
      prisma.onboardingToken.findUnique.mockResolvedValue(tokenWithLab);
      auth.createSupabaseUser.mockResolvedValue('supabase-uid');
      prisma.tenant.findFirst.mockResolvedValue(null);

      const mockTx = {
        tenant: { create: jest.fn().mockResolvedValue({ id: 'tenant-id' }) },
        user: { create: jest.fn().mockResolvedValue({}) },
        userTenantMembership: { create: jest.fn().mockResolvedValue({}) },
        onboardingToken: { update: jest.fn().mockResolvedValue({}) },
        clinicLabConnection: {
          create: jest.fn().mockResolvedValue({}),
          findFirst: jest.fn().mockResolvedValue({
            labId: 'lab-1',
            lab: { laboratoryProfile: { vetVerificationRequired: true } },
          }),
        },
        veterinarianProfile: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
        vetLabVerification: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
        veterinarianCredential: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      };
      prisma.$transaction.mockImplementation(
        (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)
      );

      await service.completeAdminOnboarding({ ...dto, isVet: true });

      const labConnCallOrder =
        mockTx.clinicLabConnection.create.mock.invocationCallOrder[0];
      const membershipCallOrder =
        mockTx.userTenantMembership.create.mock.invocationCallOrder[0];
      expect(labConnCallOrder).toBeLessThan(membershipCallOrder);
    });
  });

  // ── createLabLink ────────────────────────────────────────────────────────

  describe('createLabLink', () => {
    it('creates a LAB_ADMIN token and returns an onboarding link', async () => {
      prisma.onboardingToken.create.mockResolvedValue({});

      const result = await service.createLabLink({
        labName: 'Kesher Diagnostics',
        labEmail: 'info@kesherlab.com',
      });

      expect(result.token).toBeDefined();
      expect(result.onboardingLink).toContain('/onboarding/welcome?token=');
      expect(prisma.onboardingToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'LAB_ADMIN',
            labName: 'Kesher Diagnostics',
            labEmail: 'info@kesherlab.com',
          }),
        })
      );
    });
  });

  // ── verifyOnboardingToken (LAB_ADMIN) ────────────────────────────────────

  describe('verifyOnboardingToken (LAB_ADMIN)', () => {
    it('returns labName and labEmail for LAB_ADMIN tokens', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(
        makeLabOnboardingToken()
      );

      const result = await service.verifyOnboardingToken('lab-hex-token');

      expect(result).toMatchObject({
        valid: true,
        type: 'LAB_ADMIN',
        labName: 'Kesher Diagnostics',
        labEmail: 'info@kesherlab.com',
      });
      expect(result).not.toHaveProperty('clinicName');
    });

    it('returns { valid: false, reason: "revoked" } when token is revoked', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(
        makeLabOnboardingToken({ revokedAt: new Date() })
      );

      const result = await service.verifyOnboardingToken('lab-hex-token');

      expect(result).toEqual({ valid: false, reason: 'revoked' });
    });
  });

  // ── completeLabOnboarding ────────────────────────────────────────────────

  describe('completeLabOnboarding', () => {
    const dto = {
      token: 'lab-hex-token',
      adminFirstName: 'Jane',
      adminLastName: 'Doe',
      adminEmail: 'jane@kesherlab.com',
      password: 'password123',
      labName: 'Kesher Diagnostics',
    };

    function setupLabHappyPath() {
      prisma.onboardingToken.findUnique.mockResolvedValue(
        makeLabOnboardingToken()
      );
      auth.createSupabaseUser.mockResolvedValue('supabase-uid');

      const mockTx = {
        onboardingToken: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        tenant: {
          create: jest.fn().mockResolvedValue({ id: 'lab-tenant-id' }),
          findFirst: jest.fn().mockResolvedValue(null),
        },
        laboratoryProfile: { create: jest.fn().mockResolvedValue({}) },
        user: { create: jest.fn().mockResolvedValue({}) },
        userTenantMembership: { create: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation(
        (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)
      );
      return mockTx;
    }

    it('throws NotFoundException when token does not exist', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(null);

      await expect(service.completeLabOnboarding(dto)).rejects.toThrow(
        NotFoundException
      );
    });

    it('throws ConflictException when token has already been used', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(
        makeLabOnboardingToken({ used: true })
      );

      await expect(service.completeLabOnboarding(dto)).rejects.toThrow(
        ConflictException
      );
    });

    it('throws BadRequestException when token has expired', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(
        makeLabOnboardingToken({ expiresAt: PAST })
      );

      await expect(service.completeLabOnboarding(dto)).rejects.toThrow(
        BadRequestException
      );
    });

    it('throws BadRequestException when token type is not LAB_ADMIN', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(
        makeOnboardingToken()
      );

      await expect(service.completeLabOnboarding(dto)).rejects.toThrow(
        BadRequestException
      );
    });

    it('deletes the Supabase user when the Prisma transaction fails', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(
        makeLabOnboardingToken()
      );
      auth.createSupabaseUser.mockResolvedValue('supabase-uid');
      prisma.tenant.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockRejectedValue(new Error('DB connection lost'));

      await expect(service.completeLabOnboarding(dto)).rejects.toThrow(
        'DB connection lost'
      );

      expect(auth.deleteSupabaseUser).toHaveBeenCalledWith('supabase-uid');
    });

    it('throws ConflictException and skips tenant creation when token claim returns count 0', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(
        makeLabOnboardingToken()
      );
      auth.createSupabaseUser.mockResolvedValue('supabase-uid');

      const mockTx = {
        onboardingToken: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        tenant: {
          create: jest.fn(),
          findFirst: jest.fn(),
        },
        laboratoryProfile: { create: jest.fn() },
        user: { create: jest.fn() },
        userTenantMembership: { create: jest.fn() },
      };
      prisma.$transaction.mockImplementation(
        (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)
      );

      await expect(service.completeLabOnboarding(dto)).rejects.toThrow(
        ConflictException
      );

      expect(mockTx.tenant.create).not.toHaveBeenCalled();
      expect(mockTx.user.create).not.toHaveBeenCalled();
      expect(auth.deleteSupabaseUser).toHaveBeenCalledWith('supabase-uid');
    });

    it('returns tenantId and userId on happy path', async () => {
      setupLabHappyPath();

      const result = await service.completeLabOnboarding(dto);

      expect(result).toMatchObject({
        tenantId: 'lab-tenant-id',
        userId: 'supabase-uid',
      });
    });

    it('creates Tenant with type LAB and LaboratoryProfile', async () => {
      const mockTx = setupLabHappyPath();

      await service.completeLabOnboarding(dto);

      expect(mockTx.tenant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'LAB',
            name: 'Kesher Diagnostics',
          }),
        })
      );
      expect(mockTx.laboratoryProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            vetVerificationRequired: false,
          }),
        })
      );
    });

    it('appends a suffix to the slug when there is a slug conflict', async () => {
      prisma.onboardingToken.findUnique.mockResolvedValue(
        makeLabOnboardingToken()
      );
      auth.createSupabaseUser.mockResolvedValue('supabase-uid');

      const mockTx = {
        onboardingToken: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        tenant: {
          create: jest.fn().mockResolvedValue({ id: 'lab-tenant-id' }),
          findFirst: jest.fn().mockResolvedValue({ id: 'existing-tenant' }),
        },
        laboratoryProfile: { create: jest.fn().mockResolvedValue({}) },
        user: { create: jest.fn().mockResolvedValue({}) },
        userTenantMembership: { create: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation(
        (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)
      );

      await service.completeLabOnboarding(dto);

      const createdSlug = mockTx.tenant.create.mock.calls[0][0].data
        .slug as string;
      expect(createdSlug).toMatch(/^kesher-diagnostics-[a-z0-9]{6}$/);
    });

    it('claims the token atomically via conditional updateMany', async () => {
      const mockTx = setupLabHappyPath();

      await service.completeLabOnboarding(dto);

      expect(mockTx.onboardingToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'lab-token-id',
            used: false,
            revokedAt: null,
            type: 'LAB_ADMIN',
          }),
          data: expect.objectContaining({ used: true }),
        })
      );
    });

    it('assigns OWNER role to the lab creator', async () => {
      const mockTx = setupLabHappyPath();

      await service.completeLabOnboarding(dto);

      expect(mockTx.userTenantMembership.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ role: TenantRole.OWNER }),
        })
      );
    });

    it('uses labEmail from token as tenant email', async () => {
      const mockTx = setupLabHappyPath();

      await service.completeLabOnboarding(dto);

      expect(mockTx.tenant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'info@kesherlab.com',
          }),
        })
      );
    });

    it('does not create a ClinicLabConnection', async () => {
      setupLabHappyPath();

      await service.completeLabOnboarding(dto);

      expect(prisma.clinicLabConnection.findFirst).not.toHaveBeenCalled();
    });
  });

  // ── listLabs ─────────────────────────────────────────────────────────────

  describe('listLabs', () => {
    it('returns all LAB tenants ordered by createdAt desc', async () => {
      const labs = [
        {
          id: 'lab-1',
          name: 'Lab A',
          slug: 'lab-a',
          email: 'a@lab.com',
          createdAt: new Date(),
        },
        {
          id: 'lab-2',
          name: 'Lab B',
          slug: 'lab-b',
          email: 'b@lab.com',
          createdAt: new Date(),
        },
      ];
      prisma.tenant.findMany = jest.fn().mockResolvedValue(labs);

      const result = await service.listLabs();

      expect(result).toEqual(labs);
      expect(prisma.tenant.findMany).toHaveBeenCalledWith({
        where: { type: 'LAB' },
        select: {
          id: true,
          name: true,
          slug: true,
          email: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  // ── deleteLab ───────────────────────────────────────────────────────────

  describe('deleteLab', () => {
    function setupDeleteHappyPath() {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 'lab-tenant-id',
        type: 'LAB',
      });
      prisma.userTenantMembership.findMany = jest
        .fn()
        .mockResolvedValue([{ userId: 'user-1' }, { userId: 'user-2' }]);
      prisma.userTenantMembership.count.mockResolvedValue(0);
      prisma.user.delete.mockResolvedValue({});

      const mockTx = {
        order: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        orderedTest: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        resultTemplateDefinition: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        pickup: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        vetLabVerification: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        tenant: { delete: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation(
        (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)
      );
      return mockTx;
    }

    it('throws NotFoundException when tenant does not exist', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);

      await expect(service.deleteLab('missing-id')).rejects.toThrow(
        NotFoundException
      );
    });

    it('throws BadRequestException when tenant is not a lab', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 'clinic-id',
        type: 'CLINIC',
      });

      await expect(service.deleteLab('clinic-id')).rejects.toThrow(
        BadRequestException
      );
    });

    it('nulls out nullable lab FKs and deletes non-cascading rows inside the transaction', async () => {
      const mockTx = setupDeleteHappyPath();

      await service.deleteLab('lab-tenant-id');

      expect(mockTx.order.updateMany).toHaveBeenCalledWith({
        where: { labTenantId: 'lab-tenant-id' },
        data: { labTenantId: null },
      });
      expect(mockTx.orderedTest.updateMany).toHaveBeenCalledWith({
        where: { catalogItem: { labTenantId: 'lab-tenant-id' } },
        data: { catalogItemId: null },
      });
      expect(mockTx.resultTemplateDefinition.updateMany).toHaveBeenCalledWith({
        where: { labTenantId: 'lab-tenant-id' },
        data: { labTenantId: null },
      });
      expect(mockTx.pickup.deleteMany).toHaveBeenCalledWith({
        where: { labTenantId: 'lab-tenant-id' },
      });
      expect(mockTx.vetLabVerification.deleteMany).toHaveBeenCalledWith({
        where: { labTenantId: 'lab-tenant-id' },
      });
    });

    it('deletes the tenant inside the transaction', async () => {
      const mockTx = setupDeleteHappyPath();

      await service.deleteLab('lab-tenant-id');

      expect(mockTx.tenant.delete).toHaveBeenCalledWith({
        where: { id: 'lab-tenant-id' },
      });
    });

    it('deletes Supabase users that have no other memberships', async () => {
      setupDeleteHappyPath();

      await service.deleteLab('lab-tenant-id');

      expect(auth.deleteSupabaseUser).toHaveBeenCalledWith('user-1');
      expect(auth.deleteSupabaseUser).toHaveBeenCalledWith('user-2');
    });

    it('skips Supabase user deletion when user has other memberships', async () => {
      setupDeleteHappyPath();
      prisma.userTenantMembership.count.mockResolvedValue(1);

      await service.deleteLab('lab-tenant-id');

      expect(auth.deleteSupabaseUser).not.toHaveBeenCalled();
    });

    it('returns deleted confirmation with tenant id', async () => {
      setupDeleteHappyPath();

      const result = await service.deleteLab('lab-tenant-id');

      expect(result).toMatchObject({
        deleted: true,
        tenantId: 'lab-tenant-id',
      });
    });
  });
});

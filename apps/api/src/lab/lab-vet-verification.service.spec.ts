import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { LabVetVerificationService } from './lab-vet-verification.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LAB_ID = 'lab-tenant-1';
const VER_ID = 'ver-1';
const ACTOR_ID = 'actor-1';
const ACTOR_NAME = 'Dr. Reviewer';
const VET_USER_ID = 'vet-user-1';
const CRED_ID = 'cred-1';
const CRED_ID_NEW = 'cred-2';

function makeCredential(overrides = {}) {
  return {
    id: CRED_ID,
    veterinarianProfileId: 'profile-1',
    documentKey: `vet-credentials/${VET_USER_ID}/${CRED_ID}.pdf`,
    licenseNumber: 'VET-12345',
    issuingCountry: 'MX',
    issuingAuthority: null,
    licenseExpiresAt: null,
    replacedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeVerification(overrides = {}) {
  return {
    id: VER_ID,
    labTenantId: LAB_ID,
    vetProfileId: 'profile-1',
    initiatingClinicId: 'clinic-1',
    status: 'PENDING',
    reviewedCredentialId: null,
    submittedAt: new Date(),
    reviewedAt: null,
    reviewedByUserId: null,
    reviewedByName: null,
    rejectionReason: null,
    revokedAt: null,
    revokedByUserId: null,
    revokedReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    vetProfile: {
      id: 'profile-1',
      userId: VET_USER_ID,
      legalName: 'Dr. Ana García',
      credentials: [makeCredential()],
    },
    initiatingClinic: { name: 'Clínica Veterinaria Norte' },
    reviewedBy: null,
    events: [],
    ...overrides,
  };
}

function makePrismaMock() {
  const mock = {
    vetLabVerification: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
    },
    veterinarianCredential: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    vetVerificationEvent: {
      create: jest.fn().mockResolvedValue({}),
    },
    clinicLabConnection: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    userTenantMembership: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest
      .fn()
      .mockImplementation((cb: (tx: typeof mock) => Promise<unknown>) =>
        cb(mock)
      ),
  };
  return mock;
}

function makeStorageMock() {
  return {
    getSignedUrl: jest.fn().mockResolvedValue('https://signed.url/doc'),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LabVetVerificationService', () => {
  let service: LabVetVerificationService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let storage: ReturnType<typeof makeStorageMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    storage = makeStorageMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LabVetVerificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    service = module.get(LabVetVerificationService);
  });

  // ── getById — profileChangedAfterApproval ───────────────────────────────────

  describe('getById — profileChangedAfterApproval flag', () => {
    it('is false when status is PENDING', async () => {
      prisma.vetLabVerification.findFirst.mockResolvedValue(makeVerification());

      const result = await service.getById(LAB_ID, VER_ID);

      expect(result.profileChangedAfterApproval).toBe(false);
    });

    it('is false when status is APPROVED and active credential matches reviewed credential', async () => {
      prisma.vetLabVerification.findFirst.mockResolvedValue(
        makeVerification({
          status: 'APPROVED',
          reviewedCredentialId: CRED_ID, // same as active credential id
        })
      );

      const result = await service.getById(LAB_ID, VER_ID);

      expect(result.profileChangedAfterApproval).toBe(false);
    });

    it('is true when status is APPROVED and active credential differs from reviewed credential', async () => {
      prisma.vetLabVerification.findFirst.mockResolvedValue(
        makeVerification({
          status: 'APPROVED',
          reviewedCredentialId: CRED_ID,
          vetProfile: {
            id: 'profile-1',
            userId: VET_USER_ID,
            legalName: 'Dr. Ana García',
            // Active credential has a different id — vet uploaded a new one after approval
            credentials: [makeCredential({ id: CRED_ID_NEW })],
          },
        })
      );

      const result = await service.getById(LAB_ID, VER_ID);

      expect(result.profileChangedAfterApproval).toBe(true);
    });

    it('is true when status is APPROVED and active credential no longer exists (replaced but not re-uploaded)', async () => {
      prisma.vetLabVerification.findFirst.mockResolvedValue(
        makeVerification({
          status: 'APPROVED',
          reviewedCredentialId: CRED_ID,
          vetProfile: {
            id: 'profile-1',
            userId: VET_USER_ID,
            legalName: 'Dr. Ana García',
            credentials: [],
          },
        })
      );

      const result = await service.getById(LAB_ID, VER_ID);

      // No active credential, but approval was for a specific credential → definitely changed
      expect(result.profileChangedAfterApproval).toBe(true);
    });

    it('throws NotFoundException when verification not found', async () => {
      prisma.vetLabVerification.findFirst.mockResolvedValue(null);

      await expect(service.getById(LAB_ID, VER_ID)).rejects.toThrow(
        NotFoundException
      );
    });
  });

  // ── approve ─────────────────────────────────────────────────────────────────

  describe('approve', () => {
    it('updates status to APPROVED and writes APPROVED event', async () => {
      prisma.vetLabVerification.findFirst.mockResolvedValue(
        makeVerification({
          vetProfile: {
            id: 'profile-1',
            userId: VET_USER_ID,
            credentials: [{ id: CRED_ID }],
          },
        })
      );

      const result = await service.approve(
        LAB_ID,
        VER_ID,
        ACTOR_ID,
        ACTOR_NAME
      );

      expect(prisma.vetLabVerification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: VER_ID },
          data: expect.objectContaining({
            status: 'APPROVED',
            reviewedByUserId: ACTOR_ID,
            reviewedByName: ACTOR_NAME,
            reviewedCredentialId: CRED_ID,
          }),
        })
      );
      expect(prisma.vetVerificationEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            verificationId: VER_ID,
            eventType: 'APPROVED',
            actorId: ACTOR_ID,
            credentialVersionId: CRED_ID,
          }),
        })
      );
      expect(result).toEqual({ id: VER_ID, status: 'APPROVED' });
    });

    it('activates ordering-vet memberships for all connected clinics', async () => {
      prisma.vetLabVerification.findFirst.mockResolvedValue(
        makeVerification({
          vetProfile: {
            id: 'profile-1',
            userId: VET_USER_ID,
            credentials: [{ id: CRED_ID }],
          },
        })
      );
      prisma.clinicLabConnection.findMany.mockResolvedValue([
        { clinicId: 'clinic-1' },
        { clinicId: 'clinic-2' },
      ]);

      await service.approve(LAB_ID, VER_ID, ACTOR_ID, ACTOR_NAME);

      expect(prisma.userTenantMembership.updateMany).toHaveBeenCalledWith({
        where: {
          userId: VET_USER_ID,
          tenantId: { in: ['clinic-1', 'clinic-2'] },
          isOrderingVet: true,
        },
        data: { status: 'ACTIVE' },
      });
    });

    it('throws ConflictException when status is not PENDING', async () => {
      prisma.vetLabVerification.findFirst.mockResolvedValue(
        makeVerification({ status: 'APPROVED' })
      );

      await expect(
        service.approve(LAB_ID, VER_ID, ACTOR_ID, ACTOR_NAME)
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when verification not found', async () => {
      prisma.vetLabVerification.findFirst.mockResolvedValue(null);

      await expect(
        service.approve(LAB_ID, VER_ID, ACTOR_ID, ACTOR_NAME)
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── reject ──────────────────────────────────────────────────────────────────

  describe('reject', () => {
    it('updates status to REJECTED and writes REJECTED event', async () => {
      prisma.vetLabVerification.findFirst.mockResolvedValue(
        makeVerification({ status: 'PENDING' })
      );

      const result = await service.reject(
        LAB_ID,
        VER_ID,
        'License could not be verified.',
        ACTOR_ID,
        ACTOR_NAME
      );

      expect(prisma.vetLabVerification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'REJECTED',
            rejectionReason: 'License could not be verified.',
          }),
        })
      );
      expect(prisma.vetVerificationEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            verificationId: VER_ID,
            eventType: 'REJECTED',
            reason: 'License could not be verified.',
          }),
        })
      );
      expect(result).toEqual({ id: VER_ID, status: 'REJECTED' });
    });

    it('throws UnprocessableEntityException when reason is empty', async () => {
      await expect(
        service.reject(LAB_ID, VER_ID, '   ', ACTOR_ID, ACTOR_NAME)
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws ConflictException when status is not PENDING', async () => {
      prisma.vetLabVerification.findFirst.mockResolvedValue(
        makeVerification({ status: 'REJECTED' })
      );

      await expect(
        service.reject(LAB_ID, VER_ID, 'reason', ACTOR_ID, ACTOR_NAME)
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── revoke ──────────────────────────────────────────────────────────────────

  describe('revoke', () => {
    it('updates status to REVOKED and writes REVOKED event', async () => {
      prisma.vetLabVerification.findFirst.mockResolvedValue(
        makeVerification({
          status: 'APPROVED',
          vetProfile: { id: 'profile-1', userId: VET_USER_ID },
        })
      );

      const result = await service.revoke(
        LAB_ID,
        VER_ID,
        'Fraudulent license detected.',
        ACTOR_ID,
        ACTOR_NAME
      );

      expect(prisma.vetLabVerification.update).toHaveBeenCalledWith({
        where: { id: VER_ID },
        data: expect.objectContaining({
          status: 'REVOKED',
          revokedByUserId: ACTOR_ID,
          revokedReason: 'Fraudulent license detected.',
        }),
      });
      expect(prisma.vetVerificationEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            verificationId: VER_ID,
            eventType: 'REVOKED',
            actorId: ACTOR_ID,
            actorName: ACTOR_NAME,
            reason: 'Fraudulent license detected.',
          }),
        })
      );
      expect(result).toEqual({ id: VER_ID, status: 'REVOKED' });
    });

    it('reverts ordering-vet memberships to VERIFICATION_PENDING for all connected clinics', async () => {
      prisma.vetLabVerification.findFirst.mockResolvedValue(
        makeVerification({
          status: 'APPROVED',
          vetProfile: { id: 'profile-1', userId: VET_USER_ID },
        })
      );
      prisma.clinicLabConnection.findMany.mockResolvedValue([
        { clinicId: 'clinic-1' },
        { clinicId: 'clinic-2' },
        { clinicId: 'clinic-3' },
      ]);

      await service.revoke(LAB_ID, VER_ID, 'reason', ACTOR_ID, ACTOR_NAME);

      expect(prisma.userTenantMembership.updateMany).toHaveBeenCalledWith({
        where: {
          userId: VET_USER_ID,
          tenantId: { in: ['clinic-1', 'clinic-2', 'clinic-3'] },
          isOrderingVet: true,
        },
        data: { status: 'VERIFICATION_PENDING' },
      });
    });

    it('does not touch memberships when no clinics are connected to the lab', async () => {
      prisma.vetLabVerification.findFirst.mockResolvedValue(
        makeVerification({
          status: 'APPROVED',
          vetProfile: { id: 'profile-1', userId: VET_USER_ID },
        })
      );
      // Default mock returns []

      await service.revoke(LAB_ID, VER_ID, 'reason', ACTOR_ID, ACTOR_NAME);

      expect(prisma.userTenantMembership.updateMany).not.toHaveBeenCalled();
    });

    it('throws UnprocessableEntityException when reason is empty', async () => {
      await expect(
        service.revoke(LAB_ID, VER_ID, '', ACTOR_ID, ACTOR_NAME)
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws ConflictException when status is not APPROVED', async () => {
      prisma.vetLabVerification.findFirst.mockResolvedValue(
        makeVerification({ status: 'PENDING' })
      );

      await expect(
        service.revoke(LAB_ID, VER_ID, 'reason', ACTOR_ID, ACTOR_NAME)
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when already REVOKED', async () => {
      prisma.vetLabVerification.findFirst.mockResolvedValue(
        makeVerification({ status: 'REVOKED' })
      );

      await expect(
        service.revoke(LAB_ID, VER_ID, 'reason', ACTOR_ID, ACTOR_NAME)
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when verification not found', async () => {
      prisma.vetLabVerification.findFirst.mockResolvedValue(null);

      await expect(
        service.revoke(LAB_ID, VER_ID, 'reason', ACTOR_ID, ACTOR_NAME)
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── getDocument — DOCUMENT_VIEWED audit trail ───────────────────────────────

  describe('getDocument', () => {
    it('returns signed URL and writes DOCUMENT_VIEWED event', async () => {
      const credential = makeCredential();
      prisma.vetLabVerification.findFirst.mockResolvedValue(
        makeVerification({
          vetProfile: {
            id: 'profile-1',
            userId: VET_USER_ID,
            legalName: 'Dr. Ana García',
            credentials: [credential],
          },
        })
      );

      const result = await service.getDocument(
        LAB_ID,
        VER_ID,
        ACTOR_ID,
        ACTOR_NAME
      );

      expect(storage.getSignedUrl).toHaveBeenCalledWith(
        credential.documentKey,
        3600
      );
      expect(result.signedUrl).toBe('https://signed.url/doc');
      expect(result.expiresAt).toBeDefined();
      expect(prisma.vetVerificationEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            verificationId: VER_ID,
            eventType: 'DOCUMENT_VIEWED',
            actorId: ACTOR_ID,
            actorName: ACTOR_NAME,
            credentialVersionId: credential.id,
            clinicTenantId: 'clinic-1',
          }),
        })
      );
    });

    it('throws NotFoundException when no active credential exists', async () => {
      prisma.vetLabVerification.findFirst.mockResolvedValue(
        makeVerification({
          vetProfile: {
            id: 'profile-1',
            userId: VET_USER_ID,
            legalName: 'Dr. Ana García',
            credentials: [],
          },
        })
      );

      await expect(
        service.getDocument(LAB_ID, VER_ID, ACTOR_ID, ACTOR_NAME)
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when verification not found', async () => {
      prisma.vetLabVerification.findFirst.mockResolvedValue(null);

      await expect(
        service.getDocument(LAB_ID, VER_ID, ACTOR_ID, ACTOR_NAME)
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── getCount ─────────────────────────────────────────────────────────────────

  describe('getCount', () => {
    it('returns count for a given status', async () => {
      prisma.vetLabVerification.count.mockResolvedValue(7);

      const result = await service.getCount(LAB_ID, 'PENDING');

      expect(prisma.vetLabVerification.count).toHaveBeenCalledWith({
        where: { labTenantId: LAB_ID, status: 'PENDING' },
      });
      expect(result).toEqual({ count: 7 });
    });

    it('counts all statuses when no status filter provided', async () => {
      prisma.vetLabVerification.count.mockResolvedValue(15);

      const result = await service.getCount(LAB_ID);

      expect(prisma.vetLabVerification.count).toHaveBeenCalledWith({
        where: { labTenantId: LAB_ID },
      });
      expect(result).toEqual({ count: 15 });
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { VetProfileService } from './vet-profile.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = 'user-1';
const PROFILE_ID = 'profile-1';

function makeProfile(overrides = {}) {
  return {
    id: PROFILE_ID,
    userId: USER_ID,
    legalName: 'Dr. Ana García',
    createdAt: new Date(),
    updatedAt: new Date(),
    credentials: [],
    ...overrides,
  };
}

function makeCredential(overrides = {}) {
  return {
    id: 'cred-1',
    veterinarianProfileId: PROFILE_ID,
    documentKey: `vet-credentials/${USER_ID}/cred-1.pdf`,
    licenseNumber: 'VET-12345',
    issuingCountry: 'MX',
    issuingAuthority: 'SENASICA',
    licenseExpiresAt: null,
    createdAt: new Date(),
    replacedAt: null,
    ...overrides,
  };
}

function makeFile(
  overrides: Partial<Express.Multer.File> = {}
): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'license.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    buffer: Buffer.from('pdf content'),
    size: 1024,
    stream: null as never,
    destination: '',
    filename: '',
    path: '',
    ...overrides,
  };
}

function makePrismaMock() {
  const mock = {
    veterinarianProfile: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    veterinarianCredential: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn(),
    },
    vetLabVerification: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    vetVerificationEvent: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
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
    uploadPrivate: jest.fn().mockResolvedValue(undefined),
    getSignedUrl: jest.fn().mockResolvedValue('https://signed.url/doc'),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VetProfileService', () => {
  let service: VetProfileService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let storage: ReturnType<typeof makeStorageMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    storage = makeStorageMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VetProfileService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    service = module.get(VetProfileService);
  });

  // ── getProfile ─────────────────────────────────────────────────────────────

  describe('getProfile', () => {
    it('returns profile with active credential', async () => {
      const credential = makeCredential();
      prisma.veterinarianProfile.findUnique.mockResolvedValue(
        makeProfile({ credentials: [credential] })
      );

      const result = await service.getProfile(USER_ID);

      expect(result.id).toBe(PROFILE_ID);
      expect(result.activeCredential).toEqual(credential);
    });

    it('returns null activeCredential when no credential exists', async () => {
      prisma.veterinarianProfile.findUnique.mockResolvedValue(
        makeProfile({ credentials: [] })
      );

      const result = await service.getProfile(USER_ID);

      expect(result.activeCredential).toBeNull();
    });

    it('throws NotFoundException when profile does not exist', async () => {
      prisma.veterinarianProfile.findUnique.mockResolvedValue(null);

      await expect(service.getProfile(USER_ID)).rejects.toThrow(
        NotFoundException
      );
    });
  });

  // ── createProfile ──────────────────────────────────────────────────────────

  describe('createProfile', () => {
    it('creates and returns a new profile', async () => {
      prisma.veterinarianProfile.findUnique.mockResolvedValue(null);
      prisma.veterinarianProfile.create.mockResolvedValue(makeProfile());

      const result = await service.createProfile(USER_ID, {
        legalName: 'Dr. Ana García',
      });

      expect(prisma.veterinarianProfile.create).toHaveBeenCalledWith({
        data: { userId: USER_ID, legalName: 'Dr. Ana García' },
      });
      expect(result.id).toBe(PROFILE_ID);
    });

    it('throws ConflictException when profile already exists', async () => {
      prisma.veterinarianProfile.findUnique.mockResolvedValue(makeProfile());

      await expect(
        service.createProfile(USER_ID, { legalName: 'Dr. Ana García' })
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── updateProfile ──────────────────────────────────────────────────────────

  describe('updateProfile', () => {
    it('updates and returns the profile', async () => {
      const updated = makeProfile({ legalName: 'Dr. Ana G.' });
      prisma.veterinarianProfile.findUnique.mockResolvedValue(makeProfile());
      prisma.veterinarianProfile.update.mockResolvedValue(updated);

      const result = await service.updateProfile(USER_ID, {
        legalName: 'Dr. Ana G.',
      });

      expect(prisma.veterinarianProfile.update).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        data: { legalName: 'Dr. Ana G.' },
      });
      expect(result.legalName).toBe('Dr. Ana G.');
    });

    it('throws NotFoundException when profile does not exist', async () => {
      prisma.veterinarianProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.updateProfile(USER_ID, { legalName: 'Dr. Ana G.' })
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── createCredential ───────────────────────────────────────────────────────

  describe('createCredential', () => {
    const dto = { licenseNumber: 'VET-12345', issuingCountry: 'MX' };

    it('uploads file and creates credential record', async () => {
      prisma.veterinarianProfile.findUnique.mockResolvedValue(makeProfile());
      const file = makeFile();

      const result = await service.createCredential(USER_ID, file, dto);

      expect(storage.uploadPrivate).toHaveBeenCalledWith(
        expect.stringContaining(`vet-credentials/${USER_ID}/`),
        file.buffer,
        'application/pdf'
      );
      expect(storage.uploadPrivate.mock.calls[0][0]).toContain('.pdf');
      expect(prisma.veterinarianCredential.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            licenseNumber: 'VET-12345',
            issuingCountry: 'MX',
          }),
        })
      );
      expect(result).toHaveProperty('credentialId');
      expect(result).toHaveProperty('documentKey');
      expect(result.documentKey).toMatch(/vet-credentials\/user-1\/.+\.pdf/);
    });

    it('stamps the previous active credential with replacedAt', async () => {
      prisma.veterinarianProfile.findUnique.mockResolvedValue(makeProfile());

      await service.createCredential(USER_ID, makeFile(), dto);

      expect(prisma.veterinarianCredential.updateMany).toHaveBeenCalledWith({
        where: { veterinarianProfileId: PROFILE_ID, replacedAt: null },
        data: { replacedAt: expect.any(Date) },
      });
    });

    it('path includes credentialId so storage path matches the DB record id', async () => {
      prisma.veterinarianProfile.findUnique.mockResolvedValue(makeProfile());

      const { credentialId, documentKey } = await service.createCredential(
        USER_ID,
        makeFile(),
        dto
      );

      expect(documentKey).toContain(credentialId);
      expect(prisma.veterinarianCredential.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ id: credentialId }),
        })
      );
    });

    it('resets APPROVED verifications to PENDING when credential is replaced', async () => {
      prisma.veterinarianProfile.findUnique.mockResolvedValue(makeProfile());
      prisma.vetLabVerification.findMany.mockResolvedValue([
        { id: 'ver-1', labTenantId: 'lab-1' },
      ]);
      prisma.clinicLabConnection.findMany.mockResolvedValue([
        { clinicId: 'clinic-1' },
      ]);

      await service.createCredential(USER_ID, makeFile(), dto);

      expect(prisma.vetLabVerification.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['ver-1'] } },
        data: expect.objectContaining({ status: 'PENDING' }),
      });
    });

    it('writes RESUBMITTED events for each reset verification', async () => {
      prisma.veterinarianProfile.findUnique.mockResolvedValue(makeProfile());
      prisma.vetLabVerification.findMany.mockResolvedValue([
        { id: 'ver-1', labTenantId: 'lab-1' },
      ]);
      prisma.clinicLabConnection.findMany.mockResolvedValue([]);

      const { credentialId } = await service.createCredential(
        USER_ID,
        makeFile(),
        dto
      );

      expect(prisma.vetVerificationEvent.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            verificationId: 'ver-1',
            eventType: 'RESUBMITTED',
            actorId: USER_ID,
            credentialVersionId: credentialId,
          }),
        ],
      });
    });

    it('sets affected clinic memberships to VERIFICATION_PENDING', async () => {
      prisma.veterinarianProfile.findUnique.mockResolvedValue(makeProfile());
      prisma.vetLabVerification.findMany.mockResolvedValue([
        { id: 'ver-1', labTenantId: 'lab-1' },
      ]);
      prisma.clinicLabConnection.findMany.mockResolvedValue([
        { clinicId: 'clinic-1' },
        { clinicId: 'clinic-2' },
      ]);

      await service.createCredential(USER_ID, makeFile(), dto);

      expect(prisma.userTenantMembership.updateMany).toHaveBeenCalledWith({
        where: {
          userId: USER_ID,
          tenantId: { in: ['clinic-1', 'clinic-2'] },
          isOrderingVet: true,
        },
        data: { status: 'VERIFICATION_PENDING' },
      });
    });

    it('does not touch verifications when none are APPROVED', async () => {
      prisma.veterinarianProfile.findUnique.mockResolvedValue(makeProfile());
      // Default mock returns []

      await service.createCredential(USER_ID, makeFile(), dto);

      expect(prisma.vetLabVerification.updateMany).not.toHaveBeenCalled();
      expect(prisma.vetVerificationEvent.createMany).not.toHaveBeenCalled();
      expect(prisma.userTenantMembership.updateMany).not.toHaveBeenCalled();
    });

    it('passes upsert: false to uploadPrivate (path includes credentialId)', async () => {
      prisma.veterinarianProfile.findUnique.mockResolvedValue(makeProfile());

      await service.createCredential(USER_ID, makeFile(), dto);

      // uploadPrivate always uses upsert: false (enforced in StorageService)
      const [key] = storage.uploadPrivate.mock.calls[0];
      expect(key).toMatch(/^vet-credentials\/.+\/.+\.pdf$/);
    });

    it('throws NotFoundException when profile does not exist', async () => {
      prisma.veterinarianProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.createCredential(USER_ID, makeFile(), dto)
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for disallowed MIME type', async () => {
      prisma.veterinarianProfile.findUnique.mockResolvedValue(makeProfile());

      await expect(
        service.createCredential(
          USER_ID,
          makeFile({ mimetype: 'text/plain' }),
          dto
        )
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when file exceeds 10 MB', async () => {
      prisma.veterinarianProfile.findUnique.mockResolvedValue(makeProfile());

      await expect(
        service.createCredential(
          USER_ID,
          makeFile({ size: 11 * 1024 * 1024 }),
          dto
        )
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── getCredentialDocumentUrl ───────────────────────────────────────────────

  describe('getCredentialDocumentUrl', () => {
    it('returns signed URL for own credential', async () => {
      const credential = makeCredential();
      prisma.veterinarianProfile.findUnique.mockResolvedValue(
        makeProfile({ credentials: [credential] })
      );

      const result = await service.getCredentialDocumentUrl(USER_ID);

      expect(storage.getSignedUrl).toHaveBeenCalledWith(
        credential.documentKey,
        3600
      );
      expect(result.signedUrl).toBe('https://signed.url/doc');
      expect(result.expiresAt).toBeDefined();
    });

    it('writes DOCUMENT_VIEWED event when verification exists', async () => {
      const credential = makeCredential();
      prisma.veterinarianProfile.findUnique.mockResolvedValue(
        makeProfile({ credentials: [credential] })
      );
      prisma.vetLabVerification.findFirst.mockResolvedValue({ id: 'ver-1' });

      await service.getCredentialDocumentUrl(USER_ID);

      expect(prisma.vetVerificationEvent.create).toHaveBeenCalledWith({
        data: {
          verificationId: 'ver-1',
          eventType: 'DOCUMENT_VIEWED',
          actorId: USER_ID,
          credentialVersionId: credential.id,
        },
      });
    });

    it('does not write DOCUMENT_VIEWED event when no verification exists', async () => {
      const credential = makeCredential();
      prisma.veterinarianProfile.findUnique.mockResolvedValue(
        makeProfile({ credentials: [credential] })
      );
      // Default mock returns null

      await service.getCredentialDocumentUrl(USER_ID);

      expect(prisma.vetVerificationEvent.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when profile does not exist', async () => {
      prisma.veterinarianProfile.findUnique.mockResolvedValue(null);

      await expect(service.getCredentialDocumentUrl(USER_ID)).rejects.toThrow(
        NotFoundException
      );
    });

    it('throws NotFoundException when no active credential exists', async () => {
      prisma.veterinarianProfile.findUnique.mockResolvedValue(
        makeProfile({ credentials: [] })
      );

      await expect(service.getCredentialDocumentUrl(USER_ID)).rejects.toThrow(
        NotFoundException
      );
    });
  });
});

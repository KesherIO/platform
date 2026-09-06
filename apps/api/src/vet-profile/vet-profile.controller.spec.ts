import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { VetProfileController } from './vet-profile.controller';
import { VetProfileService } from './vet-profile.service';
import { TenantGuard } from '../auth/guards/tenant.guard';
import type { AuthenticatedUser } from '@vet-ai/shared-types';

const USER: AuthenticatedUser = {
  id: 'user-1',
  email: 'vet@clinic.com',
};

function makeServiceMock() {
  return {
    getProfile: jest.fn().mockResolvedValue({
      id: 'profile-1',
      userId: 'user-1',
      legalName: 'Dr. Ana',
      activeCredential: null,
    }),
    createProfile: jest.fn().mockResolvedValue({
      id: 'profile-1',
      userId: 'user-1',
      legalName: 'Dr. Ana',
    }),
    updateProfile: jest.fn().mockResolvedValue({
      id: 'profile-1',
      userId: 'user-1',
      legalName: 'Dr. Ana G.',
    }),
    createCredential: jest.fn().mockResolvedValue({
      credentialId: 'cred-1',
      documentKey: 'vet-credentials/user-1/cred-1.pdf',
    }),
    getCredentialDocumentUrl: jest.fn().mockResolvedValue({
      signedUrl: 'https://signed.url/doc',
      expiresAt: '2026-09-05T01:00:00Z',
    }),
  };
}

describe('VetProfileController', () => {
  let controller: VetProfileController;
  let service: ReturnType<typeof makeServiceMock>;

  beforeEach(async () => {
    service = makeServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VetProfileController],
      providers: [{ provide: VetProfileService, useValue: service }],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(VetProfileController);
  });

  it('creates without error', () => {
    expect(controller).toBeDefined();
  });

  describe('getProfile', () => {
    it('delegates to service with user id', async () => {
      const result = await controller.getProfile(USER);
      expect(service.getProfile).toHaveBeenCalledWith(USER.id);
      expect(result).toHaveProperty('id', 'profile-1');
    });
  });

  describe('createProfile', () => {
    it('delegates to service with user id and dto', async () => {
      const dto = { legalName: 'Dr. Ana' };
      await controller.createProfile(USER, dto);
      expect(service.createProfile).toHaveBeenCalledWith(USER.id, dto);
    });
  });

  describe('updateProfile', () => {
    it('delegates to service with user id and dto', async () => {
      const dto = { legalName: 'Dr. Ana G.' };
      await controller.updateProfile(USER, dto);
      expect(service.updateProfile).toHaveBeenCalledWith(USER.id, dto);
    });
  });

  describe('createCredential', () => {
    const dto = { licenseNumber: 'VET-1', issuingCountry: 'MX' };
    const file = {
      buffer: Buffer.from('pdf'),
      mimetype: 'application/pdf',
      size: 1024,
    } as Express.Multer.File;

    it('delegates to service with user id, file and dto', async () => {
      const result = await controller.createCredential(USER, file, dto);
      expect(service.createCredential).toHaveBeenCalledWith(USER.id, file, dto);
      expect(result).toHaveProperty('credentialId');
    });

    it('throws BadRequestException when file is missing', () => {
      expect(() =>
        controller.createCredential(USER, undefined as never, dto)
      ).toThrow(BadRequestException);
    });
  });

  describe('getCredentialDocument', () => {
    it('delegates to service and returns signed URL', async () => {
      const result = await controller.getCredentialDocument(USER);
      expect(service.getCredentialDocumentUrl).toHaveBeenCalledWith(USER.id);
      expect(result.signedUrl).toBeDefined();
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser, TenantContext } from '@vet-ai/shared-types';
import { VetVerificationController } from './vet-verification.controller';
import { VetVerificationService } from './vet-verification.service';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ALLOW_ONBOARDING_MEMBERSHIP_KEY } from '../auth/decorators/allow-onboarding-membership.decorator';

describe('VetVerificationController', () => {
  let controller: VetVerificationController;
  const service = { getStatus: jest.fn(), submit: jest.fn() };
  const user = { id: 'user-1' } as AuthenticatedUser;
  const tenant = { tenantId: 'clinic-1' } as TenantContext;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [VetVerificationController],
      providers: [
        { provide: VetVerificationService, useValue: service },
        { provide: PrismaService, useValue: {} },
      ],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(VetVerificationController);
  });

  it('creates without error', () => {
    expect(controller).toBeDefined();
  });

  it('lets members still onboarding through TenantGuard', () => {
    expect(
      new Reflector().get(
        ALLOW_ONBOARDING_MEMBERSHIP_KEY,
        VetVerificationController
      )
    ).toBe(true);
  });

  it('getStatus delegates with the user and clinic', async () => {
    service.getStatus.mockResolvedValue({ status: 'PENDING' });

    await expect(controller.getStatus(user, tenant)).resolves.toEqual({
      status: 'PENDING',
    });
    expect(service.getStatus).toHaveBeenCalledWith('user-1', 'clinic-1');
  });

  it('submit delegates with the user and clinic', async () => {
    service.submit.mockResolvedValue({ submitted: true });

    await controller.submit(user, tenant);
    expect(service.submit).toHaveBeenCalledWith('user-1', 'clinic-1');
  });
});

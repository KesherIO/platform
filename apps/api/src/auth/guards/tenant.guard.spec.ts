import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantRole } from '@vet-ai/shared-types';
import { TenantGuard } from './tenant.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { ALLOW_ONBOARDING_MEMBERSHIP_KEY } from '../decorators/allow-onboarding-membership.decorator';
import type { PrismaService } from '../../prisma/prisma.service';

const membership = (overrides: Record<string, unknown> = {}) => ({
  role: 'VET',
  isOrderingVet: true,
  status: 'ACTIVE',
  tenant: { name: 'Clinic', logoUrl: null, type: 'CLINIC' },
  ...overrides,
});

/** An execution context for a handler with the given metadata. */
function contextFor(
  opts: {
    roles?: TenantRole[];
    allowOnboarding?: boolean;
    tenantId?: string | null;
  } = {}
) {
  const handler = () => undefined;
  if (opts.roles) Reflect.defineMetadata(ROLES_KEY, opts.roles, handler);
  if (opts.allowOnboarding) {
    Reflect.defineMetadata(ALLOW_ONBOARDING_MEMBERSHIP_KEY, true, handler);
  }
  const tenantId = opts.tenantId === undefined ? 'clinic-1' : opts.tenantId;
  const request: Record<string, unknown> = {
    user: { id: 'user-1' },
    headers: tenantId ? { 'x-tenant-id': tenantId } : {},
  };
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => class {},
    } as unknown as ExecutionContext,
  };
}

describe('TenantGuard', () => {
  let findUnique: jest.Mock;
  let guard: TenantGuard;

  beforeEach(() => {
    findUnique = jest.fn().mockResolvedValue(membership());
    guard = new TenantGuard(
      { userTenantMembership: { findUnique } } as unknown as PrismaService,
      new Reflector()
    );
  });

  it('sets the tenant context for an active member', async () => {
    const { context, request } = contextFor();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_tenantId: { userId: 'user-1', tenantId: 'clinic-1' } },
      })
    );
    expect(request.tenant).toEqual(
      expect.objectContaining({
        tenantId: 'clinic-1',
        role: 'VET',
        status: 'ACTIVE',
      })
    );
  });

  it('requires the x-tenant-id header', async () => {
    const { context } = contextFor({ tenantId: null });

    await expect(guard.canActivate(context)).rejects.toThrow(
      BadRequestException
    );
  });

  it('refuses a non-member and a non-clinic tenant', async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect(guard.canActivate(contextFor().context)).rejects.toThrow(
      ForbiddenException
    );

    findUnique.mockResolvedValueOnce(
      membership({ tenant: { name: 'Lab', logoUrl: null, type: 'LAB' } })
    );
    await expect(guard.canActivate(contextFor().context)).rejects.toThrow(
      ForbiddenException
    );
  });

  it.each(['PROFILE_REQUIRED', 'VERIFICATION_PENDING', 'SUSPENDED', 'INVITED'])(
    'refuses a %s member on a normal clinic route',
    async (status) => {
      findUnique.mockResolvedValue(membership({ status }));
      const { context, request } = contextFor();

      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException
      );
      expect(request.tenant).toBeUndefined();
    }
  );

  it.each(['PROFILE_REQUIRED', 'VERIFICATION_PENDING'])(
    'admits a %s member on an onboarding route',
    async (status) => {
      findUnique.mockResolvedValue(membership({ status }));
      const { context, request } = contextFor({ allowOnboarding: true });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.tenant).toEqual(expect.objectContaining({ status }));
    }
  );

  it.each(['SUSPENDED', 'INVITED'])(
    'refuses a %s member even on an onboarding route',
    async (status) => {
      findUnique.mockResolvedValue(membership({ status }));

      await expect(
        guard.canActivate(contextFor({ allowOnboarding: true }).context)
      ).rejects.toThrow(ForbiddenException);
    }
  );

  it('enforces @Roles after the membership checks', async () => {
    await expect(
      guard.canActivate(
        contextFor({ roles: [TenantRole.OWNER, TenantRole.ADMIN] }).context
      )
    ).rejects.toThrow('Insufficient role for this action.');

    findUnique.mockResolvedValue(membership({ role: 'ADMIN' }));
    await expect(
      guard.canActivate(
        contextFor({ roles: [TenantRole.OWNER, TenantRole.ADMIN] }).context
      )
    ).resolves.toBe(true);
  });
});

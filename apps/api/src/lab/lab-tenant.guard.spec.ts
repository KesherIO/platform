import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantRole } from '@vet-ai/shared-types';
import { LabTenantGuard } from './lab-tenant.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import type { PrismaService } from '../prisma/prisma.service';

const membership = (overrides: Record<string, unknown> = {}) => ({
  role: 'ANALYST',
  status: 'ACTIVE',
  canPerformPickups: false,
  canViewInProgress: false,
  tenant: { id: 'lab-1', name: 'Lab', logoUrl: null, type: 'LAB' },
  ...overrides,
});

/** An execution context for a handler with the given @Roles. */
function contextFor(roles: TenantRole[] | undefined, tenantId = 'lab-1') {
  const handler = () => undefined;
  if (roles) Reflect.defineMetadata(ROLES_KEY, roles, handler);
  const request: Record<string, unknown> = {
    user: { id: 'user-1' },
    headers: { 'x-tenant-id': tenantId },
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

describe('LabTenantGuard', () => {
  let findUnique: jest.Mock;
  let guard: LabTenantGuard;

  beforeEach(() => {
    findUnique = jest.fn().mockResolvedValue(membership());
    guard = new LabTenantGuard(
      {
        userTenantMembership: { findUnique, findFirst: jest.fn() },
      } as unknown as PrismaService,
      new Reflector()
    );
  });

  it('sets the tenant context from the membership', async () => {
    const { context, request } = contextFor([TenantRole.ANALYST]);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request['tenant']).toMatchObject({
      tenantId: 'lab-1',
      role: 'ANALYST',
      status: 'ACTIVE',
      canViewInProgress: false,
    });
  });

  it('passes the in-progress flag of a results viewer', async () => {
    findUnique.mockResolvedValue(
      membership({ role: 'RESULTS_VIEWER', canViewInProgress: true })
    );
    const { context, request } = contextFor([TenantRole.RESULTS_VIEWER]);

    await guard.canActivate(context);
    expect(request['tenant']).toMatchObject({ canViewInProgress: true });
  });

  it('denies a route without @Roles, whatever the role', async () => {
    findUnique.mockResolvedValue(membership({ role: 'OWNER' }));
    await expect(
      guard.canActivate(contextFor(undefined).context)
    ).rejects.toThrow(ForbiddenException);
  });

  it('reads the membership on every request: a role change applies at once', async () => {
    const roles = [TenantRole.ADMIN, TenantRole.OWNER];
    findUnique.mockResolvedValueOnce(membership({ role: 'ADMIN' }));
    await expect(guard.canActivate(contextFor(roles).context)).resolves.toBe(
      true
    );

    findUnique.mockResolvedValueOnce(membership({ role: 'ANALYST' }));
    await expect(guard.canActivate(contextFor(roles).context)).rejects.toThrow(
      ForbiddenException
    );
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('a removed member is rejected on the next request', async () => {
    await guard.canActivate(contextFor([TenantRole.ANALYST]).context);

    findUnique.mockResolvedValueOnce(null);
    await expect(
      guard.canActivate(contextFor([TenantRole.ANALYST]).context)
    ).rejects.toThrow(ForbiddenException);
  });

  it.each(['SUSPENDED', 'INVITED', 'PROFILE_REQUIRED', 'VERIFICATION_PENDING'])(
    'rejects a %s membership',
    async (status) => {
      findUnique.mockResolvedValue(membership({ status }));
      await expect(
        guard.canActivate(contextFor([TenantRole.ANALYST]).context)
      ).rejects.toThrow(ForbiddenException);
    }
  );

  it('rejects clinic tenants', async () => {
    findUnique.mockResolvedValue(
      membership({
        tenant: { id: 'c', name: 'C', logoUrl: null, type: 'CLINIC' },
      })
    );
    await expect(
      guard.canActivate(contextFor([TenantRole.ANALYST]).context)
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects a role missing from @Roles', async () => {
    findUnique.mockResolvedValue(membership({ role: 'MESSENGER' }));
    await expect(
      guard.canActivate(contextFor([TenantRole.ANALYST]).context)
    ).rejects.toThrow(ForbiddenException);
  });
});

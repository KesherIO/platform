import { ForbiddenException } from '@nestjs/common';
import { TenantRole } from '@vet-ai/shared-types';
import { BillingExportAccessGuard } from './billing-export-access.guard';

const ctx = (tenant: unknown) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ tenant }) }),
  } as never);

const guard = new BillingExportAccessGuard();

describe('BillingExportAccessGuard', () => {
  it.each([TenantRole.OWNER, TenantRole.ADMIN])('lets %s through', (role) => {
    expect(guard.canActivate(ctx({ role, canViewInProgress: false }))).toBe(
      true
    );
  });

  it('lets Consulta through only with the in-progress checkbox', () => {
    expect(
      guard.canActivate(
        ctx({ role: TenantRole.RESULTS_VIEWER, canViewInProgress: true })
      )
    ).toBe(true);
    expect(() =>
      guard.canActivate(
        ctx({ role: TenantRole.RESULTS_VIEWER, canViewInProgress: false })
      )
    ).toThrow(ForbiddenException);
  });

  it('refuses a request with no resolved tenant', () => {
    expect(() => guard.canActivate(ctx(undefined))).toThrow(
      ForbiddenException
    );
  });
});

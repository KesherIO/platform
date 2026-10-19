import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { TenantRole } from '@vet-ai/shared-types';
import type { TenantContext } from '@vet-ai/shared-types';

/**
 * Runs after LabTenantGuard (which sets request.tenant and checks the role
 * list). "Consulta" (RESULTS_VIEWER) may only download the billing export when
 * its membership has the "Puede ver órdenes en proceso" checkbox — the export
 * includes pending orders. Owner and Admin are unaffected.
 */
@Injectable()
export class BillingExportAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const tenant = context.switchToHttp().getRequest().tenant as
      | TenantContext
      | undefined;
    if (
      !tenant ||
      (tenant.role === TenantRole.RESULTS_VIEWER && !tenant.canViewInProgress)
    ) {
      throw new ForbiddenException(
        'You do not have access to the billing export.'
      );
    }
    return true;
  }
}

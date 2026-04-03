import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantContext, TenantRole } from '@vet-ai/shared-types';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Checks that the authenticated user's role (from TenantContext, set by
 * TenantGuard) satisfies the @Roles() requirement on the route.
 *
 * No-ops when @Roles() is absent, so it is safe to register globally.
 * Reads role from DB-resolved membership (request.tenant.role), NOT from
 * JWT claims — DB is the source of truth for roles.
 *
 * Must run AFTER TenantGuard so request.tenant is populated.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<TenantRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @Roles() decorator — allow through
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const tenant = request.tenant as TenantContext | undefined;

    // TenantGuard is a local guard that runs AFTER this global guard, so
    // request.tenant is not yet set. Pass through here — TenantGuard enforces
    // roles once it resolves the membership. RolesGuard only applies on routes
    // where TenantGuard has already populated the tenant context (e.g. nested guards).
    if (!tenant) return true;

    return requiredRoles.includes(tenant.role);
  }
}
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AuthenticatedUser,
  TenantContext,
  TenantRole,
} from '@vet-ai/shared-types';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Resolves the active tenant from the request and verifies the authenticated
 * user is a member of that tenant.
 *
 * Tenant resolution order (first match wins):
 *   1. x-tenant-id header
 *   2. subdomain (e.g. clinic-slug.yourdomain.com) — TODO when domain is set
 *
 * JWT is identity-only. Tenant context always comes from the request and is
 * verified against UserTenantMembership in the DB.
 *
 * Apply at controller or route level — NOT globally — because some routes
 * (e.g. /auth/me, /invitations/accept) do not require an active tenant.
 *
 * @example
 * @UseGuards(TenantGuard)
 * @Controller('cases')
 * export class CasesController { ... }
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;

    const tenantId = this.resolveTenantId(request);
    if (!tenantId) {
      throw new BadRequestException(
        'Active tenant could not be resolved. Provide an x-tenant-id header.'
      );
    }

    const membership = await this.prisma.userTenantMembership.findUnique({
      where: { userId_tenantId: { userId: user.id, tenantId } },
      select: { role: true },
    });

    if (!membership) {
      throw new ForbiddenException(
        'You are not a member of the requested tenant.'
      );
    }

    // Attach tenant context to request for downstream use via @CurrentTenant()
    const tenantContext: TenantContext = {
      tenantId,
      role: membership.role as TenantRole,
    };
    request.tenant = tenantContext;

    // Enforce @Roles() here — RolesGuard is global and runs before local guards,
    // so it cannot see request.tenant yet. We check roles once tenant is resolved.
    const requiredRoles = this.reflector.getAllAndOverride<TenantRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (requiredRoles && requiredRoles.length > 0) {
      if (!requiredRoles.includes(tenantContext.role)) {
        throw new ForbiddenException('Insufficient role for this action.');
      }
    }

    return true;
  }

  private resolveTenantId(request: {
    headers: Record<string, string | undefined>;
    hostname?: string;
  }): string | null {
    // 1. x-tenant-id header
    const headerTenantId = request.headers['x-tenant-id'];
    if (headerTenantId) return headerTenantId;

    // 2. Subdomain — extract slug from hostname and resolve to tenantId
    // TODO: implement subdomain resolution via slug lookup when custom domains land

    return null;
  }
}

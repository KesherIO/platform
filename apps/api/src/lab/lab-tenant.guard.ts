import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import type {
  AuthenticatedUser,
  MembershipStatus,
  TenantContext,
  TenantRole,
} from '@vet-ai/shared-types';

// In-process cache keyed by "userId:tenantId" (or "userId" for the fallback
// path). Entries are evicted after TTL_MS so role/tenant changes propagate
// within that window without restarting the server.
const TTL_MS = 60_000;
const cache = new Map<string, { value: TenantContext; expiresAt: number }>();

/**
 * Guards lab-only endpoints. Works like TenantGuard but additionally verifies
 * that the resolved tenant has type LAB or PLATFORM — clinic users are rejected
 * even if they somehow know a lab tenant ID.
 */
@Injectable()
export class LabTenantGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;

    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    const cacheKey = tenantId ? `${user.id}:${tenantId}` : user.id;

    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      request.tenant = cached.value;
      return this.checkRoles(cached.value.role as TenantRole, context);
    }

    let membership;

    if (tenantId) {
      membership = await this.prisma.userTenantMembership.findUnique({
        where: { userId_tenantId: { userId: user.id, tenantId } },
        select: {
          role: true,
          canPerformPickups: true,
          tenant: {
            select: { id: true, name: true, logoUrl: true, type: true },
          },
        },
      });
    } else {
      membership = await this.prisma.userTenantMembership.findFirst({
        where: {
          userId: user.id,
          tenant: { type: { in: ['LAB', 'PLATFORM'] } },
        },
        select: {
          role: true,
          canPerformPickups: true,
          tenant: {
            select: { id: true, name: true, logoUrl: true, type: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
    }

    if (!membership) {
      throw new ForbiddenException(
        'You are not a member of any laboratory tenant.'
      );
    }

    if (
      membership.tenant.type !== 'LAB' &&
      membership.tenant.type !== 'PLATFORM'
    ) {
      throw new ForbiddenException(
        'This endpoint is restricted to laboratory tenants.'
      );
    }

    const tenantContext: TenantContext = {
      tenantId: membership.tenant.id,
      tenantName: membership.tenant.name,
      tenantLogoUrl: membership.tenant.logoUrl,
      role: membership.role as TenantRole,
      isOrderingVet: false,
      status: 'ACTIVE' as MembershipStatus,
      canPerformPickups: membership.canPerformPickups,
    };

    cache.set(cacheKey, {
      value: tenantContext,
      expiresAt: Date.now() + TTL_MS,
    });
    request.tenant = tenantContext;

    return this.checkRoles(tenantContext.role as TenantRole, context);
  }

  private checkRoles(role: TenantRole, context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<TenantRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (requiredRoles?.length && !requiredRoles.includes(role)) {
      throw new ForbiddenException(
        'You do not have the required role for this action.'
      );
    }
    return true;
  }
}

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

    // Read on every request, no cache: a role change or removal applies on
    // the next request, on every API instance. One indexed lookup.
    let membership;

    if (tenantId) {
      membership = await this.prisma.userTenantMembership.findUnique({
        where: { userId_tenantId: { userId: user.id, tenantId } },
        select: {
          role: true,
          status: true,
          canPerformPickups: true,
          canViewInProgress: true,
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
          status: true,
          canPerformPickups: true,
          canViewInProgress: true,
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

    if (membership.status !== 'ACTIVE') {
      throw new ForbiddenException(
        'Your membership in this laboratory is not active.'
      );
    }

    const tenantContext: TenantContext = {
      tenantId: membership.tenant.id,
      tenantName: membership.tenant.name,
      tenantLogoUrl: membership.tenant.logoUrl,
      role: membership.role as TenantRole,
      isOrderingVet: false,
      status: membership.status as MembershipStatus,
      canPerformPickups: membership.canPerformPickups,
      canViewInProgress: membership.canViewInProgress,
    };

    request.tenant = tenantContext;

    return this.checkRoles(tenantContext.role as TenantRole, context);
  }

  /**
   * Deny by default: a lab route without @Roles is closed to everyone, so a
   * new route can't be left open to messengers or results viewers by
   * mistake (lab-routes.authz.spec.ts also fails on such a route).
   */
  private checkRoles(role: TenantRole, context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<TenantRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (!requiredRoles?.length || !requiredRoles.includes(role)) {
      throw new ForbiddenException(
        'You do not have the required role for this action.'
      );
    }
    return true;
  }
}

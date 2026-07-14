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
  TenantContext,
  TenantRole,
} from '@vet-ai/shared-types';

/**
 * Guards lab-only endpoints. Works like TenantGuard but additionally verifies
 * that the resolved tenant has type LAB or VETAI — clinic users are rejected
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

    let membership;

    if (tenantId) {
      membership = await this.prisma.userTenantMembership.findUnique({
        where: { userId_tenantId: { userId: user.id, tenantId } },
        select: { role: true, tenant: { select: { id: true, type: true } } },
      });
    } else {
      membership = await this.prisma.userTenantMembership.findFirst({
        where: {
          userId: user.id,
          tenant: { type: { in: ['LAB', 'VETAI'] } },
        },
        select: { role: true, tenant: { select: { id: true, type: true } } },
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
      membership.tenant.type !== 'VETAI'
    ) {
      throw new ForbiddenException(
        'This endpoint is restricted to laboratory tenants.'
      );
    }

    const tenantContext: TenantContext = {
      tenantId: membership.tenant.id,
      role: membership.role as TenantRole,
    };
    request.tenant = tenantContext;

    const requiredRoles = this.reflector.getAllAndOverride<TenantRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (
      requiredRoles?.length &&
      !requiredRoles.includes(membership.role as TenantRole)
    ) {
      throw new ForbiddenException(
        'You do not have the required role for this action.'
      );
    }

    return true;
  }
}

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;

    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) {
      throw new BadRequestException(
        'Active tenant could not be resolved. Provide an x-tenant-id header.'
      );
    }

    const membership = await this.prisma.userTenantMembership.findUnique({
      where: { userId_tenantId: { userId: user.id, tenantId } },
      select: { role: true, tenant: { select: { type: true } } },
    });

    if (!membership) {
      throw new ForbiddenException(
        'You are not a member of the requested tenant.'
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
      tenantId,
      role: membership.role as TenantRole,
    };
    request.tenant = tenantContext;

    return true;
  }
}

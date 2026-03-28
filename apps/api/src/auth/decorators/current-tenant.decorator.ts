import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TenantContext } from '@vet-ai/shared-types';

/**
 * Injects the resolved tenant context (set by TenantGuard) into a
 * controller parameter.
 *
 * @example
 * @Get()
 * @UseGuards(TenantGuard)
 * findAll(@CurrentTenant() tenant: TenantContext) { ... }
 */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    const request = ctx.switchToHttp().getRequest();
    return request.tenant as TenantContext;
  },
);
import { SetMetadata } from '@nestjs/common';
import { TenantRole } from '@vet-ai/shared-types';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to users with one or more of the specified tenant roles.
 * Requires TenantGuard to run first (so tenant context is resolved).
 *
 * @example
 * @Roles(TenantRole.OWNER, TenantRole.ADMIN)
 * @Delete(':id')
 * remove(...) { ... }
 */
export const Roles = (...roles: TenantRole[]) =>
  SetMetadata(ROLES_KEY, roles);
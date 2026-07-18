import { TenantRole } from '@vet-ai/shared-types';

/**
 * Identity bound to an MCP session at initialize() time, from the same
 * request.user/request.tenant the REST lab endpoints trust. Tool handlers
 * close over this — it must never be sourced from tool input.
 */
export interface McpToolContext {
  userId: string;
  tenantId: string;
  tenantName: string;
  role: TenantRole;
}

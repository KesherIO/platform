import { TenantRole } from '@vet-ai/shared-types';

/**
 * Every lab role except MESSENGER: what an endpoint without `@Roles` allowed
 * before LabTenantGuard denied by default (minus messengers). Staff
 * permissions stay as they were until the permission matrix is approved
 * (docs/RESULTS_SEARCH_PLAN.md, PR 2).
 */
export const LAB_STAFF_ROLES = [
  TenantRole.TECHNICIAN,
  TenantRole.ANALYST,
  TenantRole.REVIEWER,
  TenantRole.DATA_ENTRY,
  TenantRole.ADMIN,
  TenantRole.OWNER,
] as const;

/**
 * Staff plus MESSENGER — only for the messenger's pickup workflow: their own
 * session, their assigned pickups and push notifications. The services check
 * the pickup is assigned to the caller.
 */
export const LAB_STAFF_AND_MESSENGER_ROLES = [
  ...LAB_STAFF_ROLES,
  TenantRole.MESSENGER,
] as const;

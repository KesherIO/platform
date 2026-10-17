import { TenantRole } from '@vet-ai/shared-types';

/**
 * Lab roles since the consolidation of 2026-10-15 (docs/LAB_PERMISSION_MATRIX.md):
 * OWNER, ADMIN, REVIEWER, ANALYST, RESULTS_VIEWER, MESSENGER. Lab TECHNICIAN and
 * DATA_ENTRY members were moved to ANALYST; those values remain in the enum for
 * clinic staff and old history rows only.
 *
 * LabTenantGuard denies a route without @Roles, so every lab route lists one
 * of these sets (lab-routes.authz.spec.ts pins them).
 */

/** Lab work: receive, claim, enter results, templates, configuration reads. */
export const LAB_STAFF_ROLES = [
  TenantRole.ANALYST,
  TenantRole.REVIEWER,
  TenantRole.ADMIN,
  TenantRole.OWNER,
] as const;

/**
 * Release and its review actions: approve & release, request corrections,
 * approve amendments. The Analista enters results but doesn't release.
 */
export const LAB_RELEASE_ROLES = [
  TenantRole.REVIEWER,
  TenantRole.ADMIN,
  TenantRole.OWNER,
] as const;

/**
 * Reading released results: staff plus RESULTS_VIEWER ("Consulta"). Released
 * reports, release history and their PDFs (retry included: it only re-renders
 * a failed PDF from the frozen release).
 */
export const LAB_RESULTS_ROLES = [
  ...LAB_STAFF_ROLES,
  TenantRole.RESULTS_VIEWER,
] as const;

/** Roles an Owner/Admin can give on the Team page (OWNER: no transfer yet). */
export const LAB_ASSIGNABLE_ROLES = [
  TenantRole.ADMIN,
  TenantRole.REVIEWER,
  TenantRole.ANALYST,
  TenantRole.RESULTS_VIEWER,
  TenantRole.MESSENGER,
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

/**
 * Every lab member, whatever the role — only for what belongs to the member
 * themself: their notification inbox.
 */
export const LAB_ALL_ROLES = [
  ...LAB_STAFF_AND_MESSENGER_ROLES,
  TenantRole.RESULTS_VIEWER,
] as const;

/**
 * Matches the Prisma TenantRole enum.
 * Keep in sync with apps/api/prisma/schema.prisma.
 */
export enum TenantRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  VET = 'VET',
  TECHNICIAN = 'TECHNICIAN',
  RECEPTIONIST = 'RECEPTIONIST',
  MESSENGER = 'MESSENGER',
  ANALYST = 'ANALYST',
  REVIEWER = 'REVIEWER',
  DATA_ENTRY = 'DATA_ENTRY',
}

/**
 * Per-clinic access state for a user's membership.
 * Matches the Prisma MembershipStatus enum.
 */
export enum MembershipStatus {
  INVITED = 'INVITED',
  PROFILE_REQUIRED = 'PROFILE_REQUIRED',
  VERIFICATION_PENDING = 'VERIFICATION_PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}

/**
 * Shape of a decoded Supabase JWT.
 * `sub` is the Supabase Auth user UUID — this becomes User.id in our DB.
 */
export interface JwtPayload {
  sub: string; // Supabase Auth UUID
  email: string;
  role: string; // Supabase role ("authenticated")
  aud: string;
  exp: number;
  iat: number;
  user_metadata?: {
    first_name?: string;
    last_name?: string;
    avatar_url?: string;
  };
  app_metadata?: Record<string, unknown>;
}

/**
 * The resolved, authenticated context attached to every guarded request.
 * Populated by JwtAuthGuard (user) + TenantGuard (tenant + role).
 */
export interface AuthenticatedUser {
  id: string; // Supabase Auth UUID = local User.id
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}

export interface TenantContext {
  tenantId: string;
  tenantName: string;
  tenantLogoUrl: string | null;
  role: TenantRole;
  isOrderingVet: boolean;
  status: MembershipStatus;
  canPerformPickups: boolean;
}

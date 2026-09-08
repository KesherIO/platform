import {
  Injectable,
  InternalServerErrorException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, JwtPayload } from '@vet-ai/shared-types';

@Injectable()
export class AuthService {
  private readonly supabaseAdmin: SupabaseClient;

  constructor(private readonly prisma: PrismaService, config: ConfigService) {
    this.supabaseAdmin = createClient(
      config.getOrThrow<string>('SUPABASE_URL'),
      // Service-role key required for Admin API (bypasses RLS and email confirmation)
      config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY')
    );
  }

  /**
   * Creates a new Supabase Auth user using the Admin API.
   * Sets email_confirm: true so the user can log in immediately without
   * needing to verify their email — they were already invited by KesherIO.
   *
   * Returns the new Supabase user UUID (becomes User.id in our DB).
   */
  async createSupabaseUser(
    email: string,
    password: string,
    firstName: string,
    lastName: string
  ): Promise<string> {
    const { data, error } = await this.supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
      },
    });

    if (error || !data.user) {
      const msg = error?.message ?? 'unknown error';
      if (msg.toLowerCase().includes('already been registered')) {
        throw new ConflictException(
          'A user with this email address already exists'
        );
      }
      throw new InternalServerErrorException(
        `Failed to create Supabase user: ${msg}`
      );
    }

    return data.user.id;
  }

  /**
   * Deletes a Supabase Auth user by ID using the Admin API.
   * Called as compensating cleanup when the Prisma transaction fails after
   * a Supabase user was already created (prevents orphaned auth accounts).
   * Errors are logged but not re-thrown — the original error is surfaced instead.
   */
  async deleteSupabaseUser(userId: string): Promise<void> {
    const { error } = await this.supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      console.error(
        'Supabase admin deleteUser error (cleanup):',
        error.message
      );
    }
  }

  /**
   * Invalidates all active sessions for the user via the Supabase Admin API.
   * Called by POST /auth/sign-out. The client also clears local storage via
   * supabase.auth.signOut() — both sides need to run for a clean sign-out.
   */
  async signOut(userId: string): Promise<void> {
    const { error } = await this.supabaseAdmin.auth.admin.signOut(userId);
    if (error) {
      // Non-fatal — the client-side sign-out already cleared the token.
      // Log and continue rather than returning a 500 to the user.
      console.error('Supabase admin signOut error:', error.message);
    }
  }

  /**
   * Upserts a local User row from the verified Supabase JWT payload.
   * Called by JwtStrategy.validate on every authenticated request.
   *
   * Source of truth for identity: Supabase Auth (sub, email).
   * Source of truth for app-specific data: local User row.
   *
   * We only sync identity fields (email). App-specific fields (firstName,
   * lastName) are updated by the onboarding flow, not here.
   */
  async upsertUserFromJwt(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.upsert({
      where: { id: payload.sub },
      create: {
        id: payload.sub,
        email: payload.email,
        firstName: payload.user_metadata?.first_name ?? null,
        lastName: payload.user_metadata?.last_name ?? null,
      },
      update: {
        // Email can change in Supabase Auth — keep it in sync
        email: payload.email,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
      },
    });

    return user;
  }

  /**
   * Returns the full user profile with CLINIC tenant memberships only.
   * Used by the /auth/me endpoint — apps/frontend is clinic-only, so any
   * LAB/PLATFORM memberships the user also happens to hold are filtered out
   * here. Otherwise a lab-only account would be shown a lab tenant as if it
   * were their clinic (see LabTenantGuard for the mirrored check on the lab side).
   *
   * onboardingCompleted: true when the user has at least one CLINIC membership
   *   AND that tenant has a name set (clinic-setup was completed).
   * activeTenantId: the first CLINIC tenant the user belongs to, or null if none yet.
   */
  async updateMe(
    userId: string,
    data: { firstName?: string; lastName?: string; phone?: string }
  ) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.firstName !== undefined && { firstName: data.firstName }),
        ...(data.lastName !== undefined && { lastName: data.lastName }),
        ...(data.phone !== undefined && { phone: data.phone || null }),
      },
    });
    return this.getMe(userId);
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        createdAt: true,
        veterinarianProfile: { select: { id: true } },
        memberships: {
          select: {
            role: true,
            status: true,
            isOrderingVet: true,
            createdAt: true,
            tenant: {
              select: {
                id: true,
                name: true,
                slug: true,
                type: true,
                email: true,
                phone: true,
                address: true,
                logoUrl: true,
                primaryColor: true,
                labConnections: {
                  where: { isActive: true },
                  select: { labId: true },
                  take: 1,
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    const clinicMemberships = user.memberships.filter(
      (m) => m.tenant.type === 'CLINIC'
    );

    // Batch-fetch vet verifications for ordering-vet memberships (avoids N+1)
    const verificationsByLabId = new Map<
      string,
      { status: string; rejectionReason: string | null }
    >();
    if (user.veterinarianProfile) {
      const labIds = clinicMemberships
        .filter((m) => m.isOrderingVet)
        .flatMap((m) => m.tenant.labConnections.map((c) => c.labId));

      if (labIds.length > 0) {
        const verifications = await this.prisma.vetLabVerification.findMany({
          where: {
            vetProfileId: user.veterinarianProfile.id,
            labTenantId: { in: labIds },
          },
          select: { labTenantId: true, status: true, rejectionReason: true },
        });
        for (const v of verifications) {
          verificationsByLabId.set(v.labTenantId, v);
        }
      }
    }

    const memberships = clinicMemberships.map((m) => {
      const labId = m.tenant.labConnections[0]?.labId ?? null;
      const verification = labId
        ? verificationsByLabId.get(labId) ?? null
        : null;
      const { labConnections, ...tenant } = m.tenant;
      return {
        role: m.role,
        status: m.status,
        isOrderingVet: m.isOrderingVet,
        createdAt: m.createdAt,
        tenant,
        vetVerification: m.isOrderingVet
          ? verification
            ? {
                status: verification.status,
                rejectionReason: verification.rejectionReason,
              }
            : null
          : null,
      };
    });

    const tenants = memberships.map((m) => m.tenant);
    const activeMembership = memberships[0];

    // onboardingCompleted: true iff the first CLINIC membership is ACTIVE.
    // Existing memberships were backfilled to ACTIVE on migration, so this
    // is backward compatible.
    const onboardingCompleted = activeMembership?.status === 'ACTIVE';

    const activeTenantId = tenants[0]?.id ?? null;

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        createdAt: user.createdAt,
      },
      memberships,
      tenants,
      onboardingCompleted,
      activeTenantId,
    };
  }
}

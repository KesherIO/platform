import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, JwtPayload } from '@vet-ai/shared-types';

@Injectable()
export class AuthService {
  private readonly supabaseAdmin: SupabaseClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.supabaseAdmin = createClient(
      config.getOrThrow<string>('SUPABASE_URL'),
      // Service-role key required for Admin API (bypasses RLS and email confirmation)
      config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
    );
  }

  /**
   * Creates a new Supabase Auth user using the Admin API.
   * Sets email_confirm: true so the user can log in immediately without
   * needing to verify their email — they were already invited by Biomet.
   *
   * Returns the new Supabase user UUID (becomes User.id in our DB).
   */
  async createSupabaseUser(
    email: string,
    password: string,
    firstName: string,
    lastName: string,
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
      throw new InternalServerErrorException(
        `Failed to create Supabase user: ${error?.message ?? 'unknown error'}`,
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
      console.error('Supabase admin deleteUser error (cleanup):', error.message);
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
   * Returns the full user profile with all tenant memberships.
   * Used by the /auth/me endpoint.
   *
   * onboardingCompleted: true when the user has at least one tenant membership
   *   AND that tenant has a name set (clinic-setup was completed).
   * activeTenantId: the first tenant the user belongs to, or null if none yet.
   */
  async getMe(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        createdAt: true,
        memberships: {
          select: {
            role: true,
            createdAt: true,
            tenant: {
              select: {
                id: true,
                name: true,
                slug: true,
                logoUrl: true,
                primaryColor: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    const tenants = user.memberships.map((m) => m.tenant);

    // Onboarding is complete when the user belongs to a tenant AND the tenant
    // has a real name (i.e. the clinic-setup step was finished).
    const onboardingCompleted =
      user.memberships.length > 0 &&
      !!user.firstName &&
      tenants[0]?.name != null;

    // The active tenant is the earliest one the user joined.
    const activeTenantId = tenants[0]?.id ?? null;

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        createdAt: user.createdAt,
      },
      memberships: user.memberships,
      tenants,
      onboardingCompleted,
      activeTenantId,
    };
  }
}
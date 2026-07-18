import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { StorageService } from '../storage/storage.service';
import { TenantRole } from '@prisma/client';
import { randomBytes, randomUUID } from 'crypto';
import {
  SaveStaffProfileDto,
  GenerateInviteDto,
  CreateAdminLinkDto,
  CompleteAdminOnboardingDto,
  CompleteStaffOnboardingDto,
} from './dto/onboarding.dto';

/** Derive a URL-safe slug from a clinic name. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly storageService: StorageService
  ) {}

  // ---------------------------------------------------------------------------
  // Public: branding for welcome screen (before user is authenticated)
  // ---------------------------------------------------------------------------

  async getBranding(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        primaryColor: true,
      },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      logoUrl: tenant.logoUrl ?? null,
      primaryColor: tenant.primaryColor ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // Staff profile — upsert User + create membership + mark invite accepted
  // ---------------------------------------------------------------------------

  async saveStaffProfile(
    userId: string,
    tenantId: string,
    token: string,
    dto: SaveStaffProfileDto
  ) {
    // Verify invite token
    const invite = await this.prisma.tenantInvitation.findUnique({
      where: { token },
    });

    if (!invite) {
      throw new NotFoundException('Invitation not found');
    }
    if (invite.tenantId !== tenantId) {
      throw new BadRequestException('Token does not belong to this tenant');
    }
    if (invite.acceptedAt) {
      throw new BadRequestException('Invitation has already been accepted');
    }
    if (invite.expiresAt < new Date()) {
      throw new BadRequestException('Invitation has expired');
    }

    // Rule: user must not already be an active member of this clinic.
    // This guards against someone using a link after they were already added via another path.
    const existingMembership =
      await this.prisma.userTenantMembership.findUnique({
        where: { userId_tenantId: { userId, tenantId } },
      });
    if (existingMembership) {
      throw new ConflictException('You are already a member of this clinic.');
    }

    const roleMap: Record<string, TenantRole> = {
      admin: TenantRole.ADMIN,
      staff: TenantRole.VET,
    };
    const tenantRole = roleMap[dto.role];

    if (!tenantRole) {
      throw new BadRequestException(`Unknown role: ${dto.role}`);
    }

    const [firstName, ...rest] = dto.fullName.trim().split(' ');
    const lastName = rest.join(' ') || null;

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { firstName, lastName },
      }),
      this.prisma.userTenantMembership.create({
        data: {
          userId,
          tenantId,
          role: tenantRole,
        },
      }),
      this.prisma.tenantInvitation.update({
        where: { token },
        data: { acceptedAt: new Date() },
      }),
    ]);

    return { userId };
  }

  // ---------------------------------------------------------------------------
  // Generate invite token — creates a TenantInvitation row
  //
  // Guardrails (MVP):
  //   1. One pending invite per email per clinic (email-specific invites only)
  //   2. Invitations expire after 7 days (enforced at creation and acceptance)
  //   3. Max 10 pending invites per clinic at any time
  //   4. Cannot invite an email that already has an active membership in this clinic
  //   5. checkTenantCapacity() is the extension point for future plan-based limits
  // ---------------------------------------------------------------------------

  async generateInvite(
    invitedByUserId: string,
    tenantId: string,
    dto: GenerateInviteDto
  ) {
    const now = new Date();
    const email = dto.email?.trim().toLowerCase() ?? '';

    // ── Email-specific guardrails (only when an email is provided) ────────────
    if (email) {
      // Rule 4: Reject if this email is already an active member of the clinic.
      const activeMember = await this.prisma.userTenantMembership.findFirst({
        where: {
          tenantId,
          user: { email },
        },
      });
      if (activeMember) {
        throw new ConflictException(
          'This user is already an active member of this clinic.'
        );
      }

      // Rule 1: Return the existing pending invite rather than creating a duplicate.
      // A pending invite is one that has not been accepted and has not yet expired.
      const pendingInvite = await this.prisma.tenantInvitation.findFirst({
        where: {
          tenantId,
          email,
          acceptedAt: null,
          expiresAt: { gt: now },
        },
      });
      if (pendingInvite) {
        return {
          token: pendingInvite.token,
          tenantId: pendingInvite.tenantId,
          expiresAt: pendingInvite.expiresAt,
          alreadyExists: true,
        };
      }
    }

    // ── Rule 3: Enforce pending-invite cap before creating a new one ──────────
    await this.checkTenantCapacity(tenantId, now);

    // ── Create the invitation ─────────────────────────────────────────────────
    const tenantRole = dto.role === 'admin' ? TenantRole.ADMIN : TenantRole.VET;

    // Rule 2: token expires after exactly 7 days.
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const token = randomUUID();

    const invitation = await this.prisma.tenantInvitation.create({
      data: {
        tenantId,
        email, // empty string for generic (anyone-can-use) magic links
        role: tenantRole,
        token,
        expiresAt,
        invitedByUserId,
      },
    });

    return {
      token: invitation.token,
      tenantId: invitation.tenantId,
      expiresAt: invitation.expiresAt,
      alreadyExists: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Tenant capacity check — single extension point for all invite/plan limits.
  //
  // Rule 3 (MVP): cap pending invitations at 10 per clinic.
  // Rule 5 (future): add plan-based active-user limits here when billing is ready.
  // ---------------------------------------------------------------------------

  private async checkTenantCapacity(
    tenantId: string,
    now: Date
  ): Promise<void> {
    const PENDING_INVITE_CAP = 10;

    const pendingCount = await this.prisma.tenantInvitation.count({
      where: {
        tenantId,
        acceptedAt: null,
        expiresAt: { gt: now },
      },
    });

    if (pendingCount >= PENDING_INVITE_CAP) {
      throw new BadRequestException(
        `This clinic has reached the maximum of ${PENDING_INVITE_CAP} pending invitations. ` +
          'Resend or wait for existing invites to expire before creating new ones.'
      );
    }

    // ── Future: plan-based active-user limit ──────────────────────────────────
    // Uncomment and adapt once billing / plan tiers are in place:
    //
    // const plan = await this.billingService.getPlan(tenantId);
    // const activeMembers = await this.prisma.userTenantMembership.count({ where: { tenantId } });
    // if (activeMembers >= plan.maxActiveUsers) {
    //   throw new BadRequestException(
    //     `Your current plan allows up to ${plan.maxActiveUsers} active users. ` +
    //     'Upgrade your plan to invite more staff.',
    //   );
    // }
  }

  // ---------------------------------------------------------------------------
  // Verify invite token — used by StaffProfileComponent before showing form
  // ---------------------------------------------------------------------------

  async verifyInvite(token: string) {
    const invite = await this.prisma.tenantInvitation.findUnique({
      where: { token },
      include: {
        tenant: {
          select: { id: true, name: true, logoUrl: true, primaryColor: true },
        },
      },
    });

    if (!invite) {
      throw new NotFoundException('Invitation not found');
    }
    if (invite.acceptedAt) {
      throw new BadRequestException('Invitation has already been accepted');
    }
    if (invite.expiresAt < new Date()) {
      throw new BadRequestException('Invitation has expired');
    }

    // Check whether the invited email already has a User record (re-invite path).
    const userExists = invite.email
      ? !!(await this.prisma.user.findUnique({
          where: { email: invite.email },
        }))
      : false;

    // Map internal TenantRole to the user-facing 'admin' | 'staff' value.
    const role: 'admin' | 'staff' =
      invite.role === TenantRole.ADMIN || invite.role === TenantRole.OWNER
        ? 'admin'
        : 'staff';

    return {
      tenantId: invite.tenantId,
      tenantName: invite.tenant.name,
      logoUrl: invite.tenant.logoUrl ?? null,
      primaryColor: invite.tenant.primaryColor ?? null,
      email: invite.email,
      role,
      userExists,
      expiresAt: invite.expiresAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Complete staff onboarding — public, token is the only credential.
  // Creates: Supabase user (email pre-confirmed) → User row → membership.
  // After this returns, the frontend signs in with signInWithPassword().
  // ---------------------------------------------------------------------------

  async completeStaffOnboarding(dto: CompleteStaffOnboardingDto) {
    const email = dto.email.trim().toLowerCase();

    // 1. Verify invite token
    const invite = await this.prisma.tenantInvitation.findUnique({
      where: { token: dto.token },
    });

    if (!invite) {
      throw new NotFoundException('Invitation not found');
    }
    if (invite.acceptedAt) {
      throw new BadRequestException('Invitation has already been accepted');
    }
    if (invite.expiresAt < new Date()) {
      throw new BadRequestException('Invitation has expired');
    }

    const roleMap: Record<string, TenantRole> = {
      admin: TenantRole.ADMIN,
      staff: TenantRole.VET,
    };
    const tenantRole = roleMap[dto.role];
    if (!tenantRole) {
      throw new BadRequestException(`Unknown role: ${dto.role}`);
    }

    const [firstName, ...rest] = (dto.fullName ?? '').trim().split(' ');
    const lastName = rest.join(' ') || null;

    // 2. Re-invite path — user already exists (previously removed from clinic).
    //    Skip Supabase + User creation; just add the membership back.
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      const existingMembership =
        await this.prisma.userTenantMembership.findUnique({
          where: {
            userId_tenantId: {
              userId: existingUser.id,
              tenantId: invite.tenantId,
            },
          },
        });
      if (existingMembership) {
        throw new ConflictException('User is already a member of this clinic.');
      }

      await this.prisma.$transaction([
        this.prisma.userTenantMembership.create({
          data: {
            userId: existingUser.id,
            tenantId: invite.tenantId,
            role: tenantRole,
          },
        }),
        this.prisma.tenantInvitation.update({
          where: { token: dto.token },
          data: { acceptedAt: new Date() },
        }),
      ]);

      return { userId: existingUser.id };
    }

    // 3. New user — fullName and password are required.
    if (!dto.fullName || !dto.password) {
      throw new BadRequestException(
        'fullName and password are required for new users.'
      );
    }

    const supabaseUserId = await this.authService.createSupabaseUser(
      email,
      dto.password,
      firstName,
      lastName ?? ''
    );

    await this.prisma.$transaction([
      this.prisma.user.create({
        data: {
          id: supabaseUserId,
          email,
          firstName,
          lastName,
        },
      }),
      this.prisma.userTenantMembership.create({
        data: {
          userId: supabaseUserId,
          tenantId: invite.tenantId,
          role: tenantRole,
        },
      }),
      this.prisma.tenantInvitation.update({
        where: { token: dto.token },
        data: { acceptedAt: new Date() },
      }),
    ]);

    return { userId: supabaseUserId };
  }

  // ---------------------------------------------------------------------------
  // Create admin onboarding link — called by KesherIO to invite a clinic admin.
  // Generates a secure random token, stores it, returns the onboarding link.
  // TODO: protect this endpoint with an internal API key before going to prod.
  // ---------------------------------------------------------------------------

  async createAdminLink(dto: CreateAdminLinkDto) {
    // 256-bit random token encoded as hex (64 chars) — cryptographically secure
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.prisma.onboardingToken.create({
      data: {
        token,
        type: 'ADMIN',
        clinicName: dto.clinicName,
        clinicEmail: dto.clinicEmail,
        externalClinicId: dto.externalClinicId ?? null,
        expiresAt,
      },
    });

    return {
      token,
      onboardingLink: `/onboarding/welcome?token=${token}`,
    };
  }

  // ---------------------------------------------------------------------------
  // Verify onboarding token — public, called by the frontend on page load.
  // Returns prefilled data if valid; never throws — always returns { valid }.
  // ---------------------------------------------------------------------------

  async verifyOnboardingToken(token: string) {
    const record = await this.prisma.onboardingToken.findUnique({
      where: { token },
    });

    if (!record) {
      return { valid: false as const, reason: 'not_found' as const };
    }

    if (record.used) {
      return { valid: false as const, reason: 'used' as const };
    }

    if (record.expiresAt < new Date()) {
      return { valid: false as const, reason: 'expired' as const };
    }

    return {
      valid: true as const,
      type: record.type,
      clinicName: record.clinicName,
      clinicEmail: record.clinicEmail,
    };
  }

  // ---------------------------------------------------------------------------
  // Complete admin onboarding — public endpoint, token is the only credential.
  // Creates: Supabase user → local User row → Tenant → ADMIN membership.
  // Marks the token as used atomically with the DB writes.
  // ---------------------------------------------------------------------------

  async completeAdminOnboarding(
    dto: CompleteAdminOnboardingDto,
    logoFile?: Express.Multer.File
  ) {
    // 1. Verify token (fail fast before any external calls)
    const record = await this.prisma.onboardingToken.findUnique({
      where: { token: dto.token },
    });

    if (!record) {
      throw new NotFoundException('Onboarding token not found');
    }
    if (record.used) {
      throw new ConflictException('This onboarding link has already been used');
    }
    if (record.expiresAt < new Date()) {
      throw new BadRequestException('This onboarding link has expired');
    }

    // 2. Create the Supabase Auth user — fail fast before any DB writes.
    const supabaseUserId = await this.authService.createSupabaseUser(
      dto.adminEmail,
      dto.password,
      dto.adminFirstName,
      dto.adminLastName
    );

    // 3. Create Tenant + User row + ADMIN membership + mark token used — all in one transaction.
    //    If anything below fails, delete the Supabase user so it does not become an orphan.
    let slug = slugify(dto.clinicName);
    let tenantId: string;
    let userId: string;

    try {
      const slugConflict = await this.prisma.tenant.findFirst({
        where: { slug },
        select: { id: true },
      });
      if (slugConflict) {
        slug = `${slug}-${randomUUID().slice(0, 6)}`;
      }

      ({ tenantId, userId } = await this.prisma.$transaction(async (tx) => {
        // Create the Tenant — clinicEmail is the clinic contact address (not the login email)
        const tenant = await tx.tenant.create({
          data: {
            name: dto.clinicName,
            slug,
            address: dto.clinicAddress,
            city: dto.clinicCity,
            email: dto.clinicEmail,
            phone: dto.clinicPhone,
            notificationMethod: dto.notificationMethod,
            ...(dto.country ? { country: dto.country } : {}),
          },
        });

        // Create the local User row
        await tx.user.create({
          data: {
            id: supabaseUserId,
            email: dto.adminEmail,
            firstName: dto.adminFirstName,
            lastName: dto.adminLastName,
          },
        });

        // Create ADMIN membership
        await tx.userTenantMembership.create({
          data: {
            userId: supabaseUserId,
            tenantId: tenant.id,
            role: TenantRole.ADMIN,
          },
        });

        // Mark token as used
        await tx.onboardingToken.update({
          where: { token: dto.token },
          data: { used: true, usedAt: new Date() },
        });

        return { tenantId: tenant.id, userId: supabaseUserId };
      }));
    } catch (err) {
      // Compensating cleanup: remove the Supabase user that was created before
      // the transaction so it does not become an orphaned auth account.
      await this.authService.deleteSupabaseUser(supabaseUserId);
      throw err;
    }

    // 4. Upload logo now that we have a stable tenantId.
    //    Path: clinic-logos/{tenantId}/logo.{ext}
    //    Done outside the transaction — a failed upload is non-fatal; the
    //    tenant is already created and the admin can re-upload from settings.
    if (logoFile) {
      try {
        const logoUrl = await this.storageService.uploadClinicLogo(
          tenantId,
          logoFile
        );
        await this.prisma.tenant.update({
          where: { id: tenantId },
          data: { logoUrl },
        });
      } catch {
        return {
          tenantId,
          userId,
          logoUploadFailed: true as const,
          message:
            'Account created successfully, but logo upload failed. You can upload your logo later from Settings.',
        };
      }
    }

    return { tenantId, userId };
  }
}

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
import { randomBytes, randomUUID, createHash } from 'crypto';
import {
  SaveStaffProfileDto,
  GenerateInviteDto,
  CreateAdminLinkDto,
  CompleteAdminOnboardingDto,
  CompleteStaffOnboardingDto,
  CreateLabLinkDto,
  CompleteLabOnboardingDto,
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

  /**
   * Returns the membership status to assign when a VET joins a clinic.
   *
   * When userId is provided (existing user), checks whether they already have
   * a VeterinarianProfile and/or an approved VetLabVerification at the
   * clinic's connected lab — so they aren't forced back through onboarding.
   */
  private async vetMembershipStatus(
    tenantId: string,
    userId?: string,
    client?: Pick<
      PrismaService,
      | 'clinicLabConnection'
      | 'veterinarianProfile'
      | 'vetLabVerification'
      | 'veterinarianCredential'
    >
  ): Promise<{
    status: 'PROFILE_REQUIRED' | 'VERIFICATION_PENDING' | 'ACTIVE';
    autoSubmit?: {
      vetProfileId: string;
      labTenantId: string;
      credentialId: string;
    };
  }> {
    const db = client ?? this.prisma;

    const connection = await db.clinicLabConnection.findFirst({
      where: { clinicId: tenantId, isActive: true },
      include: {
        lab: {
          include: {
            laboratoryProfile: { select: { vetVerificationRequired: true } },
          },
        },
      },
    });

    if (!connection?.lab?.laboratoryProfile?.vetVerificationRequired) {
      return { status: 'ACTIVE' };
    }

    if (!userId) {
      return { status: 'PROFILE_REQUIRED' };
    }

    const profile = await db.veterinarianProfile.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!profile) {
      return { status: 'PROFILE_REQUIRED' };
    }

    const verification = await db.vetLabVerification.findUnique({
      where: {
        vetProfileId_labTenantId: {
          vetProfileId: profile.id,
          labTenantId: connection.labId,
        },
      },
      select: { status: true },
    });

    if (verification?.status === 'APPROVED') {
      return { status: 'ACTIVE' };
    }

    if (verification) {
      return { status: 'VERIFICATION_PENDING' };
    }

    // No verification record at this lab — auto-submit if active credential exists
    const credential = await db.veterinarianCredential.findFirst({
      where: { veterinarianProfileId: profile.id, replacedAt: null },
      select: { id: true },
    });

    return {
      status: 'VERIFICATION_PENDING',
      ...(credential && {
        autoSubmit: {
          vetProfileId: profile.id,
          labTenantId: connection.labId,
          credentialId: credential.id,
        },
      }),
    };
  }

  private async autoSubmitVerification(
    vetProfileId: string,
    labTenantId: string,
    clinicTenantId: string,
    userId: string,
    credentialId: string
  ) {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const v = await tx.vetLabVerification.create({
        data: {
          vetProfileId,
          labTenantId,
          initiatingClinicId: clinicTenantId,
          status: 'PENDING',
          submittedAt: now,
        },
      });
      await tx.vetVerificationEvent.create({
        data: {
          verificationId: v.id,
          eventType: 'SUBMITTED',
          actorId: userId,
          credentialVersionId: credentialId,
        },
      });
    });
  }

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
      vet: TenantRole.VET,
      technician: TenantRole.TECHNICIAN,
      receptionist: TenantRole.RECEPTIONIST,
    };
    const tenantRole = roleMap[dto.role];

    if (!tenantRole) {
      throw new BadRequestException(`Unknown role: ${dto.role}`);
    }

    const [firstName, ...rest] = dto.fullName.trim().split(' ');
    const lastName = rest.join(' ') || null;

    const vetResult =
      tenantRole === TenantRole.VET
        ? await this.vetMembershipStatus(tenantId, userId)
        : null;

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
          ...(vetResult
            ? { isOrderingVet: true, status: vetResult.status }
            : {}),
        },
      }),
      this.prisma.tenantInvitation.update({
        where: { token },
        data: { acceptedAt: new Date() },
      }),
    ]);

    if (vetResult?.autoSubmit) {
      await this.autoSubmitVerification(
        vetResult.autoSubmit.vetProfileId,
        vetResult.autoSubmit.labTenantId,
        tenantId,
        userId,
        vetResult.autoSubmit.credentialId
      );
    }

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
    const inviteRoleMap: Record<string, TenantRole> = {
      admin: TenantRole.ADMIN,
      vet: TenantRole.VET,
      technician: TenantRole.TECHNICIAN,
      receptionist: TenantRole.RECEPTIONIST,
    };
    const tenantRole = inviteRoleMap[dto.role ?? 'vet'] ?? TenantRole.VET;

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

    // Map internal TenantRole to the user-facing role string.
    const roleMap: Record<
      string,
      'admin' | 'vet' | 'technician' | 'receptionist'
    > = {
      [TenantRole.ADMIN]: 'admin',
      [TenantRole.OWNER]: 'admin',
      [TenantRole.VET]: 'vet',
      [TenantRole.TECHNICIAN]: 'technician',
      [TenantRole.RECEPTIONIST]: 'receptionist',
    };
    const role = roleMap[invite.role] ?? 'vet';

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
      vet: TenantRole.VET,
      technician: TenantRole.TECHNICIAN,
      receptionist: TenantRole.RECEPTIONIST,
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

      const vetResult =
        tenantRole === TenantRole.VET
          ? await this.vetMembershipStatus(invite.tenantId, existingUser.id)
          : null;

      await this.prisma.$transaction([
        this.prisma.userTenantMembership.create({
          data: {
            userId: existingUser.id,
            tenantId: invite.tenantId,
            role: tenantRole,
            ...(vetResult
              ? { isOrderingVet: true, status: vetResult.status }
              : {}),
          },
        }),
        this.prisma.tenantInvitation.update({
          where: { token: dto.token },
          data: { acceptedAt: new Date() },
        }),
      ]);

      if (vetResult?.autoSubmit) {
        await this.autoSubmitVerification(
          vetResult.autoSubmit.vetProfileId,
          vetResult.autoSubmit.labTenantId,
          invite.tenantId,
          existingUser.id,
          vetResult.autoSubmit.credentialId
        );
      }

      return { userId: existingUser.id, tenantId: invite.tenantId };
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

    const vetResult =
      tenantRole === TenantRole.VET
        ? await this.vetMembershipStatus(invite.tenantId)
        : null;

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
          ...(vetResult
            ? { isOrderingVet: true, status: vetResult.status }
            : {}),
        },
      }),
      this.prisma.tenantInvitation.update({
        where: { token: dto.token },
        data: { acceptedAt: new Date() },
      }),
    ]);

    return { userId: supabaseUserId, tenantId: invite.tenantId };
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
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const record =
      (await this.prisma.onboardingToken.findFirst({
        where: { tokenHash },
      })) ??
      (await this.prisma.onboardingToken.findUnique({
        where: { token },
      }));

    if (!record) {
      return { valid: false as const, reason: 'not_found' as const };
    }

    if (record.used) {
      return { valid: false as const, reason: 'used' as const };
    }

    if (record.revokedAt) {
      return { valid: false as const, reason: 'revoked' as const };
    }

    if (record.expiresAt < new Date()) {
      return { valid: false as const, reason: 'expired' as const };
    }

    if (record.type === 'LAB_ADMIN') {
      return {
        valid: true as const,
        type: record.type,
        labName: record.labName,
        labEmail: record.labEmail,
      };
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
    const tokenHash = createHash('sha256').update(dto.token).digest('hex');
    const record =
      (await this.prisma.onboardingToken.findFirst({
        where: { tokenHash },
      })) ??
      (await this.prisma.onboardingToken.findUnique({
        where: { token: dto.token },
      }));

    if (!record) {
      throw new NotFoundException('Onboarding token not found');
    }
    if (record.used) {
      throw new ConflictException('This onboarding link has already been used');
    }
    if (record.revokedAt) {
      throw new BadRequestException('This onboarding link has been revoked');
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
    let vetResult: Awaited<ReturnType<typeof this.vetMembershipStatus>> | null =
      null;

    try {
      const slugConflict = await this.prisma.tenant.findFirst({
        where: { slug },
        select: { id: true },
      });
      if (slugConflict) {
        slug = `${slug}-${randomUUID().slice(0, 6)}`;
      }

      const txResult = await this.prisma.$transaction(async (tx) => {
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
            clientType: record.clientType ?? undefined,
            clientStatus: 'ACTIVE',
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

        // Mark token as used
        await tx.onboardingToken.update({
          where: { id: record.id },
          data: { used: true, usedAt: new Date() },
        });

        // Create lab connection if this invitation was created by a lab
        if (record.laboratoryId) {
          await tx.clinicLabConnection.create({
            data: {
              clinicId: tenant.id,
              labId: record.laboratoryId,
              isDefault: true,
              isActive: true,
            },
          });
        }

        // Create ADMIN membership — if the admin is also a vet, check
        // whether the connected lab requires verification.
        // Must run after ClinicLabConnection is created so the lookup works.
        const isVet = dto.isVet === true;
        const vetResult = isVet
          ? await this.vetMembershipStatus(tenant.id, undefined, tx)
          : null;

        await tx.userTenantMembership.create({
          data: {
            userId: supabaseUserId,
            tenantId: tenant.id,
            role: TenantRole.ADMIN,
            ...(vetResult
              ? { isOrderingVet: true, status: vetResult.status }
              : {}),
          },
        });

        return {
          tenantId: tenant.id,
          userId: supabaseUserId,
          vetResult,
        };
      });
      ({ tenantId, userId, vetResult } = txResult);
    } catch (err) {
      // Compensating cleanup: remove the Supabase user that was created before
      // the transaction so it does not become an orphaned auth account.
      await this.authService.deleteSupabaseUser(supabaseUserId);
      throw err;
    }

    // Auto-submit vet verification if the admin is a vet with existing credentials
    if (vetResult?.autoSubmit) {
      await this.autoSubmitVerification(
        vetResult.autoSubmit.vetProfileId,
        vetResult.autoSubmit.labTenantId,
        tenantId,
        userId,
        vetResult.autoSubmit.credentialId
      );
    }

    const membershipStatus = vetResult?.status;

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
          membershipStatus,
        };
      }
    }

    return { tenantId, userId, membershipStatus };
  }

  // ---------------------------------------------------------------------------
  // Create lab onboarding link — called internally to invite a lab admin.
  // Generates a secure random token, stores it, returns the onboarding link.
  // ---------------------------------------------------------------------------

  async createLabLink(dto: CreateLabLinkDto) {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.onboardingToken.create({
      data: {
        token,
        type: 'LAB_ADMIN',
        clinicName: '',
        clinicEmail: '',
        labName: dto.labName,
        labEmail: dto.labEmail,
        expiresAt,
      },
    });

    return {
      token,
      onboardingLink: `/onboarding/welcome?token=${token}`,
    };
  }

  // ---------------------------------------------------------------------------
  // Complete lab onboarding — public endpoint, token is the only credential.
  // Creates: Supabase user → Tenant(LAB) → LaboratoryProfile → User → ADMIN membership.
  // ---------------------------------------------------------------------------

  async completeLabOnboarding(dto: CompleteLabOnboardingDto) {
    // 1. Verify token (fail fast before any external calls)
    const tokenHash = createHash('sha256').update(dto.token).digest('hex');
    const record =
      (await this.prisma.onboardingToken.findFirst({
        where: { tokenHash },
      })) ??
      (await this.prisma.onboardingToken.findUnique({
        where: { token: dto.token },
      }));

    if (!record) {
      throw new NotFoundException('Onboarding token not found');
    }
    if (record.used) {
      throw new ConflictException('This onboarding link has already been used');
    }
    if (record.revokedAt) {
      throw new BadRequestException('This onboarding link has been revoked');
    }
    if (record.expiresAt < new Date()) {
      throw new BadRequestException('This onboarding link has expired');
    }
    if (record.type !== 'LAB_ADMIN') {
      throw new BadRequestException('Invalid token type for lab onboarding');
    }

    // 2. Create the Supabase Auth user — fail fast before any DB writes.
    const supabaseUserId = await this.authService.createSupabaseUser(
      dto.adminEmail,
      dto.password,
      dto.adminFirstName,
      dto.adminLastName
    );

    // 3. Atomic transaction: re-verify token (prevents double-submit race),
    //    create Tenant(LAB) + LaboratoryProfile + User + OWNER membership.
    let tenantId: string;
    let userId: string;

    try {
      ({ tenantId, userId } = await this.prisma.$transaction(async (tx) => {
        // Atomically claim the token — conditional update that only succeeds
        // if the token is still unused, unexpired, unrevoked, and LAB_ADMIN.
        // Two concurrent transactions cannot both get count === 1.
        const { count } = await tx.onboardingToken.updateMany({
          where: {
            id: record.id,
            used: false,
            revokedAt: null,
            type: 'LAB_ADMIN',
            expiresAt: { gt: new Date() },
          },
          data: { used: true, usedAt: new Date() },
        });
        if (count === 0) {
          throw new ConflictException(
            'This onboarding link has already been used'
          );
        }

        // Slug collision check inside transaction for concurrency safety
        let slug = slugify(dto.labName);
        const slugConflict = await tx.tenant.findFirst({
          where: { slug },
          select: { id: true },
        });
        if (slugConflict) {
          slug = `${slug}-${randomUUID().slice(0, 6)}`;
        }

        const tenant = await tx.tenant.create({
          data: {
            name: dto.labName,
            slug,
            type: 'LAB',
            email: record.labEmail || dto.adminEmail,
          },
        });

        await tx.laboratoryProfile.create({
          data: {
            tenantId: tenant.id,
            vetVerificationRequired: false,
          },
        });

        await tx.user.create({
          data: {
            id: supabaseUserId,
            email: dto.adminEmail,
            firstName: dto.adminFirstName,
            lastName: dto.adminLastName,
          },
        });

        await tx.userTenantMembership.create({
          data: {
            userId: supabaseUserId,
            tenantId: tenant.id,
            role: TenantRole.OWNER,
          },
        });

        return { tenantId: tenant.id, userId: supabaseUserId };
      }));
    } catch (err) {
      await this.authService.deleteSupabaseUser(supabaseUserId);
      throw err;
    }

    return { tenantId, userId };
  }

  // ---------------------------------------------------------------------------
  // Delete lab tenant — internal endpoint for testing/admin cleanup.
  // Removes all lab-owned data, the tenant itself, and Supabase auth users.
  // ---------------------------------------------------------------------------

  async listLabs() {
    return this.prisma.tenant.findMany({
      where: { type: 'LAB' },
      select: {
        id: true,
        name: true,
        slug: true,
        email: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteLab(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, type: true },
    });

    if (!tenant) {
      throw new NotFoundException('Lab tenant not found');
    }
    if (tenant.type !== 'LAB') {
      throw new BadRequestException('Tenant is not a lab');
    }

    const members = await this.prisma.userTenantMembership.findMany({
      where: { tenantId },
      select: { userId: true },
    });

    await this.prisma.$transaction(async (tx) => {
      // Non-cascading FKs: null out nullable, delete non-nullable
      await tx.order.updateMany({
        where: { labTenantId: tenantId },
        data: { labTenantId: null },
      });
      await tx.orderedTest.updateMany({
        where: { catalogItem: { labTenantId: tenantId } },
        data: { catalogItemId: null },
      });
      await tx.resultTemplateDefinition.updateMany({
        where: { labTenantId: tenantId },
        data: { labTenantId: null },
      });
      await tx.pickup.deleteMany({
        where: { labTenantId: tenantId },
      });
      await tx.vetLabVerification.deleteMany({
        where: { labTenantId: tenantId },
      });

      // Tenant delete cascades: memberships, invitations, cases, catalog,
      // lab profile, clinic connections, analyzers, test configs, specimens
      await tx.tenant.delete({ where: { id: tenantId } });
    });

    // Best-effort Supabase user cleanup (outside tx — non-fatal)
    for (const { userId } of members) {
      const otherMemberships = await this.prisma.userTenantMembership.count({
        where: { userId },
      });
      if (otherMemberships === 0) {
        await this.authService.deleteSupabaseUser(userId);
        await this.prisma.user.delete({ where: { id: userId } }).catch(() => {
          /* best-effort cleanup */
        });
      }
    }

    return { deleted: true, tenantId, usersRemoved: members.length };
  }
}

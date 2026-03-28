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
    private readonly storageService: StorageService,
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
    dto: SaveStaffProfileDto,
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

    const roleMap: Record<string, TenantRole> = {
      vet: TenantRole.VET,
      tech: TenantRole.TECHNICIAN,
      admin: TenantRole.ADMIN,
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
  // ---------------------------------------------------------------------------

  async generateInvite(invitedByUserId: string, tenantId: string, dto: GenerateInviteDto) {
    const roleMap: Record<string, TenantRole> = {
      vet: TenantRole.VET,
      tech: TenantRole.TECHNICIAN,
      admin: TenantRole.ADMIN,
    };
    const tenantRole = roleMap[dto.role] ?? TenantRole.VET;

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invitation = await this.prisma.tenantInvitation.create({
      data: {
        tenantId,
        email: dto.email,
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
    };
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

    return {
      tenantId: invite.tenantId,
      tenantName: invite.tenant.name,
      logoUrl: invite.tenant.logoUrl ?? null,
      primaryColor: invite.tenant.primaryColor ?? null,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Create admin onboarding link — called by Biomet to invite a clinic admin.
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
        biometClinicId: dto.biometClinicId ?? null,
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

  async completeAdminOnboarding(dto: CompleteAdminOnboardingDto, logoFile?: Express.Multer.File) {
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
      dto.adminLastName,
    );

    // 3. Create Tenant + User row + ADMIN membership + mark token used — all in one transaction.
    //    If the transaction fails after Supabase user creation, the Supabase user will be
    //    orphaned. A cleanup job or retry can handle this edge case.
    // TODO: add compensating cleanup if transaction fails (delete Supabase user)
    let slug = slugify(dto.clinicName);
    const slugConflict = await this.prisma.tenant.findFirst({
      where: { slug },
      select: { id: true },
    });
    if (slugConflict) {
      slug = `${slug}-${randomUUID().slice(0, 6)}`;
    }

    const { tenantId, userId } = await this.prisma.$transaction(async (tx) => {
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
    });

    // 4. Upload logo now that we have a stable tenantId.
    //    Path: clinic-logos/{tenantId}/logo.{ext}
    //    Done outside the transaction — a failed upload is non-fatal; the
    //    tenant is already created and the admin can re-upload from settings.
    if (logoFile) {
      try {
        const logoUrl = await this.storageService.uploadClinicLogo(tenantId, logoFile);
        await this.prisma.tenant.update({
          where: { id: tenantId },
          data: { logoUrl },
        });
      } catch {
        return {
          tenantId,
          userId,
          logoUploadFailed: true as const,
          message: 'Account created successfully, but logo upload failed. You can upload your logo later from Settings.',
        };
      }
    }

    return { tenantId, userId };
  }
}
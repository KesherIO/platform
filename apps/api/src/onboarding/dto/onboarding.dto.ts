import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

// ---------------------------------------------------------------------------
// POST /onboarding/clinic
// ---------------------------------------------------------------------------

export class SaveClinicSetupDto {
  @ApiProperty({ example: 'City Vet Clinic' })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiProperty({ example: '123 Main St, Austin TX' })
  @IsString()
  @IsNotEmpty()
  address!: string;

  @ApiProperty({ example: 'clinic@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: '+1 512 555 0100' })
  @IsString()
  @IsNotEmpty()
  telephone!: string;

  @ApiProperty({ enum: ['email', 'sms'] })
  @IsEnum(['email', 'sms'])
  notificationMethod!: 'email' | 'sms';

  @ApiPropertyOptional({ example: 'US' })
  @IsOptional()
  @IsString()
  country?: string;

  /**
   * Public URL of the clinic logo stored in Supabase Storage (bucket: clinic-logos).
   * The frontend uploads the file via POST /onboarding/logo, receives the public URL,
   * and then includes it here. Never store raw file data or base64 in this field.
   * Optional — onboarding works without a logo; the frontend falls back to the default app icon.
   */
  @ApiPropertyOptional({
    example:
      'https://your-project.supabase.co/storage/v1/object/public/clinic-logos/tenants/clx123/logo-1700000000000.png',
  })
  @IsOptional()
  @IsUrl()
  logoUrl?: string;
}

// ---------------------------------------------------------------------------
// POST /onboarding/admin-profile
// ---------------------------------------------------------------------------

export class SaveAdminProfileDto {
  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  @MinLength(2)
  fullName!: string;

  @ApiProperty({ example: '+1 512 555 0101' })
  @IsString()
  @IsNotEmpty()
  telephone!: string;

  @ApiProperty({ example: 'jane@example.com' })
  @IsEmail()
  email!: string;
}

// ---------------------------------------------------------------------------
// POST /onboarding/staff-profile
// ---------------------------------------------------------------------------

export class SaveStaffProfileDto {
  @ApiProperty({ example: 'John Smith' })
  @IsString()
  @MinLength(2)
  fullName!: string;

  @ApiProperty({ example: '+1 512 555 0102' })
  @IsString()
  @IsNotEmpty()
  telephone!: string;

  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: ['admin', 'vet', 'technician', 'receptionist'] })
  @IsEnum(['admin', 'vet', 'technician', 'receptionist'])
  role!: 'admin' | 'vet' | 'technician' | 'receptionist';

  /** The invite token received in the magic link URL */
  @ApiProperty({ example: 'uuid-token-here' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}

// ---------------------------------------------------------------------------
// POST /onboarding/invite
// ---------------------------------------------------------------------------

export class GenerateInviteDto {
  /**
   * Target email for email-specific invites.
   * Omit to generate a generic magic link (anyone can use it).
   * When provided, email-based guardrails are enforced:
   *   - no duplicate pending invite for this email in this clinic
   *   - user with this email must not already be an active member
   */
  @ApiPropertyOptional({ example: 'staff@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  /** Defaults to 'vet' when omitted. */
  @ApiPropertyOptional({
    enum: ['admin', 'vet', 'technician', 'receptionist'],
    default: 'vet',
  })
  @IsOptional()
  @IsEnum(['admin', 'vet', 'technician', 'receptionist'])
  role?: 'admin' | 'vet' | 'technician' | 'receptionist';
}

// ---------------------------------------------------------------------------
// POST /onboarding/complete-staff
// Public endpoint — token is the only credential.
// Creates: Supabase user (server-side, email pre-confirmed) → User row → membership.
// After success the frontend signs in with signInWithPassword().
// ---------------------------------------------------------------------------

export class CompleteStaffOnboardingDto {
  /** The invite token from the magic link URL */
  @ApiProperty({ example: 'uuid-token-here' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  /** Omit when the user already exists (re-invite path). */
  @ApiPropertyOptional({ example: 'John Smith' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  @ApiPropertyOptional({ example: '+1 512 555 0102' })
  @IsOptional()
  @IsString()
  telephone?: string;

  @ApiProperty({ example: 'john@clinic.com' })
  @IsEmail()
  email!: string;

  /** Omit when the user already exists (re-invite path). */
  @ApiPropertyOptional({ example: 'supersecret123', minLength: 8 })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @ApiProperty({ enum: ['admin', 'vet', 'technician', 'receptionist'] })
  @IsEnum(['admin', 'vet', 'technician', 'receptionist'])
  role!: 'admin' | 'vet' | 'technician' | 'receptionist';
}

// ---------------------------------------------------------------------------
// POST /onboarding/admin-link
// Creates a new ADMIN onboarding token for a clinic (called by KesherIO).
// ---------------------------------------------------------------------------

export class CreateAdminLinkDto {
  @ApiProperty({ example: 'City Vet Clinic' })
  @IsString()
  @MinLength(2)
  clinicName!: string;

  /** Clinic contact email — stored on Tenant, used for notifications */
  @ApiProperty({ example: 'info@cityvetclinic.com' })
  @IsEmail()
  clinicEmail!: string;

  /** Optional external reference from KesherIO's own system */
  @ApiPropertyOptional({ example: 'KIO-12345' })
  @IsOptional()
  @IsString()
  externalClinicId?: string;
}

// ---------------------------------------------------------------------------
// POST /onboarding/complete
// Completes the ADMIN onboarding: creates Supabase user + Tenant + membership.
// ---------------------------------------------------------------------------

export class CompleteAdminOnboardingDto {
  @ApiProperty({ example: 'abc123...hex token' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  // ── Admin personal details ──────────────────────────────────────────────

  /** First name of the admin user */
  @ApiProperty({ example: 'Jane' })
  @IsString()
  @IsNotEmpty()
  adminFirstName!: string;

  /** Last name of the admin user */
  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsNotEmpty()
  adminLastName!: string;

  /** Admin login email — entered by the admin during onboarding, used for Supabase auth (sign-in) */
  @ApiProperty({ example: 'admin@cityvetclinic.com' })
  @IsEmail()
  adminEmail!: string;

  /**
   * Password for the new account. Ignored when adminEmail already has an
   * account — the caller must then be signed in as that user instead.
   */
  @ApiProperty({ example: 'supersecret123', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  /** Admin's personal phone number (optional) */
  @ApiPropertyOptional({ example: '+1 512 555 0101' })
  @IsOptional()
  @IsString()
  adminPhone?: string;

  // ── Clinic details (collected on clinic-setup screen) ──────────────────

  // Lab-created clients: omit any clinic field the admin left untouched and
  // the value already on record is kept. Platform invitations must send name,
  // address, city, email and phone. A field that is sent cannot be empty.

  /** Clinic display name — user may have edited the KesherIO-provided default */
  @ApiPropertyOptional({ example: 'City Vet Clinic' })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MinLength(2)
  clinicName?: string;

  @ApiPropertyOptional({ example: '123 Main St' })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  clinicAddress?: string;

  @ApiPropertyOptional({ example: 'Austin' })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  clinicCity?: string;

  /** Clinic contact email — stored on Tenant, distinct from adminEmail */
  @ApiPropertyOptional({ example: 'info@cityvetclinic.com' })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEmail()
  clinicEmail?: string;

  @ApiPropertyOptional({ example: '+1 512 555 0100' })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  clinicPhone?: string;

  @ApiProperty({ enum: ['email', 'sms'] })
  @IsEnum(['email', 'sms'])
  notificationMethod!: 'email' | 'sms';

  /** Omit to keep the value already on record (lab-created clients); '' clears it */
  @ApiPropertyOptional({ example: 'US' })
  @IsOptional()
  @IsString()
  country?: string;

  /**
   * Clinic's primary contact person — independent of the onboarding admin.
   * Omit to keep the value already on record (lab-created clients); '' clears it.
   */
  @ApiPropertyOptional({ example: 'Dr. Ana Gómez' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  primaryContactName?: string;

  /** When true, the admin is also a veterinarian — sets isOrderingVet on their membership */
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  isVet?: boolean;

  @ApiPropertyOptional({
    example:
      'https://your-project.supabase.co/storage/v1/object/public/clinic-logos/tenants/clx123/logo.png',
  })
  @IsOptional()
  @IsUrl()
  logoUrl?: string;
}

// ---------------------------------------------------------------------------
// POST /onboarding/lab-link
// Creates a new LAB_ADMIN onboarding token (called by KesherIO / admin app).
// ---------------------------------------------------------------------------

export class CreateLabLinkDto {
  @ApiProperty({ example: 'Kesher Diagnostics' })
  @IsString()
  @MinLength(2)
  labName!: string;

  @ApiProperty({ example: 'info@kesherlab.com' })
  @IsEmail()
  labEmail!: string;
}

// ---------------------------------------------------------------------------
// POST /onboarding/complete-lab
// Completes LAB_ADMIN onboarding: creates Supabase user + Tenant(LAB)
// + LaboratoryProfile + ADMIN membership.
// ---------------------------------------------------------------------------

export class DeleteLabDto {
  @ApiProperty({ example: 'clx1abc...' })
  @IsString()
  @IsNotEmpty()
  tenantId!: string;
}

export class CompleteLabOnboardingDto {
  @ApiProperty({ example: 'abc123...hex token' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ example: 'Jane' })
  @IsString()
  @IsNotEmpty()
  adminFirstName!: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsNotEmpty()
  adminLastName!: string;

  @ApiProperty({ example: 'admin@kesherlab.com' })
  @IsEmail()
  adminEmail!: string;

  @ApiProperty({ example: 'supersecret123', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ example: 'Kesher Diagnostics' })
  @IsString()
  @MinLength(2)
  labName!: string;
}

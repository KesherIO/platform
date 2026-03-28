import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
  @ApiPropertyOptional({ example: 'https://your-project.supabase.co/storage/v1/object/public/clinic-logos/tenants/clx123/logo-1700000000000.png' })
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

  @ApiProperty({ enum: ['vet', 'tech', 'admin'] })
  @IsEnum(['vet', 'tech', 'admin'])
  role!: 'vet' | 'tech' | 'admin';

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
  @ApiProperty({ example: 'staff@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: ['vet', 'tech', 'admin'] })
  @IsEnum(['vet', 'tech', 'admin'])
  role!: 'vet' | 'tech' | 'admin';
}

// ---------------------------------------------------------------------------
// POST /onboarding/admin-link
// Creates a new ADMIN onboarding token for a clinic (called by Biomet).
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

  /** Optional external reference from Biomet's own system */
  @ApiPropertyOptional({ example: 'BIO-12345' })
  @IsOptional()
  @IsString()
  biometClinicId?: string;
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

  /** Clinic display name — user may have edited the Biomet-provided default */
  @ApiProperty({ example: 'City Vet Clinic' })
  @IsString()
  @MinLength(2)
  clinicName!: string;

  @ApiProperty({ example: '123 Main St' })
  @IsString()
  @IsNotEmpty()
  clinicAddress!: string;

  @ApiProperty({ example: 'Austin' })
  @IsString()
  @IsNotEmpty()
  clinicCity!: string;

  /** Clinic contact email — stored on Tenant, distinct from adminEmail */
  @ApiProperty({ example: 'info@cityvetclinic.com' })
  @IsEmail()
  clinicEmail!: string;

  @ApiProperty({ example: '+1 512 555 0100' })
  @IsString()
  @IsNotEmpty()
  clinicPhone!: string;

  @ApiProperty({ enum: ['email', 'sms'] })
  @IsEnum(['email', 'sms'])
  notificationMethod!: 'email' | 'sms';

  @ApiPropertyOptional({ example: 'US' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ example: 'https://your-project.supabase.co/storage/v1/object/public/clinic-logos/tenants/clx123/logo.png' })
  @IsOptional()
  @IsUrl()
  logoUrl?: string;
}
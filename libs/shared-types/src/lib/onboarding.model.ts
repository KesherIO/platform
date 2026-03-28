export interface OnboardingState {
  tenantId: string;
  step: OnboardingStep;
  clinic?: ClinicSetupData;
  adminProfile?: AdminProfileData;
  /** Draft admin profile fields (no passwords) — restored when navigating back */
  adminProfileDraft?: AdminProfileDraft;
  isFirstUser: boolean;
  inviteToken?: string;
  /** The raw onboarding token from the Biomet link (?token=...) */
  onboardingToken?: string;
  /** Clinic name prefilled from server verify response — editable by the admin */
  prefillClinicName?: string;
  /** Clinic contact email prefilled from server verify response — read-only */
  prefillClinicEmail?: string;
}

/** Non-sensitive admin profile fields saved when navigating back — passwords are never persisted */
export interface AdminProfileDraft {
  firstName: string;
  lastName: string;
  email: string;
  telephone: string;
}

export type OnboardingStep = 'welcome' | 'clinic-setup' | 'admin-profile' | 'staff-invite' | 'staff-profile' | 'complete';

export interface ClinicSetupData {
  name: string;
  address: string;
  city: string;
  /** Clinic contact email — prefilled from Biomet token, read-only in the form */
  email: string;
  telephone: string;
  notificationMethod: 'email' | 'sms';
  country?: string;
  /** Logo file held in memory until POST /onboarding/complete — never uploaded early */
  pendingLogoFile?: File;
}

export interface AdminProfileData {
  fullName: string;
  telephone: string;
  email: string;
  role: 'admin';
}

export interface StaffProfileData {
  fullName: string;
  telephone: string;
  email: string;
  role: 'vet' | 'tech' | 'admin';
}

export interface MagicLinkInvite {
  clinicId: string;
  tenantId: string;
  invitedBy: string;
  expiresAt: Date;
  token: string;
}

// ---------------------------------------------------------------------------
// Token-based admin onboarding (new flow)
// ---------------------------------------------------------------------------

export type OnboardingTokenType = 'ADMIN';

/** Shape of a valid token verification response from GET /onboarding/verify/:token */
export type VerifyOnboardingTokenResponse =
  | {
      valid: true;
      type: OnboardingTokenType;
      clinicName: string;
      /** Clinic contact email — stored on Tenant */
      clinicEmail: string;
    }
  | {
      valid: false;
      reason: 'expired' | 'used' | 'not_found';
    };

/** Body for POST /onboarding/complete */
export interface CompleteAdminOnboardingRequest {
  token: string;
  // ── Admin details ──────────────────────────────────────────────────────
  adminFirstName: string;
  adminLastName: string;
  adminEmail: string;
  password: string;
  /** Admin's personal phone (optional) */
  adminPhone?: string;
  // ── Clinic details (collected on clinic-setup screen) ──────────────────
  clinicName: string;
  clinicAddress: string;
  clinicCity: string;
  clinicEmail: string;
  clinicPhone: string;
  notificationMethod: 'email' | 'sms';
  country?: string;
}

/** Response from POST /onboarding/complete */
export interface CompleteAdminOnboardingResponse {
  tenantId: string;
  userId: string;
  /** Present only when the account was created but the logo upload failed. */
  logoUploadFailed?: true;
  message?: string;
}
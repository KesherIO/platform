export interface OnboardingState {
  tenantId: string;
  step: OnboardingStep;
  clinic?: ClinicSetupData;
  adminProfile?: AdminProfileData;
  isFirstUser: boolean;
  inviteToken?: string;
}

export type OnboardingStep = 'welcome' | 'clinic-setup' | 'admin-profile' | 'staff-invite' | 'staff-profile' | 'complete';

export interface ClinicSetupData {
  name: string;
  address: string;
  email: string;
  telephone: string;
  notificationMethod: 'email' | 'sms';
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
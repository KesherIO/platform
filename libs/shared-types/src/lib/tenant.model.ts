export type TenantType = 'CLINIC' | 'LAB' | 'VETAI';

export interface Tenant {
  id: string;
  name: string;
  type: TenantType;
  slug: string;
  // Contact details — collected during clinic-setup onboarding step
  address?: string;
  email?: string;
  phone?: string;
  country?: string;
  notificationMethod?: 'email' | 'sms';
  // Branding — optional, populated via future branding/settings step
  logoUrl?: string;   // URL in storage; never store raw file data
  primaryColor?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TenantBranding {
  tenantId: string;
  tenantName: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
}
export type TenantType = 'CLINIC' | 'LAB' | 'PLATFORM';

export type ClientType =
  | 'VETERINARY_CLINIC'
  | 'INDEPENDENT_VET'
  | 'BREEDER'
  | 'FARM'
  | 'SHELTER'
  | 'RESEARCH_ORGANIZATION'
  | 'INDIVIDUAL'
  | 'OTHER';

export type ClientStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED';

export interface Tenant {
  id: string;
  name: string;
  type: TenantType;
  slug: string;
  clientType?: ClientType | null;
  clientStatus?: ClientStatus | null;
  primaryContactName?: string | null;
  // Contact details — collected during clinic-setup onboarding step
  address?: string;
  email?: string;
  phone?: string;
  country?: string;
  notificationMethod?: 'email' | 'sms';
  // Branding — optional, populated via future branding/settings step
  logoUrl?: string; // URL in storage; never store raw file data
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

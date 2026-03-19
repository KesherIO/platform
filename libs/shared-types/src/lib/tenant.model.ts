export interface Tenant {
  id: string;
  name: string;
  logoUrl?: string;
  primaryColor?: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TenantBranding {
  tenantId: string;
  tenantName: string;
  logoUrl?: string;
  primaryColor?: string;
}
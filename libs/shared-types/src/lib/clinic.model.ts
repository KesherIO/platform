export interface Clinic {
  id?: string;
  tenantId: string;
  name: string;
  address: string;
  email: string;
  telephone: string;
  notificationMethod: 'email' | 'sms';
  defaultLanguage: 'en' | 'es';
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateClinicDto {
  tenantId: string;
  name: string;
  address: string;
  email: string;
  telephone: string;
  notificationMethod: 'email' | 'sms';
}
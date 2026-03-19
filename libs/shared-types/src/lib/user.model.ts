export type UserRole = 'admin' | 'vet' | 'tech';

export interface User {
  id?: string;
  tenantId: string;
  clinicId: string;
  fullName: string;
  email: string;
  telephone: string;
  role: UserRole;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateUserDto {
  tenantId: string;
  clinicId: string;
  fullName: string;
  email: string;
  telephone: string;
  role: UserRole;
}
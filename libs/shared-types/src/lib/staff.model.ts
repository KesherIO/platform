export type StaffStatus = 'Active' | 'Invited';
export type StaffRole = 'Admin' | 'Staff';

export interface StaffMember {
  id: string;
  fullName: string;
  email: string;
  role: StaffRole;
  status: StaffStatus;
}

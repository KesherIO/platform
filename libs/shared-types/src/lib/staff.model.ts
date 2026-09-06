export type StaffStatus = 'Active' | 'Invited';
export type StaffRole =
  | 'Admin'
  | 'Vet'
  | 'Technician'
  | 'Receptionist'
  | 'Staff';

export interface StaffMember {
  id: string;
  fullName: string;
  email: string;
  role: StaffRole;
  status: StaffStatus;
  /** Whether this member acts as an ordering vet in this clinic. */
  isOrderingVet: boolean;
  /** Raw MembershipStatus from the DB (e.g. ACTIVE, PROFILE_REQUIRED, VERIFICATION_PENDING). null for invited rows. */
  membershipStatus: string | null;
  /** VetLabVerification.status for this vet's connected lab. null when isOrderingVet = false or no record exists. */
  vetVerificationStatus: string | null;
}

export enum VetVerificationStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  REVOKED = 'REVOKED',
  EXPIRED = 'EXPIRED',
}

export enum VetVerificationEventType {
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  RESUBMITTED = 'RESUBMITTED',
  REVOKED = 'REVOKED',
  EXPIRED = 'EXPIRED',
  DOCUMENT_VIEWED = 'DOCUMENT_VIEWED',
}

export interface VeterinarianCredentialModel {
  id: string;
  veterinarianProfileId: string;
  documentKey: string;
  licenseNumber: string;
  issuingCountry: string;
  issuingAuthority: string | null;
  licenseExpiresAt: string | null;
  createdAt: string;
  replacedAt: string | null;
}

export interface VeterinarianProfileModel {
  id: string;
  userId: string;
  legalName: string;
  createdAt: string;
  updatedAt: string;
  activeCredential?: VeterinarianCredentialModel | null;
}

export interface VetLabVerificationModel {
  id: string;
  vetProfileId: string;
  labTenantId: string;
  initiatingClinicId: string;
  status: VetVerificationStatus;
  reviewedCredentialId: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  reviewedByName: string | null;
  rejectionReason: string | null;
  revokedAt: string | null;
  revokedByUserId: string | null;
  revokedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VetVerificationEventModel {
  id: string;
  verificationId: string;
  eventType: VetVerificationEventType;
  actorId: string | null;
  actorName: string | null;
  clinicTenantId: string | null;
  credentialVersionId: string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/** Shape returned by GET /api/tenants/:id/vets */
export interface EligibleVetModel {
  userId: string;
  fullName: string;
  email: string;
  isOrderingVet: boolean;
  status: string;
  vetVerification: {
    status: string;
    rejectionReason: string | null;
  } | null;
}

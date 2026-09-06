-- CreateEnum
CREATE TYPE "VetVerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "VetVerificationEventType" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'RESUBMITTED', 'REVOKED', 'EXPIRED', 'DOCUMENT_VIEWED');

-- CreateTable
CREATE TABLE "vet_lab_verifications" (
    "id" TEXT NOT NULL,
    "vetProfileId" TEXT NOT NULL,
    "labTenantId" TEXT NOT NULL,
    "initiatingClinicId" TEXT NOT NULL,
    "status" "VetVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedCredentialId" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "reviewedByName" TEXT,
    "rejectionReason" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vet_lab_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vet_verification_events" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "eventType" "VetVerificationEventType" NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "clinicTenantId" TEXT,
    "credentialVersionId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vet_verification_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vet_lab_verifications_vetProfileId_labTenantId_key" ON "vet_lab_verifications"("vetProfileId", "labTenantId");

-- CreateIndex
CREATE INDEX "vet_lab_verifications_labTenantId_status_idx" ON "vet_lab_verifications"("labTenantId", "status");

-- CreateIndex
CREATE INDEX "vet_lab_verifications_initiatingClinicId_idx" ON "vet_lab_verifications"("initiatingClinicId");

-- CreateIndex
CREATE INDEX "vet_verification_events_verificationId_createdAt_idx" ON "vet_verification_events"("verificationId", "createdAt");

-- AddForeignKey
ALTER TABLE "vet_lab_verifications" ADD CONSTRAINT "vet_lab_verifications_vetProfileId_fkey" FOREIGN KEY ("vetProfileId") REFERENCES "veterinarian_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vet_lab_verifications" ADD CONSTRAINT "vet_lab_verifications_labTenantId_fkey" FOREIGN KEY ("labTenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vet_lab_verifications" ADD CONSTRAINT "vet_lab_verifications_initiatingClinicId_fkey" FOREIGN KEY ("initiatingClinicId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vet_lab_verifications" ADD CONSTRAINT "vet_lab_verifications_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vet_lab_verifications" ADD CONSTRAINT "vet_lab_verifications_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vet_lab_verifications" ADD CONSTRAINT "vet_lab_verifications_reviewedCredentialId_fkey" FOREIGN KEY ("reviewedCredentialId") REFERENCES "veterinarian_credentials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vet_verification_events" ADD CONSTRAINT "vet_verification_events_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "vet_lab_verifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

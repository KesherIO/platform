-- CreateTable
CREATE TABLE "lab_signers" (
    "id" TEXT NOT NULL,
    "laboratoryProfileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roles" TEXT[],
    "title" TEXT NOT NULL DEFAULT '',
    "specialty" TEXT NOT NULL DEFAULT '',
    "university" TEXT NOT NULL DEFAULT '',
    "registrationNumber" TEXT NOT NULL DEFAULT '',
    "signatureUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lab_signers_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "lab_signers" ADD CONSTRAINT "lab_signers_laboratoryProfileId_fkey" FOREIGN KEY ("laboratoryProfileId") REFERENCES "laboratory_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

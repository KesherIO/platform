-- CreateTable
CREATE TABLE "veterinarian_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "veterinarian_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "veterinarian_credentials" (
    "id" TEXT NOT NULL,
    "veterinarianProfileId" TEXT NOT NULL,
    "documentKey" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "issuingCountry" TEXT NOT NULL,
    "issuingAuthority" TEXT,
    "licenseExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replacedAt" TIMESTAMP(3),

    CONSTRAINT "veterinarian_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "veterinarian_profiles_userId_key" ON "veterinarian_profiles"("userId");

-- CreateIndex
CREATE INDEX "veterinarian_credentials_veterinarianProfileId_idx" ON "veterinarian_credentials"("veterinarianProfileId");

-- CreateIndex
CREATE INDEX "veterinarian_credentials_licenseNumber_idx" ON "veterinarian_credentials"("licenseNumber");

-- AddForeignKey
ALTER TABLE "veterinarian_profiles" ADD CONSTRAINT "veterinarian_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "veterinarian_credentials" ADD CONSTRAINT "veterinarian_credentials_veterinarianProfileId_fkey" FOREIGN KEY ("veterinarianProfileId") REFERENCES "veterinarian_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

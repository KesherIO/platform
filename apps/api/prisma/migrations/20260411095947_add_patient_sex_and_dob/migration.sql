-- CreateEnum
CREATE TYPE "PatientSex" AS ENUM ('MALE', 'FEMALE', 'UNKNOWN');

-- AlterTable
ALTER TABLE "cases" ADD COLUMN     "patientDateOfBirth" TIMESTAMP(3),
ADD COLUMN     "patientSex" "PatientSex";

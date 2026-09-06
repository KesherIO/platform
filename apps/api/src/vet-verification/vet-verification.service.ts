import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class VetVerificationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the VetLabVerification for the authenticated vet at the clinic's connected lab.
   * Returns null if no verification exists or the lab does not require it.
   */
  async getStatus(userId: string, clinicTenantId: string) {
    const profile = await this.prisma.veterinarianProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) return null;

    const connection = await this.prisma.clinicLabConnection.findFirst({
      where: { clinicId: clinicTenantId, isActive: true },
      select: {
        labId: true,
        lab: {
          select: {
            laboratoryProfile: { select: { vetVerificationRequired: true } },
          },
        },
      },
    });
    if (
      !connection ||
      !connection.lab.laboratoryProfile?.vetVerificationRequired
    ) {
      return null;
    }

    const verification = await this.prisma.vetLabVerification.findUnique({
      where: {
        vetProfileId_labTenantId: {
          vetProfileId: profile.id,
          labTenantId: connection.labId,
        },
      },
      select: {
        id: true,
        status: true,
        rejectionReason: true,
        submittedAt: true,
        reviewedAt: true,
      },
    });

    return verification;
  }

  /**
   * Submit the authenticated vet for verification at the clinic's connected lab.
   * Idempotent: returns existing record if already PENDING or APPROVED.
   * Resubmits if REJECTED or REVOKED.
   */
  async submit(userId: string, clinicTenantId: string) {
    // 1. Membership must mark this user as an ordering vet
    const membership = await this.prisma.userTenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId: clinicTenantId } },
      select: { isOrderingVet: true },
    });
    if (!membership?.isOrderingVet) {
      throw new UnprocessableEntityException('ORDERING_VET_NOT_A_VET');
    }

    // 2. VeterinarianProfile must exist
    const profile = await this.prisma.veterinarianProfile.findUnique({
      where: { userId },
      include: { credentials: { where: { replacedAt: null }, take: 1 } },
    });
    if (!profile)
      throw new UnprocessableEntityException('ORDERING_VET_NO_PROFILE');

    // 3. Active credential must exist
    const credential = profile.credentials[0];
    if (!credential)
      throw new UnprocessableEntityException('ORDERING_VET_NO_CREDENTIAL');

    // 4. License must not be expired
    if (
      credential.licenseExpiresAt &&
      credential.licenseExpiresAt < new Date()
    ) {
      throw new UnprocessableEntityException('ORDERING_VET_LICENSE_EXPIRED');
    }

    // 5. Active clinic-lab connection must exist
    const connection = await this.prisma.clinicLabConnection.findFirst({
      where: { clinicId: clinicTenantId, isActive: true },
      select: {
        labId: true,
        lab: {
          select: {
            laboratoryProfile: { select: { vetVerificationRequired: true } },
          },
        },
      },
    });
    if (!connection) {
      throw new NotFoundException(
        'No active lab connection found for this clinic.'
      );
    }

    const labTenantId = connection.labId;

    // 6. If lab does not require verification, return early
    if (!connection.lab.laboratoryProfile?.vetVerificationRequired) {
      return { required: false };
    }

    const existing = await this.prisma.vetLabVerification.findUnique({
      where: {
        vetProfileId_labTenantId: { vetProfileId: profile.id, labTenantId },
      },
    });

    const now = new Date();

    // 7. Already APPROVED — idempotent
    if (existing?.status === 'APPROVED') {
      return {
        verificationId: existing.id,
        status: 'APPROVED',
        submittedAt: existing.submittedAt,
      };
    }

    // 8. Already PENDING — idempotent
    if (existing?.status === 'PENDING') {
      return {
        verificationId: existing.id,
        status: 'PENDING',
        submittedAt: existing.submittedAt,
      };
    }

    // 9. REJECTED or REVOKED — reset to PENDING and write RESUBMITTED event
    if (existing?.status === 'REJECTED' || existing?.status === 'REVOKED') {
      const updated = await this.prisma.$transaction(async (tx) => {
        const v = await tx.vetLabVerification.update({
          where: { id: existing.id },
          data: {
            status: 'PENDING',
            submittedAt: now,
            reviewedAt: null,
            reviewedByUserId: null,
            reviewedByName: null,
            rejectionReason: null,
            revokedAt: null,
            revokedByUserId: null,
            revokedReason: null,
          },
        });
        await tx.vetVerificationEvent.create({
          data: {
            verificationId: existing.id,
            eventType: 'RESUBMITTED',
            actorId: userId,
            credentialVersionId: credential.id,
          },
        });
        await tx.userTenantMembership.update({
          where: { userId_tenantId: { userId, tenantId: clinicTenantId } },
          data: { status: 'VERIFICATION_PENDING' },
        });
        return v;
      });
      return {
        verificationId: updated.id,
        status: 'PENDING',
        submittedAt: updated.submittedAt,
      };
    }

    // 10. No existing record — create new
    const created = await this.prisma.$transaction(async (tx) => {
      const v = await tx.vetLabVerification.create({
        data: {
          vetProfileId: profile.id,
          labTenantId,
          initiatingClinicId: clinicTenantId,
          status: 'PENDING',
          submittedAt: now,
        },
      });
      await tx.vetVerificationEvent.create({
        data: {
          verificationId: v.id,
          eventType: 'SUBMITTED',
          actorId: userId,
          credentialVersionId: credential.id,
        },
      });
      await tx.userTenantMembership.update({
        where: { userId_tenantId: { userId, tenantId: clinicTenantId } },
        data: { status: 'VERIFICATION_PENDING' },
      });
      return v;
    });
    return {
      verificationId: created.id,
      status: 'PENDING',
      submittedAt: created.submittedAt,
    };
  }
}

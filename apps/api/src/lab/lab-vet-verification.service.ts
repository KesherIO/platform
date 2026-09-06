import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { VetVerificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { ListVetVerificationsDto } from './dto/list-vet-verifications.dto';

const SIGNED_URL_TTL = 3600;

@Injectable()
export class LabVetVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService
  ) {}

  async list(labTenantId: string, query: ListVetVerificationsDto) {
    const { status, search, page = 1, pageSize = 20 } = query;
    const skip = (page - 1) * pageSize;

    const where: Record<string, unknown> = { labTenantId };
    if (status) where.status = status as VetVerificationStatus;
    if (search) {
      where.vetProfile = {
        legalName: { contains: search, mode: 'insensitive' },
      };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.vetLabVerification.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { submittedAt: 'desc' },
        select: {
          id: true,
          status: true,
          submittedAt: true,
          reviewedAt: true,
          rejectionReason: true,
          initiatingClinic: { select: { name: true } },
          vetProfile: {
            select: {
              legalName: true,
              credentials: {
                where: { replacedAt: null },
                take: 1,
                select: {
                  licenseNumber: true,
                  issuingCountry: true,
                  issuingAuthority: true,
                  licenseExpiresAt: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.vetLabVerification.count({ where }),
    ]);

    const data = items.map((v) => ({
      id: v.id,
      status: v.status,
      submittedAt: v.submittedAt,
      reviewedAt: v.reviewedAt,
      rejectionReason: v.rejectionReason,
      clinicName: v.initiatingClinic.name,
      vetLegalName: v.vetProfile.legalName,
      ...v.vetProfile.credentials[0],
    }));

    return { data, total, page, pageSize };
  }

  async getCount(labTenantId: string, status?: string) {
    const count = await this.prisma.vetLabVerification.count({
      where: {
        labTenantId,
        ...(status ? { status: status as VetVerificationStatus } : {}),
      },
    });
    return { count };
  }

  async getById(labTenantId: string, id: string) {
    const verification = await this.prisma.vetLabVerification.findFirst({
      where: { id, labTenantId },
      include: {
        vetProfile: {
          include: {
            credentials: { where: { replacedAt: null }, take: 1 },
          },
        },
        initiatingClinic: { select: { name: true } },
        reviewedBy: {
          select: { firstName: true, lastName: true, email: true },
        },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!verification) throw new NotFoundException('Verification not found.');

    const activeCredential = verification.vetProfile.credentials[0] ?? null;

    // Duplicate license detection: warn if another credential shares this licenseNumber
    let duplicateLicenseDetected = false;
    if (activeCredential?.licenseNumber) {
      const duplicate = await this.prisma.veterinarianCredential.findFirst({
        where: {
          licenseNumber: activeCredential.licenseNumber,
          veterinarianProfileId: { not: verification.vetProfile.id },
          replacedAt: null,
        },
        select: { id: true },
      });
      duplicateLicenseDetected = !!duplicate;
    }

    const profileChangedAfterApproval =
      verification.status === 'APPROVED' &&
      verification.reviewedCredentialId !== null &&
      activeCredential?.id !== verification.reviewedCredentialId;

    const { credentials, ...vetProfile } = verification.vetProfile;
    return {
      ...verification,
      vetProfile,
      activeCredential,
      duplicateLicenseDetected,
      profileChangedAfterApproval,
    };
  }

  async getDocument(
    labTenantId: string,
    id: string,
    actorId: string,
    actorName: string
  ) {
    const verification = await this.prisma.vetLabVerification.findFirst({
      where: { id, labTenantId },
      include: {
        vetProfile: {
          include: { credentials: { where: { replacedAt: null }, take: 1 } },
        },
      },
    });

    if (!verification) throw new NotFoundException('Verification not found.');

    const credential = verification.vetProfile.credentials[0];
    if (!credential)
      throw new NotFoundException('No active credential document on file.');

    const signedUrl = await this.storage.getSignedUrl(
      credential.documentKey,
      SIGNED_URL_TTL
    );

    await this.prisma.vetVerificationEvent.create({
      data: {
        verificationId: id,
        eventType: 'DOCUMENT_VIEWED',
        actorId,
        actorName,
        credentialVersionId: credential.id,
        clinicTenantId: verification.initiatingClinicId,
      },
    });

    const expiresAt = new Date(
      Date.now() + SIGNED_URL_TTL * 1000
    ).toISOString();
    return { signedUrl, expiresAt };
  }

  async approve(
    labTenantId: string,
    id: string,
    actorId: string,
    actorName: string
  ) {
    const verification = await this.prisma.vetLabVerification.findFirst({
      where: { id, labTenantId },
      include: {
        vetProfile: {
          select: {
            id: true,
            userId: true,
            credentials: {
              where: { replacedAt: null },
              take: 1,
              select: { id: true },
            },
          },
        },
      },
    });

    if (!verification) throw new NotFoundException('Verification not found.');
    if (verification.status !== 'PENDING') {
      throw new ConflictException(
        `Cannot approve a verification with status "${verification.status}".`
      );
    }

    const credentialId = verification.vetProfile.credentials[0]?.id ?? null;
    const vetUserId = verification.vetProfile.userId;
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.vetLabVerification.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewedAt: now,
          reviewedByUserId: actorId,
          reviewedByName: actorName,
          reviewedCredentialId: credentialId,
        },
      });

      await tx.vetVerificationEvent.create({
        data: {
          verificationId: id,
          eventType: 'APPROVED',
          actorId,
          actorName,
          credentialVersionId: credentialId,
        },
      });

      // Activate all ordering-vet memberships for clinics connected to this lab
      const clinicConnections = await tx.clinicLabConnection.findMany({
        where: { labId: labTenantId, isActive: true },
        select: { clinicId: true },
      });
      const clinicIds = clinicConnections.map((c) => c.clinicId);

      if (clinicIds.length > 0) {
        await tx.userTenantMembership.updateMany({
          where: {
            userId: vetUserId,
            tenantId: { in: clinicIds },
            isOrderingVet: true,
          },
          data: { status: 'ACTIVE' },
        });
      }
    });

    return { id, status: 'APPROVED' };
  }

  async reject(
    labTenantId: string,
    id: string,
    rejectionReason: string,
    actorId: string,
    actorName: string
  ) {
    if (!rejectionReason?.trim()) {
      throw new UnprocessableEntityException('rejectionReason is required.');
    }

    const verification = await this.prisma.vetLabVerification.findFirst({
      where: { id, labTenantId },
      select: { id: true, status: true },
    });
    if (!verification) throw new NotFoundException('Verification not found.');
    if (verification.status !== 'PENDING') {
      throw new ConflictException(
        `Cannot reject a verification with status "${verification.status}".`
      );
    }

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.vetLabVerification.update({
        where: { id },
        data: {
          status: 'REJECTED',
          rejectionReason,
          reviewedAt: now,
          reviewedByUserId: actorId,
          reviewedByName: actorName,
        },
      });

      await tx.vetVerificationEvent.create({
        data: {
          verificationId: id,
          eventType: 'REJECTED',
          actorId,
          actorName,
          reason: rejectionReason,
        },
      });
    });

    return { id, status: 'REJECTED' };
  }

  async revoke(
    labTenantId: string,
    id: string,
    revokedReason: string,
    actorId: string,
    actorName: string
  ) {
    if (!revokedReason?.trim()) {
      throw new UnprocessableEntityException('revokedReason is required.');
    }

    const verification = await this.prisma.vetLabVerification.findFirst({
      where: { id, labTenantId },
      include: {
        vetProfile: { select: { userId: true } },
      },
    });
    if (!verification) throw new NotFoundException('Verification not found.');
    if (verification.status !== 'APPROVED') {
      throw new ConflictException(
        `Cannot revoke a verification with status "${verification.status}".`
      );
    }

    const vetUserId = verification.vetProfile.userId;
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.vetLabVerification.update({
        where: { id },
        data: {
          status: 'REVOKED',
          revokedAt: now,
          revokedByUserId: actorId,
          revokedReason,
        },
      });

      await tx.vetVerificationEvent.create({
        data: {
          verificationId: id,
          eventType: 'REVOKED',
          actorId,
          actorName,
          reason: revokedReason,
        },
      });

      // Revert affected clinic memberships to VERIFICATION_PENDING
      const clinicConnections = await tx.clinicLabConnection.findMany({
        where: { labId: labTenantId, isActive: true },
        select: { clinicId: true },
      });
      const clinicIds = clinicConnections.map((c) => c.clinicId);

      if (clinicIds.length > 0) {
        await tx.userTenantMembership.updateMany({
          where: {
            userId: vetUserId,
            tenantId: { in: clinicIds },
            isOrderingVet: true,
          },
          data: { status: 'VERIFICATION_PENDING' },
        });
      }
    });

    return { id, status: 'REVOKED' };
  }
}

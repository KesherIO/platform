import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  CreateCredentialBodyDto,
  CreateVetProfileDto,
  UpdateVetProfileDto,
} from './vet-profile.dto';

const ALLOWED_CREDENTIAL_MIME = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
];
const MAX_CREDENTIAL_BYTES = 10 * 1024 * 1024; // 10 MB
const SIGNED_URL_TTL = 3600; // 1 hour in seconds

@Injectable()
export class VetProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService
  ) {}

  async getProfile(userId: string) {
    const profile = await this.prisma.veterinarianProfile.findUnique({
      where: { userId },
      include: { credentials: { where: { replacedAt: null }, take: 1 } },
    });
    if (!profile)
      throw new NotFoundException('Veterinarian profile not found.');

    const { credentials, ...rest } = profile;
    return { ...rest, activeCredential: credentials[0] ?? null };
  }

  async createProfile(userId: string, dto: CreateVetProfileDto) {
    const existing = await this.prisma.veterinarianProfile.findUnique({
      where: { userId },
    });
    if (existing)
      throw new ConflictException('Veterinarian profile already exists.');

    return this.prisma.veterinarianProfile.create({
      data: { userId, legalName: dto.legalName },
    });
  }

  async updateProfile(userId: string, dto: UpdateVetProfileDto) {
    await this.requireProfile(userId);
    return this.prisma.veterinarianProfile.update({
      where: { userId },
      data: { legalName: dto.legalName },
    });
  }

  async createCredential(
    userId: string,
    file: Express.Multer.File,
    dto: CreateCredentialBodyDto
  ): Promise<{ credentialId: string; documentKey: string }> {
    this.validateCredentialFile(file);

    const profile = await this.prisma.veterinarianProfile.findUnique({
      where: { userId },
    });
    if (!profile)
      throw new NotFoundException('Veterinarian profile not found.');

    const credentialId = randomUUID();
    const ext = this.extFromMime(file.mimetype);
    const documentKey = `vet-credentials/${userId}/${credentialId}.${ext}`;

    // Upload before DB writes so a storage failure leaves no orphaned records.
    await this.storage.uploadPrivate(documentKey, file.buffer, file.mimetype);

    await this.prisma.$transaction(async (tx) => {
      // Stamp the previous active credential as replaced.
      await tx.veterinarianCredential.updateMany({
        where: { veterinarianProfileId: profile.id, replacedAt: null },
        data: { replacedAt: new Date() },
      });

      await tx.veterinarianCredential.create({
        data: {
          id: credentialId,
          veterinarianProfileId: profile.id,
          documentKey,
          licenseNumber: dto.licenseNumber,
          issuingCountry: dto.issuingCountry,
          issuingAuthority: dto.issuingAuthority ?? null,
          licenseExpiresAt: dto.licenseExpiresAt
            ? new Date(dto.licenseExpiresAt)
            : null,
        },
      });

      // Reset any APPROVED verifications — the new credential must be reviewed.
      const approvedVerifications = await tx.vetLabVerification.findMany({
        where: { vetProfileId: profile.id, status: 'APPROVED' },
        select: { id: true, labTenantId: true },
      });

      if (approvedVerifications.length > 0) {
        const verificationIds = approvedVerifications.map((v) => v.id);
        const labIds = approvedVerifications.map((v) => v.labTenantId);

        await tx.vetLabVerification.updateMany({
          where: { id: { in: verificationIds } },
          data: {
            status: 'PENDING',
            reviewedAt: null,
            reviewedByUserId: null,
            reviewedByName: null,
          },
        });

        await tx.vetVerificationEvent.createMany({
          data: verificationIds.map((verificationId) => ({
            verificationId,
            eventType: 'RESUBMITTED',
            actorId: userId,
            credentialVersionId: credentialId,
          })),
        });

        // Update affected clinic memberships to VERIFICATION_PENDING.
        const clinicConnections = await tx.clinicLabConnection.findMany({
          where: { labId: { in: labIds }, isActive: true },
          select: { clinicId: true },
        });
        const clinicIds = clinicConnections.map((c) => c.clinicId);

        if (clinicIds.length > 0) {
          await tx.userTenantMembership.updateMany({
            where: {
              userId,
              tenantId: { in: clinicIds },
              isOrderingVet: true,
            },
            data: { status: 'VERIFICATION_PENDING' },
          });
        }
      }
    });

    return { credentialId, documentKey };
  }

  async getCredentialDocumentUrl(
    userId: string
  ): Promise<{ signedUrl: string; expiresAt: string }> {
    const profile = await this.prisma.veterinarianProfile.findUnique({
      where: { userId },
      include: { credentials: { where: { replacedAt: null }, take: 1 } },
    });
    if (!profile)
      throw new NotFoundException('Veterinarian profile not found.');

    const [credential] = profile.credentials;
    if (!credential) throw new NotFoundException('No active credential found.');

    const signedUrl = await this.storage.getSignedUrl(
      credential.documentKey,
      SIGNED_URL_TTL
    );

    // Write DOCUMENT_VIEWED event against the most recent verification if one exists.
    const verification = await this.prisma.vetLabVerification.findFirst({
      where: { vetProfileId: profile.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (verification) {
      await this.prisma.vetVerificationEvent.create({
        data: {
          verificationId: verification.id,
          eventType: 'DOCUMENT_VIEWED',
          actorId: userId,
          credentialVersionId: credential.id,
        },
      });
    }

    const expiresAt = new Date(
      Date.now() + SIGNED_URL_TTL * 1000
    ).toISOString();
    return { signedUrl, expiresAt };
  }

  private async requireProfile(userId: string) {
    const profile = await this.prisma.veterinarianProfile.findUnique({
      where: { userId },
    });
    if (!profile)
      throw new NotFoundException('Veterinarian profile not found.');
    return profile;
  }

  private validateCredentialFile(file: Express.Multer.File): void {
    if (!ALLOWED_CREDENTIAL_MIME.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid file type "${file.mimetype}". Allowed: PDF, PNG, JPEG, WebP.`
      );
    }
    if (file.size > MAX_CREDENTIAL_BYTES) {
      throw new BadRequestException(
        'File too large. Maximum allowed size is 10 MB.'
      );
    }
  }

  private extFromMime(mime: string): string {
    const map: Record<string, string> = {
      'application/pdf': 'pdf',
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
    };
    return map[mime] ?? 'bin';
  }
}

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { PdfRendererService } from './pdf-renderer.service';
import type { ReleaseForPdf } from './pdf-renderer.service';

const STALE_THRESHOLD_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 5_000;
// Stale recovery runs every STALE_CHECK_EVERY poll cycles (~60 s at 5 s/cycle).
const STALE_CHECK_EVERY = 12;
const MAX_RETRIES = 3;

@Injectable()
export class PdfProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PdfProcessorService.name);
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollCount = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly renderer: PdfRendererService
  ) {}

  onModuleInit() {
    // Start the first cycle immediately; each cycle schedules the next one
    // only after it completes, so concurrent runs are structurally impossible.
    void this.runCycle();
  }

  onModuleDestroy() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
  }

  private async runCycle(): Promise<void> {
    try {
      await this.claimAndProcess();
      this.pollCount++;
      if (this.pollCount % STALE_CHECK_EVERY === 0) {
        await this.recoverStale();
      }
    } catch (err) {
      this.logger.error('PDF poll cycle error', err);
    } finally {
      this.pollTimer = setTimeout(() => void this.runCycle(), POLL_INTERVAL_MS);
    }
  }

  // Retry backoff delays: 30 s after attempt 1, 5 min after attempt 2.
  // After MAX_RETRIES the artifact becomes FAILED and requires an admin retry.
  private retryBackoffMs(retryCount: number): number {
    if (retryCount === 0) return 30_000;
    return 5 * 60_000;
  }

  /**
   * Phone list for the footer. Releases made before the labelled phone list was
   * snapshotted only have the single `labPhone` column.
   */
  private labPhones(
    phoneNumbers: Prisma.JsonValue | null,
    phone: string | null
  ): ReleaseForPdf['labPhones'] {
    if (Array.isArray(phoneNumbers)) {
      return phoneNumbers
        .map((p) => (p ?? {}) as { label?: unknown; number?: unknown })
        .filter((p) => typeof p.number === 'string' && p.number)
        .map((p) => ({
          label: typeof p.label === 'string' ? p.label : '',
          number: p.number as string,
        }));
    }
    return phone ? [{ label: '', number: phone }] : [];
  }

  private async claimAndProcess(): Promise<void> {
    const claimToken = randomUUID();

    // Atomically claim exactly one PENDING artifact.
    // FOR UPDATE SKIP LOCKED ensures concurrent API instances each get a
    // different row — no two workers ever process the same artifact.
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        release_id: string;
        claim_token: string;
        logo_storage_path: string | null;
        signer_signature_storage_path: string | null;
        analyst_signature_storage_path: string | null;
        retry_count: number;
      }>
    >`
      UPDATE result_report_release_artifacts
      SET status        = 'GENERATING',
          claimed_at    = NOW(),
          claim_token   = ${claimToken},
          "updatedAt"   = NOW()
      WHERE id = (
        SELECT id
        FROM   result_report_release_artifacts
        WHERE  status           = 'PENDING'
          AND  "artifactType"   = 'PDF'
          AND  "retryCount"     < ${MAX_RETRIES}
          AND  (next_retry_at IS NULL OR next_retry_at <= NOW())
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING
        id,
        "releaseId"                    AS release_id,
        claim_token,
        logo_storage_path,
        signer_signature_storage_path,
        analyst_signature_storage_path,
        "retryCount"                   AS retry_count
    `;

    if (rows.length === 0) return;

    const row = rows[0];
    const artifact = {
      id: row.id,
      releaseId: row.release_id,
      claimToken: row.claim_token,
      logoStoragePath: row.logo_storage_path,
      signerSignatureStoragePath: row.signer_signature_storage_path,
      analystSignatureStoragePath: row.analyst_signature_storage_path,
      retryCount: Number(row.retry_count),
    };

    try {
      await this.generateAndStore(artifact);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `PDF generation failed for artifact ${artifact.id}: ${msg}`
      );

      const newRetryCount = artifact.retryCount + 1;
      const isFinal = newRetryCount >= MAX_RETRIES;
      const nextRetryAt = isFinal
        ? null
        : new Date(Date.now() + this.retryBackoffMs(artifact.retryCount));

      await this.prisma.resultReportReleaseArtifact.updateMany({
        where: { id: artifact.id, claimToken: artifact.claimToken },
        data: {
          status: isFinal ? 'FAILED' : 'PENDING',
          retryCount: { increment: 1 },
          claimedAt: null,
          claimToken: null,
          nextRetryAt,
          errorMessage: msg.slice(0, 500),
        },
      });
    }
  }

  private async generateAndStore(artifact: {
    id: string;
    releaseId: string;
    claimToken: string | null;
    logoStoragePath: string | null;
    signerSignatureStoragePath: string | null;
    analystSignatureStoragePath: string | null;
    retryCount: number;
  }): Promise<void> {
    const release = await this.prisma.resultReportRelease.findUniqueOrThrow({
      where: { id: artifact.releaseId },
      include: {
        tests: {
          include: { analytes: { orderBy: { sortOrder: 'asc' } } },
        },
      },
    });

    let logoBuffer: Buffer | null = null;
    let signerSigBuffer: Buffer | null = null;
    let analystSigBuffer: Buffer | null = null;

    if (artifact.logoStoragePath) {
      try {
        logoBuffer = await this.storage.downloadObject(
          'release-assets',
          artifact.logoStoragePath
        );
      } catch {
        /* logo is optional */
      }
    }

    if (artifact.signerSignatureStoragePath) {
      signerSigBuffer = await this.storage.downloadObject(
        'release-assets',
        artifact.signerSignatureStoragePath
      );
    }

    if (artifact.analystSignatureStoragePath) {
      try {
        analystSigBuffer = await this.storage.downloadObject(
          'release-assets',
          artifact.analystSignatureStoragePath
        );
      } catch {
        /* analyst sig is optional */
      }
    }

    const pdfData: ReleaseForPdf = {
      id: release.id,
      releaseSequence: release.releaseSequence,
      releaseType: release.releaseType,
      releasedAt: release.releasedAt,
      requisitionNumber: release.requisitionNumber,
      orderId: release.orderId,
      labName: release.labName,
      labAccreditationNumber: release.labAccreditationNumber,
      labDirectorName: release.labDirectorName,
      labDirectorCredentials: release.labDirectorCredentials,
      labAddress: release.labAddress,
      labCity: release.labCity,
      labPhones: this.labPhones(release.labPhoneNumbers, release.labPhone),
      labEmail: release.labEmail,
      reportDisclaimer: release.reportDisclaimer,
      clinicName: release.clinicName,
      clinicAddress: release.clinicAddress,
      clinicPhone: release.clinicPhone,
      patientName: release.patientName,
      patientSpecies: release.patientSpecies,
      patientSex: release.patientSex,
      patientBreed: release.patientBreed,
      patientAge: release.patientAge,
      patientAgeUnit: release.patientAgeUnit,
      ownerName: release.ownerName,
      ownerPhone: release.ownerPhone,
      orderPriority: release.orderPriority,
      orderCreatedAt: release.orderCreatedAt,
      orderClinicNotes: release.orderClinicNotes,
      signerName: release.signerName,
      signerTitle: release.signerTitle,
      signerSpecialty: release.signerSpecialty,
      signerUniversity: release.signerUniversity,
      signerRegistrationNumber: release.signerRegistrationNumber,
      analystName: release.analystName,
      analystTitle: release.analystTitle,
      analystUniversity: release.analystUniversity,
      orderingVetName: release.orderingVetName,
      orderingVetLicenseNumber: release.orderingVetLicenseNumber,
      observations: release.observations,
      reviewNotes: release.reviewNotes,
      logoBuffer,
      signerSignatureBuffer: signerSigBuffer,
      analystSignatureBuffer: analystSigBuffer,
      tests: release.tests.map((t) => ({
        catalogItemName: t.catalogItemName,
        catalogItemCode: t.catalogItemCode,
        department: t.department,
        specimenTypes: t.specimenTypes,
        specimenAccessionNumbers: t.specimenAccessionNumbers,
        observations: t.observations,
        analytes: t.analytes.map((a) => ({
          name: a.name,
          sectionName: a.sectionName,
          sortOrder: a.sortOrder,
          isHeader: a.isHeader,
          valueType: a.valueType,
          numericValue: a.numericValue,
          textValue: a.textValue,
          booleanValue: a.booleanValue,
          selectValue: a.selectValue,
          unit: a.unit,
          flag: a.flag,
          referenceSnapshot: a.referenceSnapshot as {
            displayText?: string;
            min?: number;
            max?: number;
          } | null,
        })),
      })),
    };

    const pdfBuffer = await this.renderer.render(pdfData);
    const storagePath = `${release.labTenantId}/${release.orderId}/${release.id}.pdf`;

    const exists = await this.storage.headObject('lab-reports', storagePath);
    if (!exists) {
      await this.storage.uploadPdf(storagePath, pdfBuffer);
    } else {
      const existing = await this.storage.downloadObject(
        'lab-reports',
        storagePath
      );
      if (!existing || existing.length < 100) {
        await this.storage.uploadPdf(storagePath, pdfBuffer);
      }
    }

    const verified = await this.storage.headObject('lab-reports', storagePath);
    if (!verified) {
      throw new Error(
        'Upload verification failed: object not found after upload'
      );
    }

    const result = await this.prisma.resultReportReleaseArtifact.updateMany({
      where: { id: artifact.id, claimToken: artifact.claimToken },
      data: {
        status: 'COMPLETED',
        storageUrl: storagePath,
        claimedAt: null,
        claimToken: null,
        errorMessage: null,
      },
    });

    if (result.count === 0) {
      this.logger.warn(
        `Artifact ${artifact.id} was reclaimed by another worker — discarding`
      );
    } else {
      this.logger.log(
        `PDF generated for release ${artifact.releaseId} → ${storagePath}`
      );
    }
  }

  private async recoverStale(): Promise<void> {
    const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);
    const reset = await this.prisma.resultReportReleaseArtifact.updateMany({
      where: {
        status: 'GENERATING',
        claimedAt: { lt: staleThreshold },
      },
      data: { status: 'PENDING', claimedAt: null, claimToken: null },
    });
    if (reset.count > 0) {
      this.logger.warn(`Recovered ${reset.count} stale GENERATING artifact(s)`);
    }
  }

  async retryArtifact(artifactId: string): Promise<void> {
    await this.prisma.resultReportReleaseArtifact.update({
      where: { id: artifactId },
      data: {
        status: 'PENDING',
        retryCount: 0,
        errorMessage: null,
        claimedAt: null,
        claimToken: null,
        nextRetryAt: null,
      },
    });
  }
}

import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { PdfRendererService } from './pdf-renderer.service';
import type { ReleaseForPdf } from './pdf-renderer.service';
import { phoneLabelForPdf } from '../lab/lab-contact.util';
import {
  CLINIC_REPORT_PDF_ARTIFACT,
  RELEASE_PDF_ARTIFACT,
  currentTests,
  latestNonAmendment,
} from '../lab/current-report.util';

const RELEASE_INCLUDE = {
  tests: {
    include: { analytes: { orderBy: { sortOrder: 'asc' as const } } },
  },
} satisfies Prisma.ResultReportReleaseInclude;

type ReleaseWithTests = Prisma.ResultReportReleaseGetPayload<{
  include: typeof RELEASE_INCLUDE;
}>;

const STALE_THRESHOLD_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 5_000;
// Stale recovery runs every STALE_CHECK_EVERY poll cycles (~60 s at 5 s/cycle).
const STALE_CHECK_EVERY = 12;
const MAX_RETRIES = 3;
const RETRY_RESET = {
  status: 'PENDING',
  retryCount: 0,
  errorMessage: null,
  claimedAt: null,
  claimToken: null,
  nextRetryAt: null,
} satisfies Prisma.ResultReportReleaseArtifactUpdateManyMutationInput;

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
        .map(
          (p) =>
            (p ?? {}) as {
              label?: unknown;
              number?: unknown;
              whatsapp?: unknown;
            }
        )
        .filter((p) => typeof p.number === 'string' && p.number)
        .map((p) => ({
          label: phoneLabelForPdf(p),
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
        artifact_type: string;
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
          AND  "artifactType"   IN (${RELEASE_PDF_ARTIFACT}, ${CLINIC_REPORT_PDF_ARTIFACT})
          AND  "retryCount"     < ${MAX_RETRIES}
          AND  (next_retry_at IS NULL OR next_retry_at <= NOW())
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING
        id,
        "releaseId"                    AS release_id,
        "artifactType"                 AS artifact_type,
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
      artifactType: row.artifact_type,
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
    artifactType: string;
    claimToken: string | null;
    logoStoragePath: string | null;
    signerSignatureStoragePath: string | null;
    analystSignatureStoragePath: string | null;
    retryCount: number;
  }): Promise<void> {
    const release = await this.prisma.resultReportRelease.findUniqueOrThrow({
      where: { id: artifact.releaseId },
      include: RELEASE_INCLUDE,
    });
    const isClinicReport = artifact.artifactType === CLINIC_REPORT_PDF_ARTIFACT;

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

    // Current report: identity, signer and analyst from this (newest)
    // release; tests, type and date as the clinic would know them
    const report = isClinicReport
      ? await this.clinicReportContent(release)
      : null;

    const pdfData: ReleaseForPdf = {
      id: release.id,
      releaseSequence: report ? null : release.releaseSequence,
      releaseType: report ? report.releaseType : release.releaseType,
      releasedAt: report ? report.releasedAt : release.releasedAt,
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
      observations: report ? report.observations : release.observations,
      reviewNotes: release.reviewNotes,
      pendingTestNames: report?.pendingTestNames ?? [],
      logoBuffer,
      signerSignatureBuffer: signerSigBuffer,
      analystSignatureBuffer: analystSigBuffer,
      tests: (report ? report.tests : release.tests).map((t) => ({
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
    const storagePath = `${release.labTenantId}/${release.orderId}/${
      release.id
    }${isClinicReport ? '-clinic' : ''}.pdf`;

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

  /**
   * Content of the clinic's current report as of `release`: the latest
   * snapshot of every test released up to it, headed by the newest
   * PARTIAL/FINAL release so an amendment never shows (type, date, note).
   */
  private async clinicReportContent(release: ReleaseWithTests) {
    const releases = await this.prisma.resultReportRelease.findMany({
      where: {
        reportId: release.reportId,
        releaseSequence: { lte: release.releaseSequence },
      },
      include: RELEASE_INCLUDE,
    });
    const tests = currentTests(releases);
    const head = latestNonAmendment(releases) ?? release;

    const released = new Set(tests.map((t) => t.sourceReportTestId));
    const reportTests = await this.prisma.resultReportTest.findMany({
      where: { reportId: release.reportId },
      select: {
        id: true,
        orderedTest: { select: { catalogItemName: true, status: true } },
      },
    });
    const pendingTestNames = reportTests
      .filter(
        (rt) => !released.has(rt.id) && rt.orderedTest?.status !== 'CANCELLED'
      )
      .map((rt) => rt.orderedTest?.catalogItemName ?? '')
      .filter(Boolean);

    return {
      tests,
      releaseType: head.releaseType,
      releasedAt: head.releasedAt,
      observations: head.observations,
      pendingTestNames,
    };
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

  /**
   * Re-queues a FAILED PDF. It re-renders the frozen release, so anyone who
   * can read the release may ask for it; a PDF that is pending, generating or
   * done is left alone (conditional update, so a racing worker isn't reset).
   */
  async retryArtifact(artifactId: string): Promise<void> {
    const { count } = await this.prisma.resultReportReleaseArtifact.updateMany({
      where: { id: artifactId, status: 'FAILED' },
      data: RETRY_RESET,
    });
    if (count === 0) {
      throw new ConflictException('Only a failed PDF can be retried.');
    }

    // The clinic's current report of the same release usually failed with it
    // and has no retry button of its own
    const artifact = await this.prisma.resultReportReleaseArtifact.findUnique({
      where: { id: artifactId },
      select: { releaseId: true },
    });
    if (artifact) {
      await this.prisma.resultReportReleaseArtifact.updateMany({
        where: {
          releaseId: artifact.releaseId,
          artifactType: CLINIC_REPORT_PDF_ARTIFACT,
          status: 'FAILED',
        },
        data: RETRY_RESET,
      });
    }
  }
}

/**
 * Queues the clinic's current-report PDF (artifactType CLINIC_REPORT_PDF) for
 * every report released before that PDF existed. Clinics of labs that keep
 * amendments silent download it instead of the per-release PDFs.
 *
 * One artifact on the newest release of each report, reusing that release's
 * snapshotted logo and signature images; the API's PDF worker renders it.
 * Reports that already have one are skipped, so it's safe to run again.
 *
 * Run once after the showAmendmentsToClinic migration is applied:
 *
 *   node apps/api/prisma/seeds/backfill-clinic-report-pdfs.mjs
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const reports = await prisma.resultReport.findMany({
    where: { releases: { some: {} } },
    select: {
      id: true,
      releases: {
        orderBy: { releaseSequence: 'desc' },
        take: 1,
        select: {
          id: true,
          artifacts: {
            select: {
              artifactType: true,
              logoStoragePath: true,
              signerSignatureStoragePath: true,
              analystSignatureStoragePath: true,
            },
          },
        },
      },
    },
  });

  const data = [];
  for (const report of reports) {
    const newest = report.releases[0];
    const types = newest.artifacts.map((a) => a.artifactType);
    if (types.includes('CLINIC_REPORT_PDF')) continue;

    const pdf = newest.artifacts.find((a) => a.artifactType === 'PDF');
    data.push({
      releaseId: newest.id,
      artifactType: 'CLINIC_REPORT_PDF',
      logoStoragePath: pdf?.logoStoragePath ?? null,
      signerSignatureStoragePath: pdf?.signerSignatureStoragePath ?? null,
      analystSignatureStoragePath: pdf?.analystSignatureStoragePath ?? null,
    });
  }

  const { count } = await prisma.resultReportReleaseArtifact.createMany({
    data,
    skipDuplicates: true,
  });
  console.log(
    `Done: ${count} current-report PDF(s) queued (${reports.length} released report(s) checked)`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

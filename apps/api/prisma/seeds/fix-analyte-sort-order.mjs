/**
 * Fix: normalise ResultTemplateAnalyte.sortOrder from section-relative to global.
 *
 * Before this fix, analyte sortOrder was 0-based within each section, so
 * analytes from different sections collided (e.g. Serie Roja analyte 0 vs
 * Serie Blanca analyte 0). This caused sections to interleave when rendered
 * because the report queries sort by sortOrder globally.
 *
 * This script:
 *   1. Fixes sortOrder on ResultTemplateAnalyte (grouped by version, ordered
 *      by section.sortOrder then analyte.sortOrder).
 *   2. Fixes sortOrder on ResultReportAnalyte for every existing report
 *      (using the linked template analyte's corrected sortOrder).
 *   3. Fixes sortOrder on ResultReportReleaseAnalyte for every existing
 *      release snapshot.
 *
 * Run:
 *   node apps/api/prisma/seeds/fix-analyte-sort-order.mjs
 *
 * Idempotent — running it twice produces the same result.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Step 1: Fix template analytes
  const versions = await prisma.resultTemplateVersion.findMany({
    select: { id: true },
  });

  let templatesFixed = 0;

  for (const version of versions) {
    const sections = await prisma.resultTemplateSection.findMany({
      where: { versionId: version.id },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });

    let globalOrder = 0;
    for (const section of sections) {
      const analytes = await prisma.resultTemplateAnalyte.findMany({
        where: { versionId: version.id, sectionId: section.id },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, sortOrder: true },
      });

      for (const analyte of analytes) {
        if (analyte.sortOrder !== globalOrder) {
          await prisma.resultTemplateAnalyte.update({
            where: { id: analyte.id },
            data: { sortOrder: globalOrder },
          });
        }
        globalOrder++;
      }
    }

    // Handle any analytes without a section
    const unsectioned = await prisma.resultTemplateAnalyte.findMany({
      where: { versionId: version.id, sectionId: null },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, sortOrder: true },
    });
    for (const analyte of unsectioned) {
      if (analyte.sortOrder !== globalOrder) {
        await prisma.resultTemplateAnalyte.update({
          where: { id: analyte.id },
          data: { sortOrder: globalOrder },
        });
      }
      globalOrder++;
    }

    templatesFixed++;
  }

  console.log(`Fixed sortOrder for ${templatesFixed} template versions.`);

  // Step 2: Fix report analytes using the corrected template sortOrder
  const reportAnalytes = await prisma.resultReportAnalyte.findMany({
    where: { templateAnalyteId: { not: null } },
    select: { id: true, templateAnalyteId: true, sortOrder: true },
  });

  const templateAnalyteMap = new Map();
  const templateAnalytes = await prisma.resultTemplateAnalyte.findMany({
    select: { id: true, sortOrder: true },
  });
  for (const ta of templateAnalytes) {
    templateAnalyteMap.set(ta.id, ta.sortOrder);
  }

  let reportFixed = 0;
  for (const ra of reportAnalytes) {
    const correctOrder = templateAnalyteMap.get(ra.templateAnalyteId);
    if (correctOrder != null && ra.sortOrder !== correctOrder) {
      await prisma.resultReportAnalyte.update({
        where: { id: ra.id },
        data: { sortOrder: correctOrder },
      });
      reportFixed++;
    }
  }

  console.log(`Fixed ${reportFixed} report analytes.`);

  // Step 3: Fix release snapshot analytes
  const releaseAnalytes = await prisma.resultReportReleaseAnalyte.findMany({
    select: { id: true, code: true, releaseTestId: true, sortOrder: true },
  });

  // Group release analytes by releaseTest, then map codes to corrected sortOrder
  const releaseTests = await prisma.resultReportReleaseTest.findMany({
    select: { id: true, sourceReportTestId: true },
  });
  const releaseTestToReportTest = new Map();
  for (const rt of releaseTests) {
    releaseTestToReportTest.set(rt.id, rt.sourceReportTestId);
  }

  // Build code->sortOrder map from report analytes (now corrected)
  const correctedReportAnalytes = await prisma.resultReportAnalyte.findMany({
    select: { code: true, sortOrder: true, reportTestId: true },
  });
  // key: reportTestId:code -> sortOrder
  const reportTestCodeOrder = new Map();
  for (const ra of correctedReportAnalytes) {
    reportTestCodeOrder.set(`${ra.reportTestId}:${ra.code}`, ra.sortOrder);
  }

  let releaseFixed = 0;
  for (const ra of releaseAnalytes) {
    const reportTestId = releaseTestToReportTest.get(ra.releaseTestId);
    if (!reportTestId) continue;
    const correctOrder = reportTestCodeOrder.get(`${reportTestId}:${ra.code}`);
    if (correctOrder != null && ra.sortOrder !== correctOrder) {
      await prisma.resultReportReleaseAnalyte.update({
        where: { id: ra.id },
        data: { sortOrder: correctOrder },
      });
      releaseFixed++;
    }
  }

  console.log(`Fixed ${releaseFixed} release snapshot analytes.`);
  console.log('Done.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

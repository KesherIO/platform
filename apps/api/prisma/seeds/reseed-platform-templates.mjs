/**
 * Drops ALL PLATFORM-scope result template definitions and re-seeds them
 * from the JSON files. Safe to run at any time — only affects PLATFORM
 * templates, not lab-customized ones.
 *
 * Run from workspace root:
 *   node apps/api/prisma/seeds/reseed-platform-templates.mjs
 */

import { PrismaClient } from '@prisma/client';
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

async function main() {
  // ── Step 1: delete report rows referencing PLATFORM templates ──────
  const platformDefs = await prisma.resultTemplateDefinition.findMany({
    where: { scope: 'PLATFORM' },
    select: { id: true },
  });
  const defIds = platformDefs.map((d) => d.id);

  if (defIds.length > 0) {
    // Delete release snapshots referencing PLATFORM templates
    const releaseTests = await prisma.resultReportReleaseTest.findMany({
      where: { templateDefinitionId: { in: defIds } },
      select: { id: true },
    });
    const rltIds = releaseTests.map((rt) => rt.id);

    if (rltIds.length > 0) {
      // Clear self-referencing amendment chain first
      await prisma.resultReportReleaseTest.updateMany({
        where: { id: { in: rltIds } },
        data: { amendsReleaseTestId: null },
      });

      const { count: releaseAnalytes } =
        await prisma.resultReportReleaseAnalyte.deleteMany({
          where: { releaseTestId: { in: rltIds } },
        });
      console.log(
        `✓ Deleted ${releaseAnalytes} release analytes referencing PLATFORM templates`
      );

      const { count: relTests } =
        await prisma.resultReportReleaseTest.deleteMany({
          where: { id: { in: rltIds } },
        });
      console.log(
        `✓ Deleted ${relTests} release tests referencing PLATFORM templates`
      );
    }

    // Delete report analytes + report tests referencing PLATFORM templates
    const reportTests = await prisma.resultReportTest.findMany({
      where: { templateDefinitionId: { in: defIds } },
      select: { id: true },
    });
    const rtIds = reportTests.map((rt) => rt.id);

    if (rtIds.length > 0) {
      const { count: analytes } = await prisma.resultReportAnalyte.deleteMany({
        where: { reportTestId: { in: rtIds } },
      });
      console.log(
        `✓ Deleted ${analytes} report analytes referencing PLATFORM templates`
      );
    }

    const { count: rts } = await prisma.resultReportTest.deleteMany({
      where: { templateDefinitionId: { in: defIds } },
    });
    console.log(`✓ Deleted ${rts} report tests referencing PLATFORM templates`);
  }

  // ── Step 2: delete all PLATFORM template definitions ───────────────
  // Null out activeVersionId first to break the self-referencing FK
  await prisma.resultTemplateDefinition.updateMany({
    where: { scope: 'PLATFORM' },
    data: { activeVersionId: null },
  });

  const { count } = await prisma.resultTemplateDefinition.deleteMany({
    where: { scope: 'PLATFORM' },
  });
  console.log(`✓ Deleted ${count} PLATFORM template definitions`);

  // ── Step 2: re-seed from JSON files ────────────────────────────────
  const templatesDir = join(__dirname, 'templates');
  const files = readdirSync(templatesDir).filter((f) => f.endsWith('.json'));
  console.log(`Found ${files.length} template files. Seeding...`);

  let created = 0;

  for (const file of files) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(join(templatesDir, file), 'utf-8'));
    } catch {
      console.warn(`  ⚠ Skipping ${file} — invalid or empty JSON`);
      continue;
    }

    const {
      catalogItemCode,
      species,
      title,
      defaultObservations,
      observationPhrases,
      sections = [],
    } = raw;

    const ageMin = raw.ageMinWeeks ?? -1;
    const ageMax = raw.ageMaxWeeks ?? -1;

    await prisma.$transaction(async (tx) => {
      const definition = await tx.resultTemplateDefinition.create({
        data: {
          catalogItemCode,
          species,
          ageMinWeeks: ageMin,
          ageMaxWeeks: ageMax,
          scope: 'PLATFORM',
          ownerKey: 'platform',
        },
      });

      const version = await tx.resultTemplateVersion.create({
        data: {
          definitionId: definition.id,
          version: 1,
          title,
          status: 'PUBLISHED',
          defaultObservations: defaultObservations ?? null,
          observationPhrases: observationPhrases ?? undefined,
          publishedAt: new Date(),
        },
      });

      for (const section of sections) {
        const newSection = await tx.resultTemplateSection.create({
          data: {
            versionId: version.id,
            name: section.name,
            code: section.code ?? null,
            sortOrder: section.sortOrder,
          },
        });

        for (const analyte of section.analytes ?? []) {
          await tx.resultTemplateAnalyte.create({
            data: {
              versionId: version.id,
              sectionId: newSection.id,
              code: analyte.code,
              name: analyte.name,
              technique: analyte.technique ?? null,
              valueType: analyte.valueType,
              unit: analyte.unit ?? null,
              options: analyte.options ?? [],
              sortOrder: analyte.sortOrder,
              isHeader: analyte.isHeader ?? false,
              isRequired: analyte.isRequired ?? true,
              formula: analyte.formula ?? null,
              referenceRange: analyte.referenceRange ?? undefined,
            },
          });
        }
      }

      await tx.resultTemplateDefinition.update({
        where: { id: definition.id },
        data: { activeVersionId: version.id },
      });
    });

    created++;
    process.stdout.write(`\r  ${created}/${files.length} processed...`);
  }

  console.log(`\nDone: ${created} PLATFORM templates created.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

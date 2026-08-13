/**
 * Migration: ResultTemplate → ResultTemplateDefinition + ResultTemplateVersion
 *
 * Migrates existing result_templates into the new versioned template schema.
 * Each old template becomes one PLATFORM definition + one PUBLISHED version.
 * Sections and analytes are duplicated under the new version (old rows remain for
 * backward compatibility until the old model is dropped).
 *
 * Also migrates narrative analytes from TEXT → LONG_TEXT.
 *
 * Run once after the first db push that adds the new models:
 *   node apps/api/prisma/seeds/migrate-templates-to-definitions.mjs
 *
 * Idempotent — skips definitions that already exist.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const LONG_TEXT_CODES = new Set([
  'HISTOPATH_MACRO',
  'HISTOPATH_MICRO',
  'HISTOPATH_DX',
  'CYTOLOGY',
  'CYTO_PAS',
  'CYTOSP_MICRO',
  'CYTOSP_DX',
  'KOHC_CYTO',
  'KOHC_IMPRESION',
]);

async function main() {
  const templates = await prisma.resultTemplate.findMany({
    include: {
      catalogItem: true,
      sections: {
        include: { analytes: true },
        orderBy: { sortOrder: 'asc' },
      },
      analytes: { orderBy: { sortOrder: 'asc' } },
    },
  });

  console.log(`Found ${templates.length} existing templates to migrate.`);

  let created = 0;
  let skipped = 0;
  let sectionsCount = 0;
  let analytesCount = 0;
  let longTextCount = 0;

  for (const t of templates) {
    const catalogItemCode = t.catalogItem.code;
    if (!catalogItemCode) {
      console.warn(`  SKIP template ${t.id} — catalogItem ${t.catalogItem.id} has no code`);
      skipped++;
      continue;
    }

    const ageMin = t.ageMinWeeks ?? -1;
    const ageMax = t.ageMaxWeeks ?? -1;

    const existing = await prisma.resultTemplateDefinition.findUnique({
      where: {
        catalogItemCode_species_ageMinWeeks_ageMaxWeeks_ownerKey: {
          catalogItemCode,
          species: t.species,
          ageMinWeeks: ageMin,
          ageMaxWeeks: ageMax,
          ownerKey: 'platform',
        },
      },
    });

    if (existing) {
      console.log(`  SKIP ${catalogItemCode} / ${t.species} / ${ageMin}-${ageMax} — already exists`);
      skipped++;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const definition = await tx.resultTemplateDefinition.create({
        data: {
          catalogItemCode,
          species: t.species,
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
          title: t.title,
          status: 'PUBLISHED',
          defaultObservations: t.defaultObservations,
          publishedAt: new Date(),
        },
      });

      const sectionIdMap = new Map();

      for (const section of t.sections) {
        const newSection = await tx.resultTemplateSection.create({
          data: {
            versionId: version.id,
            name: section.name,
            sortOrder: section.sortOrder,
          },
        });
        sectionIdMap.set(section.id, newSection.id);
        sectionsCount++;
      }

      for (const analyte of t.analytes) {
        const valueType = LONG_TEXT_CODES.has(analyte.code) && analyte.valueType === 'TEXT'
          ? 'LONG_TEXT'
          : analyte.valueType;

        if (valueType === 'LONG_TEXT') longTextCount++;

        await tx.resultTemplateAnalyte.create({
          data: {
            versionId: version.id,
            sectionId: analyte.sectionId ? sectionIdMap.get(analyte.sectionId) ?? null : null,
            code: analyte.code,
            name: analyte.name,
            technique: analyte.technique,
            valueType,
            unit: analyte.unit,
            options: analyte.options,
            sortOrder: analyte.sortOrder,
            isHeader: analyte.isHeader,
            formula: analyte.formula,
            referenceRange: analyte.referenceRange ?? undefined,
          },
        });
        analytesCount++;
      }

      await tx.resultTemplateDefinition.update({
        where: { id: definition.id },
        data: { activeVersionId: version.id },
      });
    });

    created++;
    if (created % 20 === 0) console.log(`  … migrated ${created} templates`);
  }

  console.log('\n=== Migration complete ===');
  console.log(`  Definitions created: ${created}`);
  console.log(`  Skipped (already exist or no code): ${skipped}`);
  console.log(`  Sections created: ${sectionsCount}`);
  console.log(`  Analytes created: ${analytesCount}`);
  console.log(`  Analytes migrated to LONG_TEXT: ${longTextCount}`);
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

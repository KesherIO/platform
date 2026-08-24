/**
 * Seed: loads all platform result templates from templates/*.json into the DB
 * as PLATFORM-scope ResultTemplateDefinition + PUBLISHED ResultTemplateVersion.
 *
 * Run from the workspace root:
 *   node apps/api/prisma/seeds/seed-platform-templates.mjs
 *
 * Idempotent — skips definitions that already exist.
 * Run after seed-platform-catalog.mjs (catalog codes must match template codes).
 */

import { PrismaClient } from '@prisma/client';
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

async function main() {
  const templatesDir = join(__dirname, 'templates');
  const files = readdirSync(templatesDir).filter((f) => f.endsWith('.json'));

  console.log(`Found ${files.length} template files.`);

  let created = 0;
  let skipped = 0;

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
      sections = [],
    } = raw;

    const ageMin = raw.ageMinWeeks ?? -1;
    const ageMax = raw.ageMaxWeeks ?? -1;

    // Idempotency check
    const existing = await prisma.resultTemplateDefinition.findUnique({
      where: {
        catalogItemCode_species_ageMinWeeks_ageMaxWeeks_ownerKey: {
          catalogItemCode,
          species,
          ageMinWeeks: ageMin,
          ageMaxWeeks: ageMax,
          ownerKey: 'platform',
        },
      },
    });

    if (existing) {
      skipped++;
      continue;
    }

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
          publishedAt: new Date(),
        },
      });

      for (const section of sections) {
        const newSection = await tx.resultTemplateSection.create({
          data: {
            versionId: version.id,
            name: section.name,
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
              formula: analyte.formula ?? null,
              referenceRange: analyte.referenceRange ?? undefined,
            },
          });
        }
      }

      // Point the definition at its active (published) version
      await tx.resultTemplateDefinition.update({
        where: { id: definition.id },
        data: { activeVersionId: version.id },
      });
    });

    created++;
    process.stdout.write(
      `\r  ${created + skipped}/${files.length} processed...`
    );
  }

  console.log(
    `\nDone: ${created} created, ${skipped} already existed (${files.length} total).`
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

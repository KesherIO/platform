/**
 * Sets isRequired = false on every template analyte that the seed JSON in
 * templates/*.json marks as `"isRequired": false` — across ALL versions
 * (draft/published/archived) and ALL owners (platform + lab tenant copies).
 *
 * Matching is by (definition.catalogItemCode, analyte.code), because the same
 * analyte code can be optional in one test and required in another
 * (e.g. TP is optional inside CBC but required in TP-SER).
 *
 * Needed because the lab Template Builder used to drop isRequired on save,
 * and the API defaults a missing value to true. Safe to run multiple times.
 *
 *   node apps/api/prisma/seeds/patch-optional-analytes.mjs
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

  // catalogItemCode → Set<analyte code>
  const optionalByCatalog = new Map();

  for (const file of files) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(join(templatesDir, file), 'utf-8'));
    } catch {
      console.warn(`  ⚠ Skipping ${file} — invalid or empty JSON`);
      continue;
    }

    for (const section of raw.sections ?? []) {
      for (const analyte of section.analytes ?? []) {
        if (analyte.isRequired !== false) continue;
        if (!optionalByCatalog.has(raw.catalogItemCode)) {
          optionalByCatalog.set(raw.catalogItemCode, new Set());
        }
        optionalByCatalog.get(raw.catalogItemCode).add(analyte.code);
      }
    }
  }

  let total = 0;
  for (const [catalogItemCode, codes] of optionalByCatalog) {
    const result = await prisma.resultTemplateAnalyte.updateMany({
      where: {
        code: { in: [...codes] },
        isRequired: true,
        version: { definition: { catalogItemCode } },
      },
      data: { isRequired: false },
    });
    total += result.count;
    console.log(
      `  ${catalogItemCode}: [${[...codes].join(', ')}] → ${
        result.count
      } row(s) updated`
    );
  }

  console.log(`Done: ${total} analyte(s) → isRequired = false`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

/**
 * Sets isRequired = false for CULT_SENSIBLE and CULT_RESISTENTE across all
 * template versions that contain them. Safe to run multiple times.
 *
 *   node apps/api/prisma/seeds/patch-culture-antibiogram-optional.mjs
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.resultTemplateAnalyte.updateMany({
    where: { code: { in: ['CULT_SENSIBLE', 'CULT_RESISTENTE'] } },
    data: { isRequired: false },
  });

  console.log(`Updated ${result.count} analyte(s) → isRequired = false`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

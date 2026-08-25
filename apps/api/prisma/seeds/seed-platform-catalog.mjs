/**
 * Seed: imports the platform catalog (catalog.json) into the first LAB tenant.
 *
 * Run from the workspace root:
 *   node apps/api/prisma/seeds/seed-platform-catalog.mjs
 *
 * Idempotent — upserts by code, safe to re-run.
 * Requires a LAB tenant to exist (run seed-lab-tenant.mjs first).
 */

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

async function main() {
  const lab = await prisma.tenant.findFirst({ where: { type: 'LAB' } });
  if (!lab) {
    console.error('No LAB tenant found. Run seed-lab-tenant.mjs first.');
    process.exit(1);
  }
  console.log(`Seeding platform catalog for: ${lab.name} (${lab.id})`);

  const { items } = JSON.parse(
    readFileSync(join(__dirname, 'catalog.json'), 'utf-8')
  );

  let created = 0;
  let updated = 0;

  await prisma.$transaction(
    async (tx) => {
      const idByCode = new Map();
      const idByName = new Map();

      // Pass 1: upsert all items (tests + packages)
      for (const item of items) {
        const data = {
          labTenantId: lab.id,
          kind: item.kind,
          name: item.name,
          code: item.code ?? null,
          description: item.description ?? null,
          category: item.category ?? null,
          turnaroundHours: item.turnaroundHours ?? null,
          resultType: item.resultType ?? null,
          unit: item.unit ?? null,
        };

        let record;
        if (item.code) {
          const existing = await tx.catalogItem.findFirst({
            where: { code: item.code, labTenantId: lab.id },
            select: { id: true },
          });
          if (existing) {
            record = await tx.catalogItem.update({
              where: { id: existing.id },
              data,
              select: { id: true },
            });
            updated++;
          } else {
            record = await tx.catalogItem.create({
              data,
              select: { id: true },
            });
            created++;
          }
          idByCode.set(item.code, record.id);
        } else {
          const existing = await tx.catalogItem.findFirst({
            where: { name: item.name, labTenantId: lab.id },
            select: { id: true },
          });
          if (existing) {
            record = await tx.catalogItem.update({
              where: { id: existing.id },
              data,
              select: { id: true },
            });
            updated++;
          } else {
            record = await tx.catalogItem.create({
              data,
              select: { id: true },
            });
            created++;
          }
          idByName.set(item.name, record.id);
        }
      }

      // Pass 2: wire package compositions
      for (const item of items) {
        if (item.kind !== 'PACKAGE' || !item.componentCodes?.length) continue;

        const packageId = item.code
          ? idByCode.get(item.code)
          : idByName.get(item.name);
        if (!packageId) continue;

        const components = await tx.catalogItem.findMany({
          where: { code: { in: item.componentCodes }, labTenantId: lab.id },
          select: { id: true, code: true },
        });

        const missing = item.componentCodes.filter(
          (c) => !components.find((comp) => comp.code === c)
        );
        if (missing.length > 0) {
          console.warn(
            `  ⚠ Missing component codes for "${item.name}": ${missing.join(
              ', '
            )}`
          );
          continue;
        }

        await tx.catalogItemComposition.deleteMany({ where: { packageId } });
        await tx.catalogItemComposition.createMany({
          data: components.map((c) => ({ packageId, componentId: c.id })),
        });
      }
    },
    { timeout: 60_000 }
  );

  console.log(
    `Done: ${created} created, ${updated} updated (${items.length} total items).`
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

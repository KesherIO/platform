/**
 * Dev reset: wipes all lab and clinic operational data so you can start fresh.
 *
 * Deletes (for the first LAB tenant found):
 *   - All orders (cascades → ordered tests, specimens, timeline events, results)
 *   - All catalog items (cascades → compositions)
 *   - All LABORATORY-scope result template definitions (cascades → versions, sections, analytes)
 *
 * Deletes (for all CLINIC tenants):
 *   - All cases (cascades → case catalog item selections, orders)
 *
 * Keeps:
 *   - Lab/clinic tenants, users, profiles, clinic-lab connections
 *   - PLATFORM-scope result templates (shared, not lab-owned)
 *
 * After running, go to Lab portal → Catalog → "Import Platform Catalog".
 *
 * Run from workspace root:
 *   node apps/api/prisma/seeds/reset-lab-data.mjs
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const lab = await prisma.tenant.findFirst({ where: { type: 'LAB' } });
  if (!lab) {
    console.error('No LAB tenant found.');
    process.exit(1);
  }

  console.log(`\nResetting lab: ${lab.name} (${lab.id})`);
  console.log('─'.repeat(50));

  // 1. Orders (cascade → ordered tests, specimens, timeline events, results, reports)
  const { count: orders } = await prisma.order.deleteMany({
    where: { labTenantId: lab.id },
  });
  console.log(`✓ Deleted ${orders} orders (and all child records)`);

  // 2. Lab-scope template definitions
  //    Must null activeVersionId first to break the FK self-reference.
  await prisma.resultTemplateDefinition.updateMany({
    where: { scope: 'LABORATORY', labTenantId: lab.id },
    data: { activeVersionId: null },
  });
  const { count: templates } = await prisma.resultTemplateDefinition.deleteMany(
    {
      where: { scope: 'LABORATORY', labTenantId: lab.id },
    }
  );
  console.log(`✓ Deleted ${templates} lab-scope result templates`);

  // 3. Catalog items (cascade → compositions, case-catalog-item links)
  //    LabTestConfiguration has a non-cascading FK to CatalogItem, delete first.
  const { count: testConfigs } = await prisma.labTestConfiguration.deleteMany({
    where: { labTenantId: lab.id },
  });
  if (testConfigs > 0)
    console.log(`✓ Deleted ${testConfigs} test configurations`);

  const { count: catalogItems } = await prisma.catalogItem.deleteMany({
    where: { labTenantId: lab.id },
  });
  console.log(`✓ Deleted ${catalogItems} catalog items`);

  // 4. Cases for all clinic tenants (cascades → case catalog item selections)
  //    Orders already deleted above via labTenantId, so no FK conflict.
  const clinics = await prisma.tenant.findMany({ where: { type: 'CLINIC' } });
  let totalCases = 0;
  for (const clinic of clinics) {
    const { count } = await prisma.case.deleteMany({
      where: { tenantId: clinic.id },
    });
    totalCases += count;
  }
  console.log(
    `✓ Deleted ${totalCases} cases across ${clinics.length} clinic(s)`
  );

  console.log('─'.repeat(50));
  console.log('Done. Platform templates are untouched.');
  console.log('Next: go to Lab portal → Catalog → "Import Platform Catalog"\n');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

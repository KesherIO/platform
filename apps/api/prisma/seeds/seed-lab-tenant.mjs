/**
 * Seed: creates the KesherIO lab tenant and connects all existing clinic tenants to it.
 *
 * Run ONCE after migration 20260711000005 is applied:
 *   node apps/api/prisma/seeds/seed-lab-tenant.mjs
 *
 * The script is idempotent — safe to re-run.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. Create (or find) the KesherIO lab tenant
  let platform = await prisma.tenant.findFirst({
    where: { type: 'PLATFORM' },
  });

  if (!platform) {
    platform = await prisma.tenant.create({
      data: {
        name: 'KesherIO Laboratorio',
        slug: 'kesherio-lab',
        type: 'PLATFORM',
        email: 'lab@kesherio.com',
        country: 'CO',
      },
    });
    console.log('Created KesherIO lab tenant:', platform.id);
  } else {
    console.log('KesherIO lab tenant already exists:', platform.id);
  }

  // 2. Create default LaboratoryProfile for KesherIO
  await prisma.laboratoryProfile.upsert({
    where: { tenantId: platform.id },
    create: {
      tenantId: platform.id,
      directorName: 'Director Técnico KesherIO',
      defaultObservations: 'Resultado emitido por KesherIO Laboratorio.',
      updatedAt: new Date(),
    },
    update: {},
  });
  console.log('Laboratory profile ensured for KesherIO');

  // 3. Assign all existing orders to KesherIO lab (backfill labTenantId)
  const updated = await prisma.order.updateMany({
    where: { labTenantId: null },
    data: { labTenantId: platform.id },
  });
  console.log(
    `Backfilled ${updated.count} orders with labTenantId = ${platform.id}`
  );

  // 4. Create ClinicLabConnection for all clinic tenants
  const clinics = await prisma.tenant.findMany({
    where: { type: 'CLINIC' },
    select: { id: true, name: true },
  });

  let connected = 0;
  for (const clinic of clinics) {
    await prisma.clinicLabConnection.upsert({
      where: { clinicId_labId: { clinicId: clinic.id, labId: platform.id } },
      create: {
        clinicId: clinic.id,
        labId: platform.id,
        isDefault: true,
        isActive: true,
        updatedAt: new Date(),
      },
      update: {},
    });
    connected++;
  }
  console.log(`Connected ${connected} clinic(s) to KesherIO lab`);
  console.log('\nKesherIO lab tenant ID:');
  console.log(platform.id);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

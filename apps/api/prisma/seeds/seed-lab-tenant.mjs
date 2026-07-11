/**
 * Seed: creates the Biomet lab tenant and connects all existing clinic tenants to it.
 *
 * Run ONCE after migration 20260711000005 is applied:
 *   node apps/api/prisma/seeds/seed-lab-tenant.mjs
 *
 * The script is idempotent — safe to re-run.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. Create (or find) the Biomet lab tenant
  let biomet = await prisma.tenant.findFirst({
    where: { type: 'VETAI' },
  });

  if (!biomet) {
    biomet = await prisma.tenant.create({
      data: {
        name: 'Biomet VetAI Laboratorio',
        slug: 'biomet-lab',
        type: 'VETAI',
        email: 'lab@biomet.co',
        country: 'CO',
      },
    });
    console.log('Created Biomet lab tenant:', biomet.id);
  } else {
    console.log('Biomet lab tenant already exists:', biomet.id);
  }

  // 2. Create default LaboratoryProfile for Biomet
  await prisma.laboratoryProfile.upsert({
    where: { tenantId: biomet.id },
    create: {
      tenantId: biomet.id,
      directorName: 'Director Técnico Biomet',
      defaultObservations: 'Resultado emitido por Biomet VetAI Laboratorio.',
      updatedAt: new Date(),
    },
    update: {},
  });
  console.log('Laboratory profile ensured for Biomet');

  // 3. Assign all existing orders to Biomet lab (backfill labTenantId)
  const updated = await prisma.order.updateMany({
    where: { labTenantId: null },
    data: { labTenantId: biomet.id },
  });
  console.log(
    `Backfilled ${updated.count} orders with labTenantId = ${biomet.id}`
  );

  // 4. Create ClinicLabConnection for all clinic tenants
  const clinics = await prisma.tenant.findMany({
    where: { type: 'CLINIC' },
    select: { id: true, name: true },
  });

  let connected = 0;
  for (const clinic of clinics) {
    await prisma.clinicLabConnection.upsert({
      where: { clinicId_labId: { clinicId: clinic.id, labId: biomet.id } },
      create: {
        clinicId: clinic.id,
        labId: biomet.id,
        isDefault: true,
        isActive: true,
        updatedAt: new Date(),
      },
      update: {},
    });
    connected++;
  }
  console.log(`Connected ${connected} clinic(s) to Biomet lab`);
  console.log(
    '\nBiomet lab tenant ID (add to lab app localStorage as labTenantId):'
  );
  console.log(biomet.id);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

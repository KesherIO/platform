/**
 * Dev cleanup: deletes the clients one lab created with bulk import, so the
 * same file can be imported again (docs/CLIENT_BULK_IMPORT_PLAN.md, phase 4).
 *
 * A client counts as imported when its connection to the lab has an
 * importBatchId. Each one goes through the same rules as the lab's
 * "Delete client" (LabClientsService.deleteClient — keep the two in sync):
 * only clients that are still just this lab's pending invitation are deleted.
 * Clients with users (onboarded), orders, or another lab are skipped.
 *
 * Prints counts only — never client names or emails.
 *
 * Run from apps/api (Node 22+):
 *   node prisma/seeds/delete-imported-clients.mjs                  # labs with imported clients
 *   node prisma/seeds/delete-imported-clients.mjs --lab=<labId>    # dry run for one lab
 *   node prisma/seeds/delete-imported-clients.mjs --lab=<labId> --confirm
 *
 * Optional: --batch=<importBatchId> limits it to one import.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');

const arg = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const LAB_ID = arg('lab');
const BATCH_ID = arg('batch');
const CONFIRM = process.argv.includes('--confirm');

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

// ── Project guard: never production ─────────────────────────────────────────
const refOf = (value) =>
  value.match(/postgres(?:ql)?:\/\/postgres\.([a-z0-9]{20})[:@]/)?.[1] ??
  value.match(/@db\.([a-z0-9]{20})\.supabase\.co/)?.[1] ??
  value.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co/)?.[1] ??
  null;

const prodEnv = readFileSync(
  join(repoRoot, 'apps/frontend/src/environments/environment.production.ts'),
  'utf8'
);
const prodRef = refOf(prodEnv.match(/supabaseUrl:\s*'([^']+)'/)?.[1] ?? '');
const dbRef = refOf(process.env.DATABASE_URL ?? '');
if (!prodRef) fail('Could not read the production project ref.');
if (!dbRef) fail('Could not read the project ref from DATABASE_URL.');
if (dbRef === prodRef)
  fail(`Refusing to run: ${dbRef} is the PRODUCTION project.`);
console.log(`Target project: ${dbRef} (not production) ✔`);

const prisma = new PrismaClient();

/** Same options as client creation (CLIENT_CREATE_TX_OPTIONS). */
const TX_OPTIONS = { maxWait: 5000, timeout: 10000 };

async function listLabs() {
  const groups = await prisma.clinicLabConnection.groupBy({
    by: ['labId'],
    where: { importBatchId: { not: null } },
    _count: { _all: true },
  });
  if (groups.length === 0) {
    console.log('\nNo imported clients in this database.');
    return;
  }
  const labs = await prisma.tenant.findMany({
    where: { id: { in: groups.map((g) => g.labId) } },
    select: { id: true, name: true },
  });
  console.log('\nLabs with imported clients:');
  for (const g of groups) {
    const lab = labs.find((l) => l.id === g.labId);
    console.log(`  ${g.labId}  ${lab?.name ?? '?'}  — ${g._count._all}`);
  }
  console.log('\nRe-run with --lab=<labId> for a dry run.');
}

/** Why a client can't be deleted, or null — LabClientsService.deleteClient. */
async function blocker(db, labId, clinicId) {
  const [otherLabs, members, orders] = await Promise.all([
    db.clinicLabConnection.count({
      where: { clinicId, labId: { not: labId } },
    }),
    db.userTenantMembership.count({ where: { tenantId: clinicId } }),
    db.order.count({ where: { tenantId: clinicId } }),
  ]);
  if (otherLabs > 0) return 'connected to another lab';
  if (members > 0) return 'onboarded (has users)';
  if (orders > 0) return 'has orders';
  return null;
}

async function deleteClient(labId, clinicId) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${clinicId} FOR UPDATE`;
    const reason = await blocker(tx, labId, clinicId);
    if (reason) return reason;

    await tx.onboardingToken.updateMany({
      where: {
        laboratoryId: labId,
        clinicTenantId: clinicId,
        used: false,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    await tx.clinicLabConnection.deleteMany({ where: { clinicId, labId } });
    await tx.tenant.delete({ where: { id: clinicId } });
    return null;
  }, TX_OPTIONS);
}

async function main() {
  if (!LAB_ID) return listLabs();

  const lab = await prisma.tenant.findUnique({
    where: { id: LAB_ID },
    select: { name: true, type: true },
  });
  if (!lab || lab.type !== 'LAB') fail(`No LAB tenant with id ${LAB_ID}.`);

  const connections = await prisma.clinicLabConnection.findMany({
    where: {
      labId: LAB_ID,
      importBatchId: BATCH_ID ? BATCH_ID : { not: null },
    },
    select: { clinicId: true },
  });

  console.log(
    `\nLab: ${lab.name} (${LAB_ID})${BATCH_ID ? `, batch ${BATCH_ID}` : ''}`
  );
  console.log(`Imported clients found: ${connections.length}`);
  console.log(CONFIRM ? 'Mode: DELETE' : 'Mode: dry run (nothing is deleted)');
  console.log('─'.repeat(50));

  let deleted = 0;
  const skipped = {};
  for (const { clinicId } of connections) {
    const reason = CONFIRM
      ? await deleteClient(LAB_ID, clinicId)
      : await blocker(prisma, LAB_ID, clinicId);
    if (reason) skipped[reason] = (skipped[reason] ?? 0) + 1;
    else deleted++;
  }

  console.log(`${CONFIRM ? 'Deleted' : 'Would delete'}: ${deleted}`);
  for (const [reason, count] of Object.entries(skipped)) {
    console.log(`Skipped, ${reason}: ${count}`);
  }
  if (!CONFIRM && deleted > 0) {
    console.log('\nRe-run with --confirm to delete them.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

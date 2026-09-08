/**
 * Full dev reset: nukes ALL operational data, tenants, users, and Supabase Auth
 * users so you can start completely from scratch (fresh onboarding).
 *
 * PRESERVES:
 *   - PLATFORM-scope result template definitions (+ versions, sections, analytes)
 *   - Knowledge base (KnowledgeDocument + KnowledgeChunk — RAG embeddings)
 *   - Prisma migrations
 *
 * DELETES EVERYTHING ELSE:
 *   - All result reports, releases, amendments, analytes
 *   - All orders, ordered tests, specimens, pickups, timeline events
 *   - All cases
 *   - All catalog items (re-seed with seed-platform-catalog.mjs after)
 *   - All lab test configs, analyzers, lab signers, laboratory profiles
 *   - All vet verifications, profiles, credentials
 *   - All clinic-lab connections
 *   - All memberships, invitations, onboarding tokens, push subscriptions
 *   - All tenants (LAB + CLINIC + PLATFORM)
 *   - All users (DB + Supabase Auth)
 *   - Counter table reset
 *
 * After running:
 *   1. node apps/api/prisma/seeds/seed-lab-tenant.mjs
 *   2. node apps/api/prisma/seeds/seed-platform-catalog.mjs
 *   3. node apps/api/prisma/seeds/seed-platform-templates.mjs   (re-links to new lab)
 *   4. Go to the app and onboard fresh
 *
 * Run from workspace root:
 *   node apps/api/prisma/seeds/reset-full.mjs
 */

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { createInterface } from 'readline';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

function loadEnv() {
  const envPath = join(__dirname, '../../.env');
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}

async function deleteSupabaseUsers() {
  loadEnv();

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn(
      '⚠  SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — skipping Supabase Auth wipe'
    );
    return 0;
  }

  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };

  let deleted = 0;
  let page = 1;
  const perPage = 50;

  while (true) {
    const res = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
      { headers }
    );
    if (!res.ok) {
      console.warn(`⚠  Failed to list Supabase users (${res.status})`);
      break;
    }
    const body = await res.json();
    const users = body.users || body;
    if (!Array.isArray(users) || users.length === 0) break;

    for (const user of users) {
      const delRes = await fetch(
        `${supabaseUrl}/auth/v1/admin/users/${user.id}`,
        { method: 'DELETE', headers }
      );
      if (delRes.ok) {
        deleted++;
      } else {
        console.warn(
          `  ⚠  Failed to delete auth user ${user.email} (${delRes.status})`
        );
      }
    }

    if (users.length < perPage) break;
    page++;
  }

  return deleted;
}

async function confirmReset() {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ Refusing to run in production. Aborting.');
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) =>
    rl.question(
      '⚠️  This will DELETE all tenants, users, orders, cases, and Supabase Auth users.\n' +
        '   Platform templates and knowledge base will be preserved.\n\n' +
        '   Type RESET to confirm: ',
      resolve
    )
  );
  rl.close();

  if (answer.trim() !== 'RESET') {
    console.log('Aborted.');
    process.exit(0);
  }
}

async function main() {
  await confirmReset();

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║        FULL DEV RESET — POINT OF NO RETURN      ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // ── 1. Amendment analytes & amendments ──
  const { count: amendAnalytes } =
    await prisma.resultReportAmendmentAnalyte.deleteMany();
  const { count: amendments } = await prisma.resultReportAmendment.deleteMany();
  console.log(
    `✓ Deleted ${amendments} amendments (${amendAnalytes} amendment analytes)`
  );

  // ── 2. Release artifacts, release analytes, release tests, releases ──
  const { count: releaseArtifacts } =
    await prisma.resultReportReleaseArtifact.deleteMany();
  const { count: releaseAnalytes } =
    await prisma.resultReportReleaseAnalyte.deleteMany();
  // Clear latestReleaseId FK on ResultReportTest before deleting releases
  await prisma.resultReportTest.updateMany({
    where: { latestReleaseId: { not: null } },
    data: { latestReleaseId: null },
  });
  const { count: releaseTests } =
    await prisma.resultReportReleaseTest.deleteMany();
  const { count: releases } = await prisma.resultReportRelease.deleteMany();
  console.log(
    `✓ Deleted ${releases} releases (${releaseTests} test snapshots, ${releaseAnalytes} analyte snapshots, ${releaseArtifacts} artifacts)`
  );

  // ── 3. Report analytes, report tests, AI interpretations, reports ──
  const { count: reportAnalytes } =
    await prisma.resultReportAnalyte.deleteMany();
  const { count: reportTests } = await prisma.resultReportTest.deleteMany();
  const { count: aiInterps } = await prisma.aiInterpretation.deleteMany();
  const { count: reports } = await prisma.resultReport.deleteMany();
  console.log(
    `✓ Deleted ${reports} result reports (${reportTests} tests, ${reportAnalytes} analytes, ${aiInterps} AI interpretations)`
  );

  // ── 4. Pickup timeline events, pickups ──
  const { count: timelineEvents } = await prisma.timelineEvent.deleteMany();
  const { count: pickups } = await prisma.pickup.deleteMany();
  console.log(
    `✓ Deleted ${pickups} pickups (${timelineEvents} timeline events)`
  );

  // ── 5. Specimen links, specimens ──
  const { count: otSpecimens } = await prisma.orderedTestSpecimen.deleteMany();
  const { count: specimens } = await prisma.specimen.deleteMany();
  console.log(
    `✓ Deleted ${specimens} specimens (${otSpecimens} test-specimen links)`
  );

  // ── 6. Ordered test sources, ordered tests ──
  const { count: otSources } = await prisma.orderedTestSource.deleteMany();
  const { count: orderedTests } = await prisma.orderedTest.deleteMany();
  console.log(`✓ Deleted ${orderedTests} ordered tests (${otSources} sources)`);

  // ── 7. Orders ──
  const { count: orders } = await prisma.order.deleteMany();
  console.log(`✓ Deleted ${orders} orders`);

  // ── 8. Case catalog items, cases ──
  const { count: caseCatalogItems } = await prisma.caseCatalogItem.deleteMany();
  const { count: cases } = await prisma.case.deleteMany();
  console.log(
    `✓ Deleted ${cases} cases (${caseCatalogItems} catalog item selections)`
  );

  // ── 9. Lab test configs (specimen requirements cascade) ──
  const { count: specimenReqs } =
    await prisma.labTestSpecimenRequirement.deleteMany();
  const { count: testConfigs } = await prisma.labTestConfiguration.deleteMany();
  console.log(
    `✓ Deleted ${testConfigs} lab test configurations (${specimenReqs} specimen requirements)`
  );

  // ── 10. LABORATORY-scope template definitions ──
  //    Null activeVersionId first to break self-reference FK
  await prisma.resultTemplateDefinition.updateMany({
    where: { scope: 'LABORATORY' },
    data: { activeVersionId: null },
  });
  const { count: labTemplates } =
    await prisma.resultTemplateDefinition.deleteMany({
      where: { scope: 'LABORATORY' },
    });
  console.log(`✓ Deleted ${labTemplates} lab-scope template definitions`);

  // ── 11. Catalog items (all — they'll be re-seeded) ──
  const { count: compositions } =
    await prisma.catalogItemComposition.deleteMany();
  const { count: catalogItems } = await prisma.catalogItem.deleteMany();
  console.log(
    `✓ Deleted ${catalogItems} catalog items (${compositions} compositions)`
  );

  // ── 12. Analyzers ──
  const { count: analyzers } = await prisma.analyzer.deleteMany();
  console.log(`✓ Deleted ${analyzers} analyzers`);

  // ── 13. Lab signers, laboratory profiles ──
  const { count: signers } = await prisma.labSigner.deleteMany();
  const { count: labProfiles } = await prisma.laboratoryProfile.deleteMany();
  console.log(
    `✓ Deleted ${labProfiles} laboratory profiles (${signers} signers)`
  );

  // ── 14. Vet verification events, verifications, credentials, profiles ──
  const { count: verEvents } = await prisma.vetVerificationEvent.deleteMany();
  const { count: verifications } = await prisma.vetLabVerification.deleteMany();
  const { count: vetCreds } = await prisma.veterinarianCredential.deleteMany();
  const { count: vetProfiles } = await prisma.veterinarianProfile.deleteMany();
  console.log(
    `✓ Deleted ${vetProfiles} vet profiles (${vetCreds} credentials, ${verifications} verifications, ${verEvents} events)`
  );

  // ── 15. Clinic-lab connections ──
  const { count: connections } = await prisma.clinicLabConnection.deleteMany();
  console.log(`✓ Deleted ${connections} clinic-lab connections`);

  // ── 16. Push subscriptions ──
  const { count: pushSubs } = await prisma.pushSubscription.deleteMany();
  console.log(`✓ Deleted ${pushSubs} push subscriptions`);

  // ── 17. Invitations, onboarding tokens ──
  const { count: invitations } = await prisma.tenantInvitation.deleteMany();
  const { count: onboardingTokens } = await prisma.onboardingToken.deleteMany();
  console.log(
    `✓ Deleted ${invitations} invitations, ${onboardingTokens} onboarding tokens`
  );

  // ── 18. Memberships ──
  const { count: memberships } = await prisma.userTenantMembership.deleteMany();
  console.log(`✓ Deleted ${memberships} memberships`);

  // ── 19. Users (DB) ──
  const { count: users } = await prisma.user.deleteMany();
  console.log(`✓ Deleted ${users} DB users`);

  // ── 20. Tenants ──
  const { count: tenants } = await prisma.tenant.deleteMany();
  console.log(`✓ Deleted ${tenants} tenants`);

  // ── 21. Reset counters ──
  const { count: counters } = await prisma.counter.deleteMany();
  console.log(`✓ Reset ${counters} counter(s)`);

  // ── 22. Delete Supabase Auth users ──
  console.log('\nDeleting Supabase Auth users...');
  const authDeleted = await deleteSupabaseUsers();
  console.log(`✓ Deleted ${authDeleted} Supabase Auth users`);

  // ── Summary ──
  const platformTemplates = await prisma.resultTemplateDefinition.count({
    where: { scope: 'PLATFORM' },
  });
  const knowledgeDocs = await prisma.knowledgeDocument.count();
  const knowledgeChunks = await prisma.knowledgeChunk.count();

  console.log('\n' + '─'.repeat(50));
  console.log('PRESERVED:');
  console.log(`  ${platformTemplates} platform-scope template definitions`);
  console.log(
    `  ${knowledgeDocs} knowledge documents (${knowledgeChunks} chunks)`
  );
  console.log('─'.repeat(50));
  console.log('\nNext steps:');
  console.log('  1. node apps/api/prisma/seeds/seed-lab-tenant.mjs');
  console.log('  2. node apps/api/prisma/seeds/seed-platform-catalog.mjs');
  console.log('  3. node apps/api/prisma/seeds/seed-platform-templates.mjs');
  console.log('  4. Onboard fresh from the app\n');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

/**
 * Bootstrap an EMPTY Supabase project for local development (kesherio-dev).
 *
 * Why not `prisma migrate deploy`? Several tables (result_template_definitions,
 * knowledge_chunks, analyzers, specimens, …) were created with `db push` and
 * have no CREATE TABLE migration, so replaying the history on an empty
 * database fails. This script instead:
 *
 *   1. Refuses to run unless DATABASE_URL and SUPABASE_URL both point at the
 *      same project, which must NOT be the production project (its ref is read
 *      from apps/frontend/src/environments/environment.production.ts).
 *   2. Refuses to run if the database already has app tables (pass --force to
 *      re-run on a partially bootstrapped project).
 *   3. Enables pgvector in the `extensions` schema (as in production).
 *   4. `prisma db push` — creates the schema from schema.prisma.
 *   5. Enables RLS with no policies on every public table (deny-all for
 *      PostgREST). The API connects as postgres and bypasses RLS; the frontends
 *      only use Supabase for Auth, so no app flow depends on policies.
 *   6. Marks every migration in prisma/migrations as applied, so future
 *      migrations deploy normally with `prisma migrate deploy`.
 *   7. Creates the Storage buckets the API uses.
 *
 * Run from apps/api (Node 22+):
 *   node prisma/seeds/bootstrap-dev-project.mjs
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, '..', '..');
const repoRoot = join(apiRoot, '..', '..');
const FORCE = process.argv.includes('--force');

const BUCKETS = [
  { name: 'clinic-logos', public: true }, // served via getPublicUrl()
  { name: 'vet-credentials', public: false }, // signed URLs only
  { name: 'lab-reports', public: false },
  { name: 'release-assets', public: false },
];

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

/** Project ref from a Supabase URL or a pooler connection string. */
function refOf(value, kind) {
  const m =
    kind === 'url'
      ? value.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co/)
      : value.match(/postgres(?:ql)?:\/\/postgres\.([a-z0-9]{20})[:@]/) ??
        value.match(/@db\.([a-z0-9]{20})\.supabase\.co/);
  return m?.[1] ?? null;
}

// ── 1. Project guard ────────────────────────────────────────────────────────
const {
  DATABASE_URL = '',
  SUPABASE_URL = '',
  SUPABASE_SERVICE_ROLE_KEY = '',
} = process.env;
if (
  [DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY].some(
    (v) => !v || v.startsWith('PASTE_')
  )
) {
  fail(
    'Fill DATABASE_URL, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the root .env first.'
  );
}
const prodEnv = readFileSync(
  join(repoRoot, 'apps/frontend/src/environments/environment.production.ts'),
  'utf8'
);
const prodRef = refOf(
  prodEnv.match(/supabaseUrl:\s*'([^']+)'/)?.[1] ?? '',
  'url'
);
const dbRef = refOf(DATABASE_URL, 'db');
const apiRef = refOf(SUPABASE_URL, 'url');
if (!prodRef) fail('Could not read the production project ref.');
if (!dbRef || !apiRef)
  fail('Could not read the project ref from DATABASE_URL / SUPABASE_URL.');
if (dbRef !== apiRef)
  fail(
    `DATABASE_URL (${dbRef}) and SUPABASE_URL (${apiRef}) are different projects.`
  );
if (dbRef === prodRef)
  fail(`Refusing to run: ${dbRef} is the PRODUCTION project.`);
console.log(
  `Target project: ${dbRef} (production is ${prodRef.slice(0, 6)}…) ✔`
);

const prisma = new PrismaClient();
const prismaCli = (...args) =>
  execFileSync('npx', ['prisma', ...args], { cwd: apiRoot, stdio: 'inherit' });

try {
  // ── 2. Empty-database guard ───────────────────────────────────────────────
  const [{ n }] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name IN ('tenants', 'users', 'orders')`
  );
  if (n > 0 && !FORCE)
    fail(
      'Database already has app tables. Re-run with --force to continue anyway.'
    );

  // ── 3. pgvector ───────────────────────────────────────────────────────────
  await prisma.$executeRawUnsafe(
    'CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions'
  );
  console.log('pgvector enabled in schema "extensions" ✔');
} finally {
  await prisma.$disconnect();
}

// ── 4. Schema ───────────────────────────────────────────────────────────────
prismaCli('db', 'push', '--skip-generate');

// ── 5. RLS (deny-all for PostgREST) ─────────────────────────────────────────
const prisma2 = new PrismaClient();
try {
  const tables = await prisma2.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
  );
  for (const { tablename } of tables) {
    await prisma2.$executeRawUnsafe(
      `ALTER TABLE public."${tablename}" ENABLE ROW LEVEL SECURITY`
    );
  }
  console.log(`RLS enabled on ${tables.length} tables ✔`);
} finally {
  await prisma2.$disconnect();
}

// ── 6. Baseline migration history ───────────────────────────────────────────
const migrationsDir = join(apiRoot, 'prisma', 'migrations');
const migrations = readdirSync(migrationsDir)
  .filter((d) => statSync(join(migrationsDir, d)).isDirectory())
  .sort();
for (const name of migrations) {
  try {
    execFileSync('npx', ['prisma', 'migrate', 'resolve', '--applied', name], {
      cwd: apiRoot,
      stdio: 'pipe',
    });
  } catch (err) {
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    if (!/already recorded as applied/i.test(out)) {
      console.error(out);
      fail(`Could not mark ${name} as applied.`);
    }
  }
}
console.log(`${migrations.length} migrations marked as applied ✔`);
prismaCli('migrate', 'status');

// ── 7. Storage buckets ──────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const { data: existing, error: listError } =
  await supabase.storage.listBuckets();
if (listError) fail(`Could not list buckets: ${listError.message}`);
for (const bucket of BUCKETS) {
  if (existing.some((b) => b.name === bucket.name)) {
    console.log(`bucket ${bucket.name} already exists`);
    continue;
  }
  const { error } = await supabase.storage.createBucket(bucket.name, {
    public: bucket.public,
  });
  if (error) fail(`Could not create bucket ${bucket.name}: ${error.message}`);
  console.log(
    `bucket ${bucket.name} created (${bucket.public ? 'public' : 'private'}) ✔`
  );
}

console.log(`
Done. Next (from the repo root):
  node apps/api/prisma/seeds/seed-lab-tenant.mjs
  node apps/api/prisma/seeds/seed-platform-catalog.mjs
  node apps/api/prisma/seeds/seed-platform-templates.mjs
  npx ts-node -P apps/api/tsconfig.app.json apps/api/src/rag/scripts/ingest-knowledge.ts
`);

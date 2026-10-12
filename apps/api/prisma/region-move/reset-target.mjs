/**
 * Empties a NEW Supabase project in place after a rehearsal, so restore.sh can
 * run again (docs/REGION_MIGRATION_PLAN.md, "Rehearsal"). Keeps the project's
 * settings: Data API, Auth configuration, keys, extensions.
 *
 * Removes:
 *   - every Storage file and bucket (Storage API: the tables are delete-protected)
 *   - every Auth user (Auth admin API), then any Auth rows left behind
 *     (audit log, flow state, …) except Supabase's migration history
 *   - the app schema: app_private, and every table, view, sequence, function and
 *     type in public (the public schema itself and its grants stay)
 * Then checks the project is as empty as a fresh one.
 *
 * Refuses Ireland production, the project the live clinic app points to
 * (environment.production.ts), and any project whose ref isn't <expected-ref>.
 * Dry run unless --confirm. Prints counts only.
 *
 * Run from the repo root (Node 22+):
 *   node apps/api/prisma/region-move/reset-target.mjs <env-file> <expected-ref>
 *   node apps/api/prisma/region-move/reset-target.mjs <env-file> <expected-ref> --confirm
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const IRELAND_REF = 'mqwurrtupumsizsvurpx';
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const [envFile, expectedRef] = process.argv
  .slice(2)
  .filter((a) => !a.startsWith('--'));
const CONFIRM = process.argv.includes('--confirm');

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

// ── Configuration and guards ────────────────────────────────────────────────
if (!envFile || !expectedRef) {
  fail('usage: reset-target.mjs <env-file> <expected-ref> [--confirm]');
}
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n')
    .map((l) => l.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/))
    .filter(Boolean)
    .map(([, k, v]) => [k, v.trim().replace(/^['"]|['"]$/g, '')])
);
const { DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
if (!DATABASE_URL || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  fail(
    'env file needs DATABASE_URL, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'
  );
}

const dbRef = new URL(DATABASE_URL).username.split('.').slice(1).join('.');
const apiRef = SUPABASE_URL.match(
  /^https:\/\/([a-z0-9]{20})\.supabase\.co/
)?.[1];
const keyRef = JSON.parse(
  Buffer.from(SUPABASE_SERVICE_ROLE_KEY.split('.')[1], 'base64url').toString()
).ref;
const prodEnv = readFileSync(
  join(repoRoot, 'apps/frontend/src/environments/environment.production.ts'),
  'utf8'
);
const liveRef = prodEnv.match(
  /supabaseUrl:\s*'https:\/\/([a-z0-9]{20})\.supabase\.co/
)?.[1];

if (!liveRef)
  fail('Could not read the live project ref from environment.production.ts.');
if (dbRef !== apiRef || apiRef !== keyRef) {
  fail(
    'DATABASE_URL, SUPABASE_URL and the service role key are not the same project.'
  );
}
if (dbRef !== expectedRef) fail(`Target is ${dbRef}, expected ${expectedRef}.`);
if (dbRef === IRELAND_REF) fail('Refusing: this is Ireland production.');
if (dbRef === liveRef) {
  fail(`Refusing: ${dbRef} is the project the live clinic app points to.`);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const db = new pg.Client({ connectionString: DATABASE_URL });

console.log(`Target: ${dbRef} (not Ireland, not the live project) ✔`);
console.log(CONFIRM ? 'Mode: RESET' : 'Mode: dry run (nothing is changed)');

// ── Helpers ─────────────────────────────────────────────────────────────────
const PAGE = 1000;
const MIGRATION_TABLES = new Set([
  'auth.schema_migrations',
  'storage.migrations',
]);

async function listFiles(bucket, prefix = '') {
  const files = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: PAGE, offset });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) files.push(...(await listFiles(bucket, path)));
      else files.push(path);
    }
    if (data.length < PAGE) return files;
  }
}

async function allUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: PAGE,
    });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < PAGE) return users;
  }
}

/** Row counts of every auth/storage table, without Supabase's migration history. */
async function platformRows() {
  const { rows } = await db.query(
    `select schemaname || '.' || tablename as t from pg_tables
      where schemaname in ('auth', 'storage') order by 1`
  );
  const counts = {};
  for (const { t } of rows) {
    if (MIGRATION_TABLES.has(t)) continue;
    const [schema, table] = t.split('.');
    const {
      rows: [{ n }],
    } = await db.query(`select count(*)::int as n from "${schema}"."${table}"`);
    if (n > 0) counts[t] = n;
  }
  return counts;
}

async function appObjects() {
  const {
    rows: [r],
  } = await db.query(`
    select
      (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','p','v','m','S','f'))::int as relations,
      (select count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public' and t.typtype in ('e','d','c','r','m')
          and not exists (select 1 from pg_class c where c.reltype = t.oid))::int as types,
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public')::int as functions,
      exists (select 1 from pg_namespace where nspname = 'app_private') as app_private`);
  return r;
}

const show = (label, value) =>
  console.log(
    `  ${label}: ${typeof value === 'object' ? JSON.stringify(value) : value}`
  );

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  await db.connect();

  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw error;
  const users = await allUsers();
  console.log('\nBefore');
  show('storage buckets', buckets.length);
  show('auth users', users.length);
  show('auth/storage rows (without migration history)', await platformRows());
  show('app objects', await appObjects());

  if (!CONFIRM) {
    console.log('\nRe-run with --confirm to reset.');
    return;
  }

  // 1. Storage: files and buckets, through the API.
  let fileCount = 0;
  for (const b of buckets) {
    const files = await listFiles(b.id);
    for (let i = 0; i < files.length; i += 100) {
      const { error: e } = await supabase.storage
        .from(b.id)
        .remove(files.slice(i, i + 100));
      if (e) throw new Error(`remove files in ${b.id}: ${e.message}`);
    }
    fileCount += files.length;
    const { error: e } = await supabase.storage.deleteBucket(b.id);
    if (e) throw new Error(`delete bucket ${b.id}: ${e.message}`);
  }
  console.log(`\n✓ Removed ${fileCount} files and ${buckets.length} buckets`);

  // 2. Auth users, through the admin API (identities, sessions, … cascade).
  for (const u of users) {
    const { error: e } = await supabase.auth.admin.deleteUser(u.id);
    if (e) throw new Error(`delete auth user: ${e.message}`);
  }
  console.log(`✓ Deleted ${users.length} auth users`);

  // 3. SQL, one transaction: leftover auth rows and the app schema.
  await db.query('begin');
  try {
    const left = await platformRows();
    const storageLeft = Object.keys(left).filter((t) =>
      t.startsWith('storage.')
    );
    if (storageLeft.length) {
      throw new Error(
        `storage rows left after the API cleanup: ${storageLeft.join(', ')}`
      );
    }
    for (const t of Object.keys(left)) {
      const [schema, table] = t.split('.');
      await db.query(`delete from "${schema}"."${table}"`);
    }
    await db.query('drop schema if exists app_private cascade');
    const drops = await db.query(`
      select format('drop %s if exists %I.%I cascade',
               case c.relkind when 'v' then 'view' when 'm' then 'materialized view'
                              when 'S' then 'sequence' when 'f' then 'foreign table'
                              else 'table' end, n.nspname, c.relname) as sql
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r','p','v','m','S','f')
      union all
      select format('drop routine if exists %I.%I(%s) cascade', n.nspname, p.proname,
                    pg_get_function_identity_arguments(p.oid))
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'`);
    for (const { sql } of drops.rows) await db.query(sql);
    const types = await db.query(`
      select format('drop type if exists %I.%I cascade', n.nspname, t.typname) as sql
        from pg_type t join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = 'public' and t.typtype in ('e','d','c','r','m')
         and not exists (select 1 from pg_class c where c.reltype = t.oid)`);
    for (const { sql } of types.rows) await db.query(sql);
    await db.query('commit');
    console.log(
      `✓ Cleared ${
        Object.keys(left).length
      } auth tables, dropped app_private and ` +
        `${drops.rowCount + types.rowCount} objects in public`
    );
  } catch (e) {
    await db.query('rollback');
    throw e;
  }

  // 4. Check: as empty as a fresh project.
  const rowsAfter = await platformRows();
  const objectsAfter = await appObjects();
  const { data: bucketsAfter } = await supabase.storage.listBuckets();
  console.log('\nAfter');
  show('storage buckets', bucketsAfter.length);
  show('auth/storage rows (without migration history)', rowsAfter);
  show('app objects', objectsAfter);
  const empty =
    bucketsAfter.length === 0 &&
    Object.keys(rowsAfter).length === 0 &&
    objectsAfter.relations === 0 &&
    objectsAfter.types === 0 &&
    objectsAfter.functions === 0 &&
    !objectsAfter.app_private;
  if (!empty) fail('the project is not empty yet — check the counts above');
  console.log('\nEmpty — ready for restore.sh ✔');
}

main()
  .catch((e) => fail(e.message))
  .finally(() => db.end());

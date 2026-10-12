/**
 * Row-level comparison of two Supabase projects (read-only on both).
 *
 * For every table in public, app_private, auth and storage it compares the
 * rows by primary key and a hash of the row, and reports rows only in A, only
 * in B, and changed. Used on the switch day:
 *   - right after the restore: Ireland vs US must show no differences;
 *   - after reopening, if a rollback is considered: lists exactly what users
 *     wrote to US since the cutover (see docs/REGION_MIGRATION_PLAN.md,
 *     "Rollback").
 *
 * Expected differences are normalised:
 *   - the project ref in stored URLs (step 4 rewrites logo URLs);
 *   - storage.objects is compared on bucket, path and size only (copy-storage
 *     re-uploads, so timestamps, eTag and version change).
 *
 * Prints counts only. --ids also prints the primary keys of differing rows
 * (ids only, never row contents).
 *
 * Run from the repo root (Node 22+):
 *   node apps/api/prisma/region-move/compare-data.mjs <env-A> <env-B> [--ids]
 */

import { readFileSync } from 'node:fs';
import pg from 'pg';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const SHOW_IDS = process.argv.includes('--ids');
if (args.length !== 2) {
  console.error('usage: compare-data.mjs <env-A> <env-B> [--ids]');
  process.exit(1);
}

function load(file) {
  const env = Object.fromEntries(
    readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => l.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/))
      .filter(Boolean)
      .map(([, k, v]) => [k, v.trim().replace(/^['"]|['"]$/g, '')])
  );
  if (!env.DATABASE_URL) throw new Error(`${file}: DATABASE_URL missing`);
  const ref = new URL(env.DATABASE_URL).username.split('.').slice(1).join('.');
  return { ref, url: env.DATABASE_URL };
}

const A = load(args[0]);
const B = load(args[1]);
const SCHEMAS = ['public', 'app_private', 'auth', 'storage'];
const SKIP = new Set(['auth.schema_migrations', 'storage.migrations']);

async function connect({ url }) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
  const { rows } = await c.query(
    "select current_setting('transaction_read_only') as ro"
  );
  if (rows[0].ro !== 'on') throw new Error('session is not read-only');
  return c;
}

async function tables(c) {
  const { rows } = await c.query(
    `select n.nspname as schema, c.relname as name,
            coalesce((select array_agg(a.attname::text order by k.ord)
                        from pg_index i
                        cross join unnest(i.indkey) with ordinality k(attnum, ord)
                        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
                       where i.indrelid = c.oid and i.indisprimary), '{}'::text[]) as pk
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1) and c.relkind in ('r', 'p')
      order by 1, 2`,
    [SCHEMAS]
  );
  return rows.filter((t) => !SKIP.has(`${t.schema}.${t.name}`));
}

const q = (id) => `"${id.replace(/"/g, '""')}"`;

/** Map of primary key → row hash. Rows without a primary key use the hash as key. */
async function rowHashes(c, t, refFrom, refTo) {
  const table = `${q(t.schema)}.${q(t.name)}`;
  const isObjects = t.schema === 'storage' && t.name === 'objects';
  const body = isObjects
    ? `concat_ws('|', bucket_id, name, metadata->>'size')`
    : `replace(row_to_json(x)::text, $1, $2)`;
  const key = t.pk.length
    ? t.pk.map((col) => `x.${q(col)}::text`).join(` || '|' || `)
    : null;
  const sql = `select ${key ?? 'null'} as k, md5(${body}) as h from ${table} x`;
  const { rows } = await c.query(sql, isObjects ? [] : [refFrom, refTo]);
  const map = new Map();
  for (const r of rows) {
    const k = r.k ?? r.h;
    map.set(k, (map.get(k) ?? '') + r.h); // duplicate keys only for PK-less tables
  }
  return map;
}

async function main() {
  const [ca, cb] = await Promise.all([connect(A), connect(B)]);
  console.log(`A: ${A.ref}\nB: ${B.ref}\n(read-only sessions on both)\n`);
  const [ta, tb] = await Promise.all([tables(ca), tables(cb)]);
  const names = (ts) => new Set(ts.map((t) => `${t.schema}.${t.name}`));
  const na = names(ta);
  const nb = names(tb);
  const onlyTablesA = [...na].filter((n) => !nb.has(n));
  const onlyTablesB = [...nb].filter((n) => !na.has(n));

  let totalDiff = 0;
  let checked = 0;
  for (const t of ta) {
    const name = `${t.schema}.${t.name}`;
    if (!nb.has(name)) continue;
    // Stored URLs in B carry B's ref where A has A's (step 4): compare in A's terms.
    const [ha, hb] = await Promise.all([
      rowHashes(ca, t, A.ref, A.ref),
      rowHashes(cb, t, B.ref, A.ref),
    ]);
    checked++;
    const onlyA = [...ha.keys()].filter((k) => !hb.has(k));
    const onlyB = [...hb.keys()].filter((k) => !ha.has(k));
    const changed = [...ha.keys()].filter(
      (k) => hb.has(k) && hb.get(k) !== ha.get(k)
    );
    const n = onlyA.length + onlyB.length + changed.length;
    if (n === 0) continue;
    totalDiff += n;
    console.log(
      `${name}: only in A ${onlyA.length}, only in B ${onlyB.length}, changed ${changed.length}` +
        (t.pk.length ? '' : ' (no primary key: compared by whole row)')
    );
    if (SHOW_IDS && t.pk.length) {
      for (const [label, ids] of [
        ['only in A', onlyA],
        ['only in B', onlyB],
        ['changed', changed],
      ]) {
        if (ids.length) console.log(`  ${label}: ${ids.join(', ')}`);
      }
    }
  }
  for (const n of onlyTablesA) console.log(`${n}: table only in A`);
  for (const n of onlyTablesB) console.log(`${n}: table only in B`);

  const tableDiff = onlyTablesA.length + onlyTablesB.length;
  console.log(
    `\n${checked} tables compared row by row: ` +
      (totalDiff + tableDiff === 0
        ? 'no differences ✔'
        : `${totalDiff} differing rows, ${tableDiff} tables in one project only`)
  );
  await Promise.all([ca.end(), cb.end()]);
  process.exit(totalDiff + tableDiff === 0 ? 0 : 2);
}

main().catch((e) => {
  console.error(`✖ ${e.message}`);
  process.exit(1);
});

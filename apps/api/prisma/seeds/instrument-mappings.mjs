/**
 * Production-safe analyzer parameter mappings. Creates/updates ONLY `instrument_parameter_mappings` rows
 * (and, with --create-analyzer, the analyzer row). It never creates orders, patients, links or credentials —
 * use the lab portal for those.
 *
 *   DATABASE_URL=… node apps/api/prisma/seeds/instrument-mappings.mjs \
 *     --lab <lab tenant id or slug> --analyzer "<analyzer name>" [--profile vh30-cbc | --mappings-file rows.json] \
 *     [--catalog-code CBC] [--create-analyzer]
 *     [--apply --confirm-host <database host>]     without --apply NOTHING is written (default = dry run)
 *     [--overwrite]                                 allow changing a row that already maps differently
 *
 * Safety: dry-run by default; idempotent (a second --apply changes nothing); existing rows that differ are
 * reported and left alone unless --overwrite; every analyte code is validated against the lab's ACTIVE result
 * template(s) for the catalog code (must exist, be a non-header NUMERIC field; template formulas are allowed
 * and reported as "computed by the template" — the processor records the analyzer's figure but never writes it).
 * --apply must be given the database host it is about to write to (--confirm-host), so a wrong DATABASE_URL
 * is caught before anything is written. Rows are written in one transaction.
 *
 * --mappings-file: JSON array of [parameterCode, unit, analyteCode, multiplier], e.g.
 *   [["WBC","10^9/L","WBC",1],["HGB","g/L","HGB",0.1]]
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  PROFILES,
  applicableDefinitions,
  normaliseRows,
  planChanges,
  validateAgainstTemplates,
} from './instrument-mappings.lib.mjs';

const { values: a } = parseArgs({
  options: {
    lab: { type: 'string' },
    analyzer: { type: 'string' },
    profile: { type: 'string' },
    'mappings-file': { type: 'string' },
    'catalog-code': { type: 'string' },
    'create-analyzer': { type: 'boolean' },
    apply: { type: 'boolean' },
    'confirm-host': { type: 'string' },
    overwrite: { type: 'boolean' },
  },
});
if (!a.lab || !a.analyzer || (!a.profile && !a['mappings-file']) || (a.profile && a['mappings-file'])) {
  console.error(
    'Usage: --lab <id|slug> --analyzer <name> (--profile <name> | --mappings-file <rows.json>) [--catalog-code CBC]\n' +
      `       [--create-analyzer] [--overwrite] [--apply --confirm-host <host>]\nProfiles: ${Object.keys(PROFILES).join(', ')}`
  );
  process.exit(1);
}

const dbUrl = new URL(process.env.DATABASE_URL ?? 'postgres://missing');
const host = dbUrl.hostname;
const APPLY = !!a.apply;
const prisma = new PrismaClient();
const fail = (m) => {
  throw new Error(m);
};

try {
  console.log(`Database host: ${host}`);
  console.log(APPLY ? 'Mode: APPLY' : 'Mode: DRY RUN (nothing is written; add --apply to write)');
  if (APPLY && a['confirm-host'] !== host)
    fail(`--apply requires --confirm-host ${host} (confirms this is the database you mean to write to).`);

  const profile = a.profile ? PROFILES[a.profile] ?? fail(`Unknown profile "${a.profile}".`) : null;
  const rows = normaliseRows(a['mappings-file'] ? JSON.parse(readFileSync(a['mappings-file'], 'utf8')) : profile.rows);
  const code = a['catalog-code'] ?? profile?.catalogCode ?? fail('--catalog-code is required with --mappings-file.');

  const lab = await prisma.tenant.findFirst({ where: { OR: [{ id: a.lab }, { slug: a.lab }] } });
  if (!lab || lab.type === 'CLINIC') fail(`Lab tenant not found (or is a clinic): ${a.lab}`);
  console.log(`Lab: ${lab.name} (${lab.id})`);

  // --- template validation -------------------------------------------------------------------------------
  const defs = applicableDefinitions(
    await prisma.resultTemplateDefinition.findMany({
      where: { catalogItemCode: code, ownerKey: { in: ['platform', lab.id] }, activeVersionId: { not: null } },
      include: { activeVersion: { include: { analytes: true } } },
    }),
    lab.id
  );
  console.log(`Templates for "${code}": ${defs.length} applicable active definition(s)`);
  const { errors, computed } = validateAgainstTemplates(rows, defs);
  if (computed.length)
    console.log(`  computed by the template (analyzer figure reported, not written): ${computed.join(', ')}`);
  if (errors.length) fail(`Template validation failed:\n  - ${errors.join('\n  - ')}`);
  console.log(`  all ${new Set(rows.map((r) => r.analyteCode)).size} analyte codes are valid NUMERIC fields`);

  // --- analyzer --------------------------------------------------------------------------------------------
  const existing = await prisma.analyzer.findFirst({ where: { labTenantId: lab.id, name: a.analyzer } });
  if (!existing && !a['create-analyzer'])
    fail(`Analyzer "${a.analyzer}" does not exist in this lab. Create it in the portal, or pass --create-analyzer.`);
  if (existing && !existing.isActive) fail(`Analyzer "${a.analyzer}" is disabled.`);
  console.log(`Analyzer: ${existing ? `use existing "${existing.name}" (${existing.id})` : `CREATE "${a.analyzer}"`}`);

  // --- plan ------------------------------------------------------------------------------------------------
  const stored = existing
    ? await prisma.instrumentParameterMapping.findMany({
        where: { analyzerId: existing.id, catalogItemCode: code },
        select: { parameterCode: true, analyzerUnit: true, analyteCode: true, multiplier: true },
      })
    : [];
  const plan = planChanges(rows, stored);
  const fmt = (r) => `${r.parameterCode} [${r.analyzerUnit}] -> ${r.analyteCode} ×${r.multiplier}`;
  console.log(`Mappings for "${code}": ${plan.create.length} to create, ${plan.unchanged.length} unchanged, ${plan.differ.length} differ`);
  for (const r of plan.create) console.log(`  + ${fmt(r)}`);
  for (const { row, current } of plan.differ)
    console.log(`  ! ${fmt(row)}   (stored: ${current.analyteCode} ×${current.multiplier}${a.overwrite ? ' — will be overwritten' : ' — LEFT AS IS, pass --overwrite to change'})`);
  const extra = stored.filter((s) => !rows.some((r) => r.parameterCode === s.parameterCode && r.analyzerUnit === s.analyzerUnit));
  for (const s of extra) console.log(`  ? stored row not in this table (left untouched): ${s.parameterCode} [${s.analyzerUnit}] -> ${s.analyteCode}`);
  if (plan.differ.length && !a.overwrite) console.log('Rows that differ are skipped; the exit code is 2 so this is not mistaken for a clean run.');

  if (!APPLY) {
    console.log('DRY RUN — nothing written.');
    process.exitCode = plan.differ.length && !a.overwrite ? 2 : 0;
  } else {
    const writes = await prisma.$transaction(async (tx) => {
      const analyzer =
        existing ??
        (await tx.analyzer.create({
          data: {
            labTenantId: lab.id,
            name: a.analyzer,
            model: profile?.model ?? null,
            manufacturer: profile?.manufacturer ?? null,
            department: profile?.department ?? 'HEMATOLOGY',
            connectionType: 'CONNECTOR',
          },
        }));
      const todo = [...plan.create, ...(a.overwrite ? plan.differ.map((d) => d.row) : [])];
      for (const r of todo)
        await tx.instrumentParameterMapping.upsert({
          where: {
            analyzerId_parameterCode_analyzerUnit_catalogItemCode: {
              analyzerId: analyzer.id,
              parameterCode: r.parameterCode,
              analyzerUnit: r.analyzerUnit,
              catalogItemCode: code,
            },
          },
          create: { labTenantId: lab.id, analyzerId: analyzer.id, catalogItemCode: code, ...r },
          update: { analyteCode: r.analyteCode, multiplier: r.multiplier },
        });
      return todo.length;
    });
    console.log(`Applied: ${writes} mapping row(s) written. Re-run without --apply to confirm "0 to create".`);
    process.exitCode = plan.differ.length && !a.overwrite ? 2 : 0;
  }
} catch (err) {
  console.error(`Failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

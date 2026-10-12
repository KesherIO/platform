/**
 * Static guard for the Data API lockdown (docs/SECURITY_LOCKDOWN.md). Runs in
 * every `nx test api` — no database needed — so a migration that would expose
 * a table or function fails CI/review before it reaches a database:
 *
 *  - every table in schema.prisma has RLS enabled by some migration;
 *  - migrations from the lockdown on must, for every table / function they
 *    create, enable RLS / revoke EXECUTE from PUBLIC in the same file, and may
 *    never grant to anon/authenticated or disable RLS.
 *
 * The database-level checks live in public-schema-lockdown.int.spec.ts.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const PRISMA_DIR = join(__dirname, '..', '..', 'prisma');
const MIGRATIONS_DIR = join(PRISMA_DIR, 'migrations');
const LOCKDOWN = '20261008000000_lock_down_public_schema';

const ident = '"?(?:public"?\\.)?"?([A-Za-z0-9_]+)"?';
const rlsEnabled = new RegExp(
  `ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${ident}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
  'gi'
);
const createTable = new RegExp(
  `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${ident}`,
  'gi'
);
const createFunction =
  /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+("?[A-Za-z0-9_]+"?\.)?"?([A-Za-z0-9_]+)"?/gi;

/** SQL without comments, so commented-out statements don't count. */
const stripComments = (sql: string) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');

const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()
  .map((name) => ({
    name,
    sql: stripComments(
      readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8')
    ),
  }));
const sinceLockdown = migrations.filter((m) => m.name >= LOCKDOWN);

const matches = (re: RegExp, sql: string, group = 1) =>
  [...sql.matchAll(re)].map((m) => m[group].toLowerCase());

/** Table name of every model: @@map("…") or the model name itself. */
function prismaTables(): string[] {
  const schema = readFileSync(join(PRISMA_DIR, 'schema.prisma'), 'utf8');
  return [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map(
    ([, model, body]) =>
      (body.match(/@@map\("([^"]+)"\)/)?.[1] ?? model).toLowerCase()
  );
}

describe('migrations keep the Data API locked down', () => {
  it('finds the lockdown migration and the Prisma tables', () => {
    expect(migrations.map((m) => m.name)).toContain(LOCKDOWN);
    expect(prismaTables().length).toBeGreaterThan(40);
  });

  it('enables RLS on every table in schema.prisma', () => {
    const enabled = new Set(
      migrations.flatMap((m) => matches(rlsEnabled, m.sql))
    );
    const missing = prismaTables().filter((t) => !enabled.has(t));
    expect(missing).toEqual([]);
  });

  it('enables RLS in the same migration that creates a table', () => {
    const problems = sinceLockdown.flatMap((m) => {
      const enabled = new Set(matches(rlsEnabled, m.sql));
      return matches(createTable, m.sql)
        .filter((t) => !enabled.has(t))
        .map(
          (t) =>
            `${m.name}: CREATE TABLE ${t} without ENABLE ROW LEVEL SECURITY`
        );
    });
    expect(problems).toEqual([]);
  });

  it('revokes PUBLIC EXECUTE in the same migration that creates a function', () => {
    const problems = sinceLockdown.flatMap((m) =>
      matches(createFunction, m.sql, 2)
        .filter(
          (fn) =>
            !new RegExp(
              `REVOKE\\s+(?:ALL|EXECUTE)[\\s\\S]*?FUNCTION[^;]*\\b${fn}\\b[^;]*FROM[^;]*\\bPUBLIC\\b`,
              'i'
            ).test(m.sql) &&
            !/REVOKE\s+(?:ALL|EXECUTE)[^;]*ON\s+ALL\s+FUNCTIONS\s+IN\s+SCHEMA[^;]*FROM[^;]*\bPUBLIC\b/i.test(
              m.sql
            )
        )
        .map((fn) => `${m.name}: function ${fn} stays executable by PUBLIC`)
    );
    expect(problems).toEqual([]);
  });

  it('never grants to anon/authenticated or disables RLS again', () => {
    const problems = sinceLockdown.flatMap((m) => [
      ...[
        ...m.sql.matchAll(
          /GRANT\s[^;]*\bTO\b[^;]*\b(anon|authenticated|PUBLIC)\b[^;]*;/gi
        ),
      ].map((g) => `${m.name}: ${g[0].replace(/\s+/g, ' ')}`),
      ...[...m.sql.matchAll(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/gi)].map(
        () => `${m.name}: DISABLE ROW LEVEL SECURITY`
      ),
    ]);
    expect(problems).toEqual([]);
  });

  it('rejects the patterns it is meant to catch', () => {
    const bad = stripComments(`
      CREATE TABLE "public"."new_things" ("id" TEXT);
      CREATE FUNCTION public.leak() RETURNS int LANGUAGE sql AS $$ select 1 $$;
      GRANT SELECT ON public.new_things TO anon;
    `);
    expect(matches(createTable, bad)).toEqual(['new_things']);
    expect(matches(rlsEnabled, bad)).toEqual([]);
    expect(matches(createFunction, bad, 2)).toEqual(['leak']);
    expect(/GRANT\s[^;]*\bTO\b[^;]*\banon\b/i.test(bad)).toBe(true);
    expect(
      matches(
        rlsEnabled,
        'ALTER TABLE "public"."new_things" ENABLE ROW LEVEL SECURITY;'
      )
    ).toEqual(['new_things']);
  });
});

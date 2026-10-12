/**
 * Data API lockdown checks (migration 20261008000000_lock_down_public_schema).
 *
 * 1. Database permissions — needs SECURITY_DATABASE_URL, a connection as the
 *    `postgres` role of a database with the migrations applied. Read-only
 *    except for writes inside transactions that are always rolled back.
 *    Use the local copy (apps/api/prisma/security/local-test-db.sh), or a
 *    Supabase project once the migration is applied there.
 *    With SECURITY_TEST_READ_ONLY=1 every session is read-only and the tests
 *    that need a write (anon write probes, the Prisma write test, the
 *    future-table test) are skipped — use this mode against production.
 * 2. Data API over HTTP — needs DATA_API_URL (https://<ref>.supabase.co) and
 *    DATA_API_ANON_KEY. Sends count-only HEAD requests with the anon key; no
 *    row is read.
 *
 *   cd apps/api && SECURITY_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres \
 *     node ../../node_modules/.bin/jest --config jest.config.js public-schema-lockdown
 */
import { Client } from 'pg';
import type { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

// Remote projects need many round trips (one per table and role).
jest.setTimeout(120_000);

const DATABASE_URL = process.env['SECURITY_DATABASE_URL'];
const DATA_API_URL = process.env['DATA_API_URL'];
const DATA_API_ANON_KEY = process.env['DATA_API_ANON_KEY'];

const READ_ONLY = process.env['SECURITY_TEST_READ_ONLY'] === '1';
const describeWithDb = DATABASE_URL ? describe : describe.skip;
/** Tests that write (always rolled back) — skipped in read-only mode. */
const itWrites = READ_ONLY ? it.skip : it;
const describeWithApi =
  DATA_API_URL && DATA_API_ANON_KEY ? describe : describe.skip;

const APP_SCHEMAS = ['public', 'app_private'];
const DATA_API_ROLES = ['anon', 'authenticated'];
/** Tables that had RLS off before the lockdown migration. */
const FORMERLY_OPEN_TABLES = [
  'analyzers',
  'clinic_lab_connections',
  'lab_signers',
  'lab_test_configurations',
  'lab_test_specimen_requirements',
  'laboratory_profiles',
  'ordered_test_sources',
  'ordered_test_specimens',
  'ordered_tests',
  'pickups',
  'push_subscriptions',
  'result_template_definitions',
  'result_template_versions',
  'specimens',
  'timeline_events',
  'vet_lab_verifications',
  'vet_verification_events',
  'veterinarian_credentials',
  'veterinarian_profiles',
];
const PERMISSION_DENIED = '42501';

describeWithDb('Data API roles cannot reach app data (database)', () => {
  let db: Client;

  const rows = async <T>(sql: string, params: unknown[] = []) =>
    (await db.query(sql, params)).rows as T[];

  /** Runs fn as `role` inside a transaction that is always rolled back. */
  async function asRole(
    role: string,
    fn: () => Promise<unknown>
  ): Promise<{ code?: string }> {
    await db.query('BEGIN');
    try {
      if (role === 'authenticated') {
        // What Supabase sets for a signed-in user's request.
        await db.query(
          `select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true),
                  set_config('request.jwt.claim.role', 'authenticated', true)`
        );
      }
      await db.query(`SET LOCAL ROLE ${role}`);
      await fn();
      return {};
    } catch (e) {
      return { code: (e as { code?: string }).code };
    } finally {
      await db.query('ROLLBACK');
    }
  }

  let tables: { schema: string; name: string }[];

  beforeAll(async () => {
    db = new Client({ connectionString: DATABASE_URL });
    await db.connect();
    if (READ_ONLY) {
      await db.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    }
    tables = await rows(
      `select n.nspname as schema, c.relname as name
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = any($1) and c.relkind in ('r', 'p')
        order by 1, 2`,
      [APP_SCHEMAS]
    );
  });

  afterAll(async () => {
    await db?.end();
  });

  it('runs as the API role (postgres, bypasses RLS) against the app schema', async () => {
    const [me] = await rows<{ user: string; bypass: boolean }>(
      `select current_user as user, rolbypassrls as bypass
         from pg_roles where rolname = current_user`
    );
    expect(me).toEqual({ user: 'postgres', bypass: true });
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(FORMERLY_OPEN_TABLES)
    );
  });

  it('has RLS enabled on every table in public and app_private', async () => {
    const open = await rows<{ name: string }>(
      `select n.nspname || '.' || c.relname as name
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = any($1) and c.relkind in ('r', 'p') and not c.relrowsecurity
        order by 1`,
      [APP_SCHEMAS]
    );
    expect(open).toEqual([]);
  });

  it('grants anon/authenticated no privilege on tables, views or columns', async () => {
    const granted = await rows<{ grant: string }>(
      `select r.role || ' ' || p.priv || ' ' || n.nspname || '.' || c.relname as grant
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         cross join unnest($2::text[]) r(role)
         cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
        where n.nspname = any($1) and c.relkind in ('r', 'p', 'v', 'm', 'f')
          and has_table_privilege(r.role, c.oid, p.priv)
       union all
       select grantee || ' column ' || privilege_type || ' ' || table_schema || '.' || table_name || '.' || column_name
         from information_schema.column_privileges
        where table_schema = any($1) and grantee = any($2)
        order by 1`,
      [APP_SCHEMAS, DATA_API_ROLES]
    );
    expect(granted).toEqual([]);
  });

  it('grants anon/authenticated nothing on sequences', async () => {
    const granted = await rows<{ grant: string }>(
      `select r.role || ' ' || p.priv || ' ' || n.nspname || '.' || c.relname as grant
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         cross join unnest($2::text[]) r(role)
         cross join unnest(array['USAGE','SELECT','UPDATE']) p(priv)
        where n.nspname = any($1) and c.relkind = 'S'
          and has_sequence_privilege(r.role, c.oid, p.priv)`,
      [APP_SCHEMAS, DATA_API_ROLES]
    );
    expect(granted).toEqual([]);
  });

  it('lets neither anon/authenticated nor PUBLIC execute app functions', async () => {
    const callable = await rows<{ fn: string }>(
      `select r.role || ' ' || n.nspname || '.' || p.proname as fn
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         cross join unnest($2::text[]) r(role)
        where n.nspname = any($1) and has_function_privilege(r.role, p.oid, 'EXECUTE')
       union all
       select 'PUBLIC ' || n.nspname || '.' || p.proname
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = any($1)
          and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       where a.grantee = 0)
        order by 1`,
      [APP_SCHEMAS, DATA_API_ROLES]
    );
    expect(callable).toEqual([]);
  });

  it('gives anon/authenticated no USAGE on app_private', async () => {
    const usage = await rows<{ role: string }>(
      `select r.role from unnest($1::text[]) r(role)
        where has_schema_privilege(r.role, 'app_private', 'USAGE')`,
      [DATA_API_ROLES]
    );
    expect(usage).toEqual([]);
  });

  it('does not grant future objects created by postgres to anon/authenticated/PUBLIC', async () => {
    const defaults = await rows<{ acl: string }>(
      `select n.nspname || ' ' || d.defaclobjtype::text || ' ' || coalesce(nullif(r.rolname, ''), 'PUBLIC') || ' ' || a.privilege_type as acl
         from pg_default_acl d
         join pg_namespace n on n.oid = d.defaclnamespace
         cross join lateral aclexplode(d.defaclacl) a
         left join pg_roles r on r.oid = a.grantee
        where d.defaclrole = 'postgres'::regrole and n.nspname = any($1)
          and (a.grantee = 0 or r.rolname = any($2))
        order by 1`,
      [APP_SCHEMAS, DATA_API_ROLES]
    );
    expect(defaults).toEqual([]);
  });

  itWrites(
    'gives a table created later by a migration no anon/authenticated access',
    async () => {
      await db.query('BEGIN');
      try {
        await db.query('create table public.zz_lockdown_future (id int)');
        const [acl] = await rows<{ anon: boolean; authenticated: boolean }>(
          `select has_table_privilege('anon', 'public.zz_lockdown_future', 'select') as anon,
                has_table_privilege('authenticated', 'public.zz_lockdown_future', 'select') as authenticated`
        );
        expect(acl).toEqual({ anon: false, authenticated: false });
      } finally {
        await db.query('ROLLBACK');
      }
    }
  );

  it.each(DATA_API_ROLES)(
    '%s gets "permission denied" reading any app table',
    async (role) => {
      const readable: string[] = [];
      for (const t of tables) {
        const { code } = await asRole(role, () =>
          db.query(`select 1 from "${t.schema}"."${t.name}" limit 1`)
        );
        if (code !== PERMISSION_DENIED) readable.push(`${t.schema}.${t.name}`);
      }
      expect(readable).toEqual([]);
    }
  );

  itWrites.each(DATA_API_ROLES)(
    '%s gets "permission denied" writing the formerly open tables',
    async (role) => {
      const writable: string[] = [];
      for (const name of FORMERLY_OPEN_TABLES) {
        // Any existing column works for the UPDATE probe (not every table has "id").
        const [{ col }] = await rows<{ col: string }>(
          `select column_name as col from information_schema.columns
            where table_schema = 'public' and table_name = $1
            order by ordinal_position limit 1`,
          [name]
        );
        for (const sql of [
          `insert into public."${name}" default values`,
          `update public."${name}" set "${col}" = "${col}"`,
          `delete from public."${name}"`,
        ]) {
          const { code } = await asRole(role, () => db.query(sql));
          if (code !== PERMISSION_DENIED) writable.push(`${name}: ${sql}`);
        }
      }
      expect(writable).toEqual([]);
    }
  );

  it.each(DATA_API_ROLES)(
    '%s cannot call the app_private helpers',
    async (role) => {
      const { code } = await asRole(role, () =>
        db.query(`select app_private.is_tenant_member('x')`)
      );
      expect(code).toBe(PERMISSION_DENIED);
    }
  );

  describe('the NestJS API (Prisma as postgres) keeps working', () => {
    let prisma: PrismaService;
    class Rollback extends Error {}

    beforeAll(async () => {
      prisma = new PrismaService({
        getOrThrow: () => DATABASE_URL,
      } as unknown as ConfigService);
      await prisma.$connect();
    });

    afterAll(async () => {
      await prisma?.$disconnect();
    });

    it('reads every app table', async () => {
      const failed: string[] = [];
      for (const t of tables) {
        try {
          await prisma.$queryRawUnsafe(
            `select count(*) from "${t.schema}"."${t.name}"`
          );
        } catch {
          failed.push(`${t.schema}.${t.name}`);
        }
      }
      expect(failed).toEqual([]);
    });

    // Raw SQL over the API's own connection (PrismaPg, role postgres), so it
    // doesn't depend on which migrations the generated client expects.
    itWrites(
      'creates, updates and deletes rows in formerly open tables (rolled back)',
      async () => {
        const id = (p: string) => `${p}-lockdown-${Date.now()}`;
        const lab = id('lab');
        const clinic = id('clinic');
        const outcome = prisma.$transaction(async (tx) => {
          await tx.$executeRaw`insert into public.tenants (id, name, slug, type, "updatedAt")
            values (${lab}, 'lockdown test lab', ${lab}, 'LAB', now()),
                   (${clinic}, 'lockdown test clinic', ${clinic}, 'CLINIC', now())`;
          await tx.$executeRaw`insert into public.clinic_lab_connections (id, "clinicId", "labId", "updatedAt")
            values (${id('conn')}, ${clinic}, ${lab}, now())`;
          await tx.$executeRaw`update public.clinic_lab_connections set "isActive" = false where "labId" = ${lab}`;
          await tx.$executeRaw`insert into public.laboratory_profiles (id, "tenantId", "updatedAt")
            values (${id('profile')}, ${lab}, now())`;
          const [{ n }] = await tx.$queryRaw<{ n: number }[]>`
            select count(*)::int as n from public.clinic_lab_connections where "labId" = ${lab} and not "isActive"`;
          expect(n).toBe(1);
          await tx.$executeRaw`delete from public.clinic_lab_connections where "labId" = ${lab}`;
          throw new Rollback();
        });
        await expect(outcome).rejects.toBeInstanceOf(Rollback);
      }
    );
  });
});

describeWithApi('Data API does not serve app tables (HTTP)', () => {
  const tables = ['tenants', 'users', ...FORMERLY_OPEN_TABLES];

  it.each(tables)('anon key cannot read %s', async (table) => {
    const res = await fetch(`${DATA_API_URL}/rest/v1/${table}?select=*`, {
      method: 'HEAD',
      headers: {
        apikey: DATA_API_ANON_KEY as string,
        Authorization: `Bearer ${DATA_API_ANON_KEY}`,
        Prefer: 'count=exact',
        Range: '0-0',
      },
    });
    // Data API off → 404; on but locked down → 401/403. Never a 2xx.
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

# Move production to US East — Plan

**Switch day: follow [`REGION_CUTOVER_RUNBOOK.md`](REGION_CUTOVER_RUNBOOK.md)** (timeline,
stop/resume points, gates, rollback without data loss). This file has the decisions and
details behind it.

## Goal

Production runs in two far-apart regions today:

| Piece                                | Today                       | Target                    |
| ------------------------------------ | --------------------------- | ------------------------- |
| API (Railway, `api`)                 | `sfo` (US West, California) | `iad` (US East, Virginia) |
| Database + Auth + Storage (Supabase) | `eu-west-1` (Ireland)       | `us-east-1` (N. Virginia) |

Every API request runs several database queries, each one a round trip between Railway
and Supabase: ~140 ms today, ~2 ms after the move. Users will be mostly in South America;
US East is the closest region both providers offer (Railway has no South America region,
and an API in `iad` with a database in São Paulo would be ~120 ms apart again).

Why now: Biomet (first lab) has only started adding its team and settings. The fewer users
and data, the cheaper the move. **Dev (kesherio-dev, Tokyo) is not part of this plan.**

## Decisions

- **Copy prod, don't start fresh.** Biomet's team accounts (with their passwords), lab
  settings and everything else in the database come along, using Supabase's official
  backup/restore ([docs](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)).
- **No Docker.** Docker Desktop is blocked by company policy. The Supabase CLI only
  generates the dump scripts (`--dry-run`); they run with local PostgreSQL 17 tools.
  Both servers are 17 (Ireland 17.6, new project 17.11), tools 17.11.
- **Short freeze instead of live sync.** The data is small; the copy takes minutes. Agree a
  window with Biomet (~1 hour) where nobody uses the app.
- **Everyone signs in again** after the switch: the new project has its own JWT signing
  keys, so old sessions stop working. Passwords keep working (they are copied with the
  `auth` schema).
- **The old Ireland project stays untouched** until the new one has run fine for 1–2
  weeks. It's the rollback.

## What does NOT come with the database copy

From the Supabase docs, and checked against this repo:

| Not copied                 | What to do                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------- |
| Storage files              | Copy the 4 buckets separately (step 4)                                              |
| Auth settings              | Set them up by hand in the new project (step 2)                                     |
| JWT signing keys           | New keys; the API reads them from JWKS, so only the URL changes (step 5)            |
| URLs saved in the database | `Tenant.logoUrl` stores the full public logo URL, with the old project ref (step 4) |

## Where the Supabase project is referenced

| Place                                                               | Values                                                                                                                      |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Railway → `api` → Variables                                         | `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (and `SUPABASE_ANON_KEY` if set — the API code doesn't read it) |
| `apps/frontend/src/environments/environment.production.ts` (in git) | `supabaseUrl`, `supabaseAnonKey`                                                                                            |
| Vercel → lab project → Environment Variables                        | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`                                                                               |
| `apps/lab/.env.prod.local` (local only, not in git)                 | same two values, for local prod builds                                                                                      |
| Repo root `.env.prod.local` (local only)                            | `DATABASE_URL` etc. for prod scripts                                                                                        |

The API derives the JWT issuer and JWKS URL from `SUPABASE_URL`
(`apps/api/src/auth/strategies/jwt.strategy.ts`), so no code change is needed there.
Railway's public domain (`vet-ai-production.up.railway.app`, used by both `vercel.json`
rewrites) does not change when the region changes.

## Steps

### 1. Before the switch day

- Tools (done 2026-10-12 on the migration Mac):
  - PostgreSQL 17 client: `brew install postgresql@17`. Always call it by full path
    (`/opt/homebrew/opt/postgresql@17/bin/…`): a `psql` 18 from `libpq` is also installed.
  - Supabase CLI through `npx -y supabase@2.120.0` (the Homebrew install needs newer
    Command Line Tools).
- Scripts: `apps/api/prisma/region-move/` (versioned, no credentials, see its README).
  Dumps, reports and logs go to `~/region-move/` (outside the repo, `chmod 700`).
- Read-only report of Ireland, to compare after the restore:
  `ALLOW_IRELAND=yes bash apps/api/prisma/region-move/inspect.sh .env.prod.local ~/region-move/report-ireland.txt`
- List what prod has, to compare after the copy: row counts of the main tables
  (`tenants`, `users`, `user_tenant_memberships`, `catalog_items`, `orders`, …),
  `select count(*) from auth.users`, and the number of files per Storage bucket.
- Write down prod's Auth settings (Supabase → Authentication): Site URL, redirect URLs,
  email templates, SMTP settings (if any), password rules, email confirmation, JWT expiry,
  JWT signing key type.
- Agree the freeze window with Biomet.

### 2. Create the new project (can be done days before)

- New Supabase project in **East US (North Virginia), `us-east-1`**, same organization and plan.
- Authentication: copy every setting from step 1.
- **JWT signing keys**: the API verifies **ES256** tokens through JWKS. Check that the new
  project signs with an ECC (P-256) key; if it's on the legacy shared secret, create an
  ECC key and make it current before the switch.
- Storage: **don't create the buckets.** The data dump includes the `storage` schema (the
  bucket list and one metadata row per file), so buckets created here would make the
  restore fail on duplicate ids. Only the file contents are missing after the restore
  (step 4).
- **Data API: turn it off** (Project Settings → Data API) before the restore, as in Ireland
  since 2026-10-12. The apps don't use it (`docs/SECURITY_LOCKDOWN.md`).
- Extensions: **nothing to enable by hand.** `schema.sql` contains
  `CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions"` (and the other
  extensions), so the restore creates them. Checked in the stage 5 test.
- Put the new project's `DATABASE_URL` (session pooler, port 5432), `SUPABASE_URL`, anon and
  service role keys in the repo-root `.env.prod-us.local` (gitignored). URL-encode special
  characters in the database password (`#` → `%23`, `@` → `%40`, `/` → `%2F`).

### 3. Copy the database (switch day, freeze starts)

**Scripts**: `apps/api/prisma/region-move/`. `generate.sh` rebuilds them from
`supabase@2.120.0 db dump --dry-run` with a placeholder connection, so they hold no
credentials; `generated/*.generated.sh` is the exact CLI output.

`roles.sh`, `schema.sh` and `data.sh` are those files with only these changes (check with
`diff generated/roles.generated.sh roles.sh` etc.):

- lines 4–8: the placeholder `export PG…=` lines replaced by `PG*` variables set by
  `run-dump.sh`, plus `PATH` pointing at PostgreSQL 17;
- **fix 1, `roles.sh` only**: one extra `sed` at the end of the pipeline. The roles dump of
  a new project contains `GRANT SET ON PARAMETER "log_min_messages" TO
"supabase_realtime_admin"`, which `postgres` (not a superuser) can't run, and new
  projects already have it (Ireland has no parameter grants, so it's a no-op there):

  ```bash
  | sed -E 's/^GRANT (.+) ON PARAMETER (.+) TO "(supabase_.*|pgsodium_.*|pgtle_admin|dashboard_user|authenticator|anon|authenticated|service_role|pgbouncer|postgres)";$/-- [region-move] platform-managed: &/'
  ```

Every Supabase exclusion and transformation (`--exclude-schema`, `--exclude-table`,
`--role postgres`, `--no-role-passwords`, every `sed`) is kept unchanged.

- **fix 3, `roles.sh` only** (found in the rehearsal): one more `sed` comments out
  `ALTER ROLE` on Supabase's superuser-only roles. Ireland's roles dump contains
  `ALTER ROLE "supabase_admin" SET "statement_timeout" TO '0'`: the CLI comments it out,
  then its "allowed configs" step (`statement_timeout`) puts it back, and `postgres`
  can't run it. The new project already has its own settings for that role.

**Fix 2, `sql/pre-restore.sql`**: a new project automatically grants `ALL` to `anon`,
`authenticated` and `service_role` on every object created in `public`. The dump re-adds the
source's grants but doesn't take those extra ones away, so without this file **`anon` would
get access the source had revoked** (in the test: SELECT on a table, EXECUTE on a function).
It runs right before `schema.sql`, which re-emits the source's default privileges at its end:

```sql
-- [region-move] Neutralize the target's platform default privileges for objects
-- created by postgres in public, so restored objects get exactly the source's ACLs.
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES    FROM "anon", "authenticated", "service_role", "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "anon", "authenticated", "service_role", "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "anon", "authenticated", "service_role", "postgres";
```

**Dump** (read-only on the source). Refuses Ireland unless `ALLOW_IRELAND=yes`, and an
output folder inside the repo:

```bash
R=apps/api/prisma/region-move
ALLOW_IRELAND=yes bash $R/run-dump.sh .env.prod.local ~/region-move/dumps/prod
```

**Restore** into the new, empty project. `restore.sh` runs `roles.sql`, `pre-restore.sql`,
`schema.sql`, `SET session_replication_role = replica` and `data.sql` in one `psql`
transaction. It refuses Ireland, a target whose ref isn't the one passed, and a target
that already has public tables, Auth users or Storage rows:

```bash
bash $R/restore.sh ~/region-move/dumps/prod .env.prod-us.local <new-ref>
bash $R/inspect.sh .env.prod-us.local ~/region-move/report-us.txt
diff ~/region-move/report-ireland.txt ~/region-move/report-us.txt
```

Expected differences in the diff: `vector` 0.8.0 → 0.8.2 (the new project's default
version) and the stored-URL section, until the URL fix in step 4.

- It's one transaction: any error rolls everything back and the project stays empty.
- The dump files contain real data (users, password hashes): they stay in
  `~/region-move/` (`chmod 700`), never in the repo, and are deleted after the move.
- `_prisma_migrations` is copied too. Since the 2026-10-12 release Ireland has no pending
  migration (the lockdown and `20261010000001` are applied), so the new project starts
  "up to date". Check with `DATABASE_URL=<new> prisma migrate status`.
- The lockdown comes along: the restored grants and default privileges are Ireland's
  locked-down ones. After the restore, run the security tests against the new project
  (`SECURITY_TEST_READ_ONLY=1`, see `docs/SECURITY_LOCKDOWN.md`).
- The report diff covers row counts, RLS, policies, grants, functions, default
  privileges, Auth and Storage metadata.

### 4. Copy Storage files and fix saved URLs

- Copy the file contents of the 4 buckets with
  `apps/api/prisma/seeds/copy-storage.mjs`, after the restore and **before step 5** (it
  refuses to write to the project `environment.production.ts` points to):

  ```bash
  export SOURCE_SUPABASE_URL=… SOURCE_SERVICE_ROLE_KEY=…   # Ireland
  export TARGET_SUPABASE_URL=… TARGET_SERVICE_ROLE_KEY=…   # us-east-1
  node apps/api/prisma/seeds/copy-storage.mjs             # dry run: counts per bucket
  node apps/api/prisma/seeds/copy-storage.mjs --confirm   # copy
  ```

  It uploads with overwrite (the restored metadata rows already exist), so re-running
  after a failure is safe. It creates a bucket only if the restore didn't, and warns if a
  bucket's public/private setting differs. Compare the file counts with step 1.

- Rewrite stored URLs that contain the old project ref. Stage 6 found exactly two columns
  (all other URL columns store storage paths):

  | Column                                   | Rows | What it is                                   |
  | ---------------------------------------- | ---- | -------------------------------------------- |
  | `tenants."logoUrl"`                      | 3    | Current clinic/lab logos (public bucket URL) |
  | `result_report_releases."clinicLogoUrl"` | 26   | Logo URL copied into each released report    |

  ```sql
  -- in the NEW database, after the Storage copy
  update tenants set "logoUrl" = replace("logoUrl", 'mqwurrtupumsizsvurpx', '<new-ref>')
   where "logoUrl" like '%mqwurrtupumsizsvurpx%';
  update result_report_releases set "clinicLogoUrl" = replace("clinicLogoUrl", 'mqwurrtupumsizsvurpx', '<new-ref>')
   where "clinicLogoUrl" like '%mqwurrtupumsizsvurpx%';
  ```

  Re-run `inspect.sh`: its "stored values containing the old project ref" section must be
  empty.

### 5. Switch the apps

1. Railway → `api` → Variables: new `DATABASE_URL`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` (and `SUPABASE_ANON_KEY` if it's set there).
2. Railway → `api` → Settings → Regions: **`iad` (US East)**. Railway redeploys.
3. `environment.production.ts`: new `supabaseUrl` / `supabaseAnonKey` → commit, push,
   Vercel redeploys the clinic app.
4. Vercel → lab project: new `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` → redeploy
   (Vite reads them at build time, so a redeploy is required).
5. Update the local `.env.prod.local` files.

### 6. Check (freeze ends when all pass)

- Lab: a Biomet user signs in with their **existing password**; settings, team and catalog
  are there.
- Clinic app: sign in; create a case and an order; the lab sees it.
- Release a result and download the PDF report.
- Upload a clinic logo; existing logos show.
- Invitation link → onboarding completes.
- Railway logs: no errors; Sentry: no new issues.
- Import 25 clients in a test lab and read `durationMs` in the logs (expected a few
  seconds) — this closes Phase 4 of `CLIENT_BULK_IMPORT_PLAN.md`.

### 7. After

- Tell Biomet everyone must sign in again (already expected during the window).
- Keep the Ireland project 1–2 weeks, paused if possible, then delete it.
- Delete the local dump files.

## Test round trip (stage 5, 2026-10-12): passed

Run on the new project only (Ireland not touched): test objects created → dumped → removed
(back to the baseline row counts) → restored with the command in step 3 → compared.

| Item                  | Result                                                                               |
| --------------------- | ------------------------------------------------------------------------------------ |
| Auth users            | Same id, password hash and identity; **sign-in with the original password works**    |
| Storage metadata      | Bucket (private) and object row restored; the Storage API lists the file             |
| Storage file contents | Not restored ("not found") — expected, copied by `copy-storage.mjs` (step 4)         |
| RLS + policies        | RLS on, policy restored: `authenticated` reads rows, `anon` reads 0                  |
| Extensions            | `vector` 0.8.2 recreated by `schema.sql`                                             |
| Functions, triggers   | Function works and keeps `SECURITY DEFINER`; trigger fires                           |
| Data, sequences       | Rows and vector values identical; the sequence continues (next id 4)                 |
| Grants, roles         | Custom role and grant restored; `anon` has no access, as in the source (needs fix 2) |
| Default privileges    | Identical to the project's before the test                                           |

Restore time: 26 s for the test data, almost all network round trips from the laptop.

## Ireland inspection (stage 6, 2026-10-12, read-only)

Run with `inspect.sh` (sessions forced read-only) plus public Auth endpoints. Nothing was
changed in Ireland.

**Compatible, no extra step needed**

| Check                                           | Ireland                                | New project               |
| ----------------------------------------------- | -------------------------------------- | ------------------------- |
| PostgreSQL                                      | 17.6                                   | 17.11                     |
| Auth / Storage schema versions                  | 82 / 73 migrations, same latest        | same                      |
| Auth / Storage table columns                    | 344 columns                            | identical                 |
| Extensions                                      | pgvector 0.8.0, pgcrypto, uuid-ossp, … | pgvector created as 0.8.2 |
| JWT signing key                                 | ES256 (EC P-256)                       | ES256 (EC P-256)          |
| Auth settings (public endpoint)                 | email only, signup on, no autoconfirm  | same                      |
| Event triggers                                  | Supabase's 6 standard ones             | same 6                    |
| Default privileges in `public`                  | platform defaults                      | same                      |
| Custom roles, parameter grants                  | none                                   | —                         |
| Policies / triggers / functions in auth/storage | none custom                            | —                         |
| pg_cron, webhooks, vault secrets, FDWs          | none                                   | —                         |
| Realtime publication                            | no tables                              | —                         |

The custom `app_private` schema (2 `SECURITY DEFINER` functions, `is_tenant_member` and
`tenant_role`) is not a Supabase schema, so the dump includes it.

**Size**: database 25 MB (largest: `knowledge_chunks` 2.5 MB); 26 Auth users (all
email + password, none with MFA or SSO); 62 Storage files, ~12.8 MB. The freeze can be
short.

**Prisma** (at inspection time): 56 migrations applied; 4 rows are old failed attempts
later applied successfully; `20261010000001_client_tax_identity_and_import` was pending.
Both it and the lockdown were applied on 2026-10-12 (see below), so there's nothing
pending now. `users` has 27 rows vs 26 Auth users (one app user without
an Auth account; copied as is).

**Not copyable through the database (dashboard, by hand)**: Site URL, redirect URLs,
email templates, SMTP, rate limits, JWT expiry, and the Data API settings.

### Security finding — fixed 2026-10-12

The inspection found 19 `public` tables with RLS off and full `anon` / `authenticated`
grants on all 45 tables, reachable through the Data API with the public anon key. Fixed
in Ireland before the move: Data API off, and migration
`20261008000000_lock_down_public_schema` (RLS on everywhere, no `anon` / `authenticated`
privileges, locked-down default privileges). Released together with the client import
on 2026-10-12. Details, tests and checklist: `docs/SECURITY_LOCKDOWN.md`.

For the move: the dump carries the locked-down state, so nothing extra is needed beyond
turning the Data API off in the new project (step 2) and running the security tests after
the restore (step 3).

## Rehearsal (2026-10-12): passed

Run from the laptop with the scripts on `feat/region-move-us-east`: Ireland only read,
writes only to `kesherio-prod-us`, nothing switched.

| Step                              | Time  | Result                                                                                                                               |
| --------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Dump Ireland (`run-dump.sh`)      | 45 s  | 6.7 MB of data; `pg_dump` warns about circular FKs, harmless with `session_replication_role = replica`                               |
| Restore (`restore.sh`)            | 122 s | 0 errors, 46 tables with rows. First attempt failed on `ALTER ROLE "supabase_admin"` and rolled back → fix 3                         |
| Storage copy (`copy-storage.mjs`) | 41 s  | 66 files, 12.6 MB; 0 missing or different size                                                                                       |
| URL fix (step 4)                  | < 1 s | `tenants.logoUrl` 3 rows, `result_report_releases.clinicLogoUrl` 27 rows; a rewritten logo URL serves the image from the new project |

Checks:

- `inspect.sh` diff Ireland vs US: only `vector` 0.8.0 → 0.8.2 and the stored-URL section
  (rewritten in US). Row counts, RLS, policies, grants, functions, default privileges,
  Auth and Storage metadata identical.
- Security tests on US (read-only) 12/12; Data API HTTP check 21/21 (off, 503).
- `prisma migrate status` on US: up to date.
- Auth on US: ES256 JWKS, same public settings as Ireland; 26 users, all with password
  hashes and identities.
- API-style queries (orders, ordered tests, RAG vector operator) work.

Not tested yet: signing in with a real password against the new project, and the apps
pointed at it (that happens on the switch day, step 6).

**Freeze estimate**: ~5 min of copy work, plus ~10 min for the switch (Railway variables
and region, `environment.production.ts`, Vercel lab variables, redeploys), plus the checks
in step 6. Plan a **45-minute** window.

**After the rehearsal**: `kesherio-prod-us` was emptied in place with
`apps/api/prisma/region-move/reset-target.mjs` (51 s): 66 files and 4 buckets (Storage
API), 26 Auth users (Auth admin API), `app_private` and the 82 objects in `public`
(45 tables, 37 enums). Afterwards every Auth / Storage / `public` table matches the
fresh-project baseline and `restore.sh`'s emptiness check passes. Kept: Data API off,
Auth settings and keys, extensions, role settings. The `public` default privileges stay
the locked-down ones from Ireland (`pre-restore.sql` handles either state).

## Rollback

Until the old project is deleted: put the old values back in Railway, Vercel and
`environment.production.ts`, and move Railway back to `sfo`. Anything written in the new
project after the switch would be lost, so decide quickly (during the check in step 6).

## Open items

- Security finding: fixed and released 2026-10-12 (`docs/SECURITY_LOCKDOWN.md`). The
  rehearsal can resume.
- Copy the Auth settings the public endpoint doesn't show (Site URL, redirect URLs, email
  templates, SMTP, rate limits, JWT expiry) from the Ireland dashboard to the new one.
- Dev stays in Tokyo for now; moving it later is optional (`bootstrap-dev-project.mjs`).

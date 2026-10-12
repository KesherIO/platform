# Region move scripts

Scripts for moving production from Ireland (`eu-west-1`) to US East (`us-east-1`).
The full procedure, decisions and test results are in
[`docs/REGION_MIGRATION_PLAN.md`](../../../../docs/REGION_MIGRATION_PLAN.md).

**No credentials live here.** Every script takes the path of a gitignored env file
(`.env.prod.local` = Ireland, `.env.prod-us.local` = new project) and reads
`DATABASE_URL`, `SUPABASE_URL` and the keys at run time. Dumps contain real data and
must be written outside the repo (`run-dump.sh` refuses a path inside it).

## Requirements

- PostgreSQL 17 client tools: `brew install postgresql@17` (both servers are 17).
  Override the location with `PG_BIN=/path/to/bin`.
- Node 22+ (for `npx supabase` in `generate.sh`, and `copy-storage.mjs`).
- No Docker: the Supabase CLI only generates the dump scripts (`--dry-run`).
- `DATABASE_URL` = the **session pooler** URI (port 5432), with special characters in
  the password URL-encoded (`#` → `%23`, `@` → `%40`, `/` → `%2F`).

## Files

| File                             | What it does                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `generate.sh`                    | Regenerates `generated/*.generated.sh` with `supabase@2.120.0 db dump --dry-run` and rebuilds `roles.sh`, `schema.sh`, `data.sh` from them |
| `generated/*.generated.sh`       | Exact CLI output, with a placeholder connection                                                                                            |
| `roles.sh` `schema.sh` `data.sh` | Runnable dump scripts. Differences from the CLI output: `diff generated/roles.generated.sh roles.sh`                                       |
| `run-dump.sh`                    | `run-dump.sh <env-file> <out-dir>` — read-only dump of one project                                                                         |
| `restore.sh`                     | `restore.sh <dump-dir> <target-env-file> <expected-ref>` — one-transaction restore into an empty project                                   |
| `sql/pre-restore.sql`            | Fix 2: removes the new project's automatic grants before `schema.sql`                                                                      |
| `inspect.sh`                     | `inspect.sh <env-file> <report-file> [old-ref]` — read-only report; diff two reports to compare projects                                   |
| `sql/inspect.sql`                | The report's queries                                                                                                                       |
| `lib/env.sh`                     | Loads an env file, guards, read-only `psql`                                                                                                |

Storage file contents are copied by `../seeds/copy-storage.mjs`.

## Changes from the Supabase CLI output

Every Supabase exclusion and transformation is kept. Only:

1. **All three scripts, lines 4–8**: the placeholder connection is replaced by `PG*`
   variables set by `run-dump.sh`, plus `PATH` to PostgreSQL 17.
2. **`roles.sh` (fix 1)**: one extra `sed` comments out `GRANT … ON PARAMETER … TO`
   Supabase's own roles. `postgres` isn't a superuser and can't run them, and new
   projects already have them.
3. **`sql/pre-restore.sql` (fix 2)**: without it the restored objects get the new
   project's default `ALL` grants to `anon`/`authenticated`/`service_role` on top of the
   source's grants.

## Guards

- Ireland (`mqwurrtupumsizsvurpx`) can only be **read**, and only with `ALLOW_IRELAND=yes`.
  `inspect.sh` sessions are forced read-only and checked.
- `restore.sh` never writes to Ireland, checks the target ref against the one you pass,
  and refuses a target that already has public tables, Auth users or Storage rows.
- Env files whose `SUPABASE_URL` or keys belong to a different project than
  `DATABASE_URL` are rejected.

## Order (see the plan for the full steps)

```bash
R=apps/api/prisma/region-move
ALLOW_IRELAND=yes bash $R/inspect.sh .env.prod.local ~/region-move/report-ireland.txt
ALLOW_IRELAND=yes bash $R/run-dump.sh .env.prod.local ~/region-move/dumps/prod
bash $R/restore.sh ~/region-move/dumps/prod .env.prod-us.local <new-ref>
bash $R/inspect.sh .env.prod-us.local ~/region-move/report-us.txt
diff ~/region-move/report-ireland.txt ~/region-move/report-us.txt
```

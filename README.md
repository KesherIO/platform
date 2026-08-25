# Vet AI

A multi-tenant veterinary lab platform, built as an Nx monorepo.

<a alt="Nx logo" href="https://nx.dev" target="_blank" rel="noreferrer"><img src="https://raw.githubusercontent.com/nrwl/nx/master/images/nx-logo.png" width="45"></a>

## Apps

| App        | Path            | Stack                         | Description                                                                                                            |
| ---------- | --------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `frontend` | `apps/frontend` | Angular 21 (standalone, PWA)  | Clinic-facing app — vets create cases, order lab tests, view results.                                                  |
| `lab`      | `apps/lab`      | React 19 + Vite               | Lab-staff-facing portal — orders queue, result entry/release, lab settings, team management.                           |
| `api`      | `apps/api`      | NestJS 11 + Prisma/PostgreSQL | Shared REST API for both frontends, plus a remote MCP server (`/api/mcp`) exposing lab-order and knowledge-base tools. |

## Shared libraries

- `libs/shared-types` (`@vet-ai/shared-types`) — shared DTOs/models used by `frontend` and `api`. Note: `lab` does **not** import from this lib — it keeps its own local domain types in `apps/lab/src/app/types/lab.types.ts`.

## Multi-tenancy model

Every account is scoped to one or more `Tenant` rows via a `UserTenantMembership` (a user can belong to more than one tenant, each with its own role). A tenant's `type` (`apps/api/prisma/schema.prisma`, `TenantType` enum) says what kind of organization it is:

| `type`     | Meaning                                                                    | Served by       |
| ---------- | -------------------------------------------------------------------------- | --------------- |
| `CLINIC`   | A veterinary clinic — creates cases, orders lab tests, views results.      | `apps/frontend` |
| `LAB`      | An external reference laboratory — processes orders, manages test reports. | `apps/lab`      |
| `PLATFORM` | The KesherIO platform tenant itself (singleton).                           | `apps/lab`      |

A `ClinicLabConnection` row links a specific `CLINIC` tenant to the `LAB`/`PLATFORM` tenant that processes its orders. Nothing in the schema stops one `User` from holding memberships in tenants of different types at once (e.g. a lab technician account and a clinic account).

**Known gap:** `GET /auth/me` (consumed by `apps/frontend`) does not filter a user's memberships by `tenant.type`, and the clinic-side `TenantGuard` doesn't verify the resolved tenant is `type: CLINIC` — unlike `LabTenantGuard`, which explicitly rejects tenants that aren't `LAB`/`PLATFORM`. In practice, a user whose _only_ membership is to a `LAB`/`PLATFORM` tenant can still log into `apps/frontend` and be shown that tenant as if it were their clinic, with no warning. Don't assume the clinic app is showing clinic data just because it loaded — check the account's actual tenant memberships first.

## Running the apps

```sh
npx nx serve frontend   # http://localhost:4200
npx nx serve lab        # http://localhost:4201
npx nx serve api        # http://localhost:3000/api (Swagger at /api/docs)
```

Auth for both frontends is via Supabase; `api` verifies the resulting JWT (no login endpoint lives in this API).

---

## Catalog, templates, and result matching

### How it works

When a vet orders a test, the order contains a **catalog item** from the lab's own catalog. Each catalog item has a short **code** (e.g. `CBC`, `CA`, `CREA`). When the lab enters results for that test, the API looks up a **result template** using that exact code — the template defines the analytes, reference ranges, and sections that appear in the result form.

The lookup priority is:

1. A **LABORATORY-scope** template for the lab's tenant that matches the patient's species and age — most specific wins.
2. A **PLATFORM-scope** template (shipped with the platform) that matches the same criteria — used as a fallback.

If no template matches the code at all, the result is marked as "blocked — no template."

### Platform catalog codes

The platform ships with ~100 standard test codes in `apps/api/prisma/seeds/catalog.json`. These codes are the keys that tie catalog items to result templates:

| Code   | Name (ES)          |
| ------ | ------------------ |
| `CBC`  | Hemograma Completo |
| `CA`   | Calcio             |
| `CL`   | Cloro              |
| `CREA` | Creatinina         |
| `ALB`  | Albúmina           |
| `GLU`  | Glucosa            |
| `ALT`  | ALT (GPT)          |
| …      | (and ~90 more)     |

The platform's 170 result templates (`apps/api/prisma/seeds/templates/`) use these same codes, so a lab that imports the platform catalog gets automatic template matching for every standard test.

### catalog.json format

```json
{
  "replace": false,
  "items": [
    {
      "kind": "TEST",
      "code": "CBC",
      "name": "Hemograma Completo",
      "category": "Hematología",
      "turnaroundHours": 4
    },
    {
      "kind": "PACKAGE",
      "name": "Perfil Bioquímico Básico",
      "category": "Bioquímica",
      "componentCodes": ["GLU", "BUN", "CREA", "ALT", "AST", "ALP", "TP", "ALB"]
    }
  ]
}
```

| Field             | Required      | Notes                                     |
| ----------------- | ------------- | ----------------------------------------- |
| `kind`            | ✓             | `TEST` or `PACKAGE`                       |
| `code`            | For `TEST`    | Upsert key — stable once in use           |
| `name`            | ✓             | Display name                              |
| `category`        | –             | Groups tests in the UI                    |
| `turnaroundHours` | –             | Expected lab processing time              |
| `unit`            | –             | e.g. `mg/dL`                              |
| `resultType`      | –             | `NUMERIC`, `TEXT`, or `POSITIVE_NEGATIVE` |
| `componentCodes`  | For `PACKAGE` | Codes of the TEST items it bundles        |

### New lab onboarding flow

1. **Create the lab tenant** — run `node apps/api/prisma/seeds/seed-lab-tenant.mjs` (dev) or create via the onboarding API endpoint.
2. **Seed platform templates** _(one-time, platform admin)_ — run `node apps/api/prisma/seeds/seed-platform-templates.mjs`. This loads all 170 platform result templates (from `apps/api/prisma/seeds/templates/*.json`) into the DB as `scope: PLATFORM` definitions. These are shared across all labs — only needs to run once per database.
3. **Import the platform catalog** — in the Lab portal → **Settings** page (Admin/Owner only), use the **"Import Platform Catalog"** button in the Catalog Setup section. This upserts all standard test codes into the lab's own catalog. Alternatively: `node apps/api/prisma/seeds/seed-platform-catalog.mjs`.
4. **Result templates activate automatically** — because the lab's catalog items now share the same codes as the platform templates (CA, CBC, CREA…), every standard test is immediately ready for result entry. The `resolveTemplate()` logic picks the best matching PLATFORM or LABORATORY template automatically.
5. **Customize** — labs can create additional catalog items with custom codes for tests not in the platform catalog, then build result templates for those codes in the Templates section of the Lab portal.

### Custom catalog items and templates

If a lab runs a proprietary test (e.g. `MYLAB-PCR-PARVO`):

- Create the catalog item with that code in **Catalog → Create**.
- Build a result template keyed to the same code in **Templates → New Template**.
- Publish the template — it will now be used automatically when that test is ordered.

Custom templates take priority over platform templates for the same code and species combination.

### Importing your own catalog (file upload)

Labs that maintain their own test menus (from a LIMS, internal spreadsheet, etc.) can bulk-import them via the **Catalog** page in the Lab portal:

1. Click the **`⋮` menu** (three-dot icon) next to the Import button and choose **"Download CSV template"** or **"Download JSON template"** — open the CSV in Excel/Google Sheets to fill in your tests.
2. Click **"Import Catalog"** and select your `.csv` or `.json` file.
3. Review the confirmation dialog (shows item counts) and confirm.

The import uses **upsert** mode: items with the same `code` (or `name` if no code) are updated; new items are created. Existing items not in the file are left untouched.

#### CSV format (recommended)

The easiest way — open in any spreadsheet app, fill in rows, save as CSV.

```csv
kind,code,name,category,turnaroundHours,resultType,unit,description,componentCodes
TEST,MYLAB-CBC,Complete Blood Count,Hematology,4,NUMERIC,cells/uL,,
TEST,MYLAB-CHEM,Chemistry Panel,Chemistry,2,NUMERIC,,,
PACKAGE,MYLAB-WELLNESS,Wellness Panel,General,,,,,MYLAB-CBC;MYLAB-CHEM
```

- First row must be the header (column names are case-insensitive)
- `kind` values are case-insensitive (`test`, `Test`, `TEST` all work)
- `componentCodes` uses **semicolons** to separate multiple codes (e.g. `CBC;CHEM;UA`)
- Empty fields are fine — only `kind` and `name` are required
- Quoted fields are supported (e.g. `"Test with, comma in name"`)

#### JSON format

For programmatic integrations or when you need full control:

```json
{
  "items": [
    {
      "kind": "TEST",
      "code": "MYLAB-CBC",
      "name": "Complete Blood Count",
      "category": "Hematology",
      "turnaroundHours": 4,
      "resultType": "NUMERIC",
      "unit": "cells/uL"
    },
    {
      "kind": "PACKAGE",
      "code": "MYLAB-WELLNESS",
      "name": "Wellness Panel",
      "category": "General",
      "componentCodes": ["MYLAB-CBC", "MYLAB-CHEM"]
    }
  ]
}
```

#### Field reference

| Field             | Required      | Type                                            | Notes                                                                                                                                                                           |
| ----------------- | ------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`            | Yes           | `"TEST"` or `"PACKAGE"`                         |                                                                                                                                                                                 |
| `name`            | Yes           | string                                          | Display name                                                                                                                                                                    |
| `code`            | Recommended   | string                                          | Unique lab code — used as the upsert key and to link with result templates. Once in use on orders, it should not change.                                                        |
| `category`        | No            | string                                          | Groups items in the UI (e.g. `"Hematology"`, `"Chemistry"`)                                                                                                                     |
| `turnaroundHours` | No            | positive integer                                | Expected processing time                                                                                                                                                        |
| `resultType`      | No            | `"NUMERIC"`, `"TEXT"`, or `"POSITIVE_NEGATIVE"` | Defines how results are entered                                                                                                                                                 |
| `unit`            | No            | string                                          | Unit of measurement for `NUMERIC` results (e.g. `"mg/dL"`)                                                                                                                      |
| `description`     | No            | string                                          | Free-text description                                                                                                                                                           |
| `componentCodes`  | For `PACKAGE` | string[]                                        | Codes of the `TEST` items included in this package. In CSV, separate with semicolons (`CBC;CHEM`). In JSON, use an array. All referenced codes must exist in the lab's catalog. |

#### API endpoint

`POST /api/lab/catalog/import` (JWT-authenticated, Admin/Owner only)

Request body matches the file format above. The `labTenantId` is injected from the JWT — it is never sent by the client.

---

[Learn more about this workspace setup and its capabilities](https://nx.dev/nx-api/js?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) or run `npx nx graph` to visually explore what was created. Now, let's get you up to speed!

## Finish your Nx platform setup

🚀 [Finish setting up your workspace](https://cloud.nx.app/connect/yGvrLDWXca) to get faster builds with remote caching, distributed task execution, and self-healing CI. [Learn more about Nx Cloud](https://nx.dev/ci/intro/why-nx-cloud).

## Generate a library

```sh
npx nx g @nx/js:lib packages/pkg1 --publishable --importPath=@my-org/pkg1
```

## Run tasks

To build the library use:

```sh
npx nx build pkg1
```

To run any task with Nx use:

```sh
npx nx <target> <project-name>
```

These targets are either [inferred automatically](https://nx.dev/concepts/inferred-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) or defined in the `project.json` or `package.json` files.

[More about running tasks in the docs &raquo;](https://nx.dev/features/run-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Versioning and releasing

To version and release the library use

```
npx nx release
```

Pass `--dry-run` to see what would happen without actually releasing the library.

[Learn more about Nx release &raquo;](https://nx.dev/features/manage-releases?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Keep TypeScript project references up to date

Nx automatically updates TypeScript [project references](https://www.typescriptlang.org/docs/handbook/project-references.html) in `tsconfig.json` files to ensure they remain accurate based on your project dependencies (`import` or `require` statements). This sync is automatically done when running tasks such as `build` or `typecheck`, which require updated references to function correctly.

To manually trigger the process to sync the project graph dependencies information to the TypeScript project references, run the following command:

```sh
npx nx sync
```

You can enforce that the TypeScript project references are always in the correct state when running in CI by adding a step to your CI job configuration that runs the following command:

```sh
npx nx sync:check
```

[Learn more about nx sync](https://nx.dev/reference/nx-commands#sync)

## Nx Cloud

Nx Cloud ensures a [fast and scalable CI](https://nx.dev/ci/intro/why-nx-cloud?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) pipeline. It includes features such as:

- [Remote caching](https://nx.dev/ci/features/remote-cache?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Task distribution across multiple machines](https://nx.dev/ci/features/distribute-task-execution?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Automated e2e test splitting](https://nx.dev/ci/features/split-e2e-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Task flakiness detection and rerunning](https://nx.dev/ci/features/flaky-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

### Set up CI (non-Github Actions CI)

**Note:** This is only required if your CI provider is not GitHub Actions.

Use the following command to configure a CI workflow for your workspace:

```sh
npx nx g ci-workflow
```

[Learn more about Nx on CI](https://nx.dev/ci/intro/ci-with-nx#ready-get-started-with-your-provider?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Install Nx Console

Nx Console is an editor extension that enriches your developer experience. It lets you run tasks, generate code, and improves code autocompletion in your IDE. It is available for VSCode and IntelliJ.

[Install Nx Console &raquo;](https://nx.dev/getting-started/editor-setup?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Useful links

Learn more:

- [Learn more about this workspace setup](https://nx.dev/nx-api/js?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Learn about Nx on CI](https://nx.dev/ci/intro/ci-with-nx?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Releasing Packages with Nx release](https://nx.dev/features/manage-releases?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [What are Nx plugins?](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

And join the Nx community:

- [Discord](https://go.nx.dev/community)
- [Follow us on X](https://twitter.com/nxdevtools) or [LinkedIn](https://www.linkedin.com/company/nrwl)
- [Our Youtube channel](https://www.youtube.com/@nxdevtools)
- [Our blog](https://nx.dev/blog?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

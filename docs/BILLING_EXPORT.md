# Billing codes and billing export

Lab-facing feature (setting codes: Owner/Admin; downloading: Owner/Admin and Consulta with the in-progress checkbox): give catalog items the lab's own billing
codes, then download the ordered services for a date range to upload into the
lab's billing system. Code: `apps/api/src/billing/`, lab UI:
`apps/lab/src/app/pages/billing/` and the Catalog page.

## Rules

**What is charged** — from `Order.orderedItems` (the lines the clinic placed,
plus tests added later), never from the expanded `OrderedTest` rows.

- A package/profile is **one** line with its own billing code; its component
  tests are never charged separately.
- A test added later is a separate line.
- Quantity is not modelled on an order line: every line is `1`.
- Pending and completed orders are both included. No prices, no results.
- Amendments, re-releases and specimen replacements never touch order lines, so
  they cannot create a charge.

**Partial-package rule (documented decision).** A line is cancelled only when
its order is cancelled, or when **every** test performed for it is cancelled
(`OrderedTestSource.originalOrderItemKey` links a test to its line). A package
with only some components cancelled is **still billed in full**. If Biomet wants
a different rule, it changes in `billable-lines.util.ts` only.

**Date format (documented decision).** `fecha` is the order's **creation** day
(never completion/release) as ISO 8601 `YYYY-MM-DD`, evaluated in the lab's
timezone (`Tenant.timezone`), written as text in both Excel and CSV so a
spreadsheet never reinterprets it with a regional format. The range is
inclusive on both days in the same timezone. A lab whose timezone was never set
falls back to `UTC`, which shifts day boundaries — set it first (below).

**Files.** Exactly `fecha, entidad, item, cantidad, nombre del paciente`.
`entidad` = ordering clinic name, `item` = billing code. CSV is UTF-8 with BOM,
CRLF, every value quoted; a value starting with `= + - @` gets a leading `'`
(never run as a formula). Excel cells are plain strings.

**Missing codes.** The preview lists every service without a code and
generation is refused until each has one. Nothing is dropped, and the internal
code is never substituted.

**Billing-code uniqueness — AWAITING BIOMET CONFIRMATION.** Currently a code is
unique within a lab (case-insensitive, enforced in the service; the DB index
`(labTenantId, billingCode)` is case-sensitive), and unmapped items (`NULL`) do
not collide. If Biomet needs one code to cover two catalog items, drop the
unique index and `assertBillingCodeAvailable`. Codes assigned to *deleted*
items are not subject to this rule.

## Catalog import

`replace: true` is **unsupported**: it is rejected with a 400
(`CATALOG_REPLACE_UNSUPPORTED`) before anything is read or deleted, because
deleting a lab's items orphans past orders and cases and wipes billing codes.
Normal imports upsert by code (else name) and never delete. A re-import that
omits `billingCode` keeps the existing one.

## Order lines whose catalog item was deleted

The export shows them as "no longer in your catalog" and blocks. An Owner/Admin
can assign a **reviewed** code (`PUT /lab/billing/deleted-items/:id/code`, with
a confirmation showing the item, how many lines/orders are affected). It is
stored in `billing_deleted_item_codes`, keyed by the deleted item's id, and
used only while exporting. Orders are never modified, no catalog item is
recreated, files already generated keep the code they had, and the order line's
internal code is never used. Only ids that are absent from every catalog and
referenced by one of the lab's own orders are accepted.

## Repeated exports, atomicity and concurrency

- Generating records the exact rows (`billing_exports` + `billing_export_lines`,
  billing code included). Re-downloading returns those rows, whatever the
  catalog says today. "Generated" never means "uploaded" or "billed".
- Previously exported lines are **flagged, not hidden**; "only new" is opt-in.
  Lines exported and since cancelled are listed. A test added after an export
  shows as new in an order that was already exported.
- `generate` runs in **one transaction**: lock, recompute, create the export and
  all its lines. Any failure rolls everything back (no export without its lines,
  no lines without an export).
- The transaction takes a per-lab advisory lock (`pg_advisory_xact_lock`), so
  simultaneous generations for one lab run one after the other. With
  **"only new"**, the second request waits, sees the first one's committed lines
  and gets only what is left — normally `NOTHING_TO_EXPORT` — so two files never
  overlap. Without it, both files contain every line (nothing is hidden) and the
  second is marked as a repeat. Different labs never block each other.
- To avoid double uploads, staff should upload one generated file per range, or
  use "only new" for follow-up files, and check the history before re-uploading.

## Permissions

**Who can do what**

| | Owner / Admin | Consulta **with** "Puede ver órdenes en proceso" (the Facturación user) | Consulta without it | Analyst, Reviewer, Messenger, others |
|---|---|---|---|---|
| Preview, generate, history, re-download (pending **and** completed orders) | yes | yes | no | no |
| Set billing codes: mapping, deleted-item codes, catalog edits | yes | no | no | no |
| See the Catalog tab and manage catalogs | yes | no | no | no |

Consulta without the checkbox cannot download because the export includes
pending orders. The export has no result values; Consulta already sees clinic
and patient names in Results.

**Where it appears in the lab portal.** Owner/Admin: a **Facturación** tab, the
button on the Catalog page and the button on the Results page. Consulta with
the checkbox: a **Facturación** tab next to Results, and the button on the
Results page (the only other pages they can open). When a service has no code,
Consulta sees "an administrator needs to assign this billing code" instead of
the code fields.

**Server rules.** Every route needs a valid JWT, an active membership in the lab
named by `X-Tenant-ID`, and a role from the table (`LabTenantGuard` + `@Roles`).
The four download routes also pass `BillingExportAccessGuard`, which refuses
Consulta without the checkbox. `labTenantId` always comes from that membership;
the global `ValidationPipe` (`whitelist: true`) strips any lab id sent in a body.

| Route | Roles |
|---|---|
| `GET lab/billing/exports/preview` | Owner, Admin, Consulta + checkbox |
| `POST lab/billing/exports` (generate) | Owner, Admin, Consulta + checkbox |
| `GET lab/billing/exports` (history), `GET lab/billing/exports/:id` (re-download) | Owner, Admin, Consulta + checkbox |
| `POST lab/billing/mapping/suggest`, `POST lab/billing/mapping/apply` | Owner, Admin |
| `PUT / DELETE lab/billing/deleted-items/:catalogItemId/code` | Owner, Admin |
| `PATCH catalog/:id` (inline mapping, existing route) | Owner, Admin |

Tests: `lab-routes.authz.spec.ts` (route table), `billing-export-access.guard.spec.ts`,
`billing.http.int.spec.ts` (real HTTP, real guard, real DB: every route × every
role, Consulta with and without the checkbox, cross-lab, smuggled lab ids),
`billing.int.spec.ts` (rollback, concurrency, isolation, SQL), `Layout.spec.tsx`
(tabs and redirects).

## Dev migration and timezone steps (do not run against production)

1. Make sure `apps/api/.env` `DATABASE_URL` is the **dev** project
   (`kesherio-dev`), not production.
2. `cd apps/api && npx prisma migrate status` — only
   `20261018000006_billing_codes_and_exports` should be pending.
3. `npx prisma migrate deploy`, then `npx prisma generate`.
4. Restart the API.
5. Set the lab's timezone, either in the lab portal (Settings → Laboratory →
   time zone `America/Bogota`) or in SQL:
   ```sql
   SELECT id, name, timezone FROM tenants WHERE type = 'LAB';
   UPDATE tenants SET timezone = 'America/Bogota'
   WHERE id = '<biomet lab id>' AND type = 'LAB';
   ```

Note: a *new empty* database cannot currently be built from `prisma/migrations`
alone (`20260711000000_enable_rls_knowledge_tables` references
`knowledge_documents`, which no migration creates). This predates the feature.

# Client Bulk Import — Implementation Plan (rev. 3)

## Goal

Lab admins can create many clients at once from a CSV or Excel file, instead of one by
one with **Add client**. It must work for any lab in South America: every lab arrives with
its own columns, language and ID formats.

Trigger case: the first lab has ~154 clients in a Google Form export
(`CREACION DE CLIENTES (respuestas) - Respuestas de formulario 1.csv`).

## Confirmed decisions

- CSV and XLSX, column mapping the lab can reuse, default client type **Veterinary clinic**.
- **Import first, invite later.** Import creates client organizations and their lab
  connection only: no users, no invitation tokens.
- Import **only creates**. It never updates or links an existing client.
- Tax ID is **optional everywhere**.
- No email sending and no bulk invitation generation in v1.
- Legal name / tax ID on result PDFs: outside this feature.
- Unknown columns default to **Ignore**. A column goes into Notes only if the user maps it
  there. No "use legal name as contact name" option.

---

## Part A — Review findings

What already works, what has to change, and the tradeoffs, checked against the code.

### A0. Two facts that change the scope

**1. A pending client cannot receive orders before onboarding. The earlier plan was
wrong about this.**

There is only one place that creates an order: `OrdersService.createOrderForCase`
(`apps/api/src/orders/orders.service.ts:29`, the only `order.create`, at line 262). It runs
for an authenticated **clinic** user (`TenantGuard`, `orders.controller.ts:15`), from an
existing `Case` of that clinic. The lab has no endpoint to create an order for a client. A
client without users (every imported or manually added client before onboarding) has
nobody who can create a case or an order.

This is how **Add client** works today too, so import changes nothing here. It means
imported clients are a **client list waiting for onboarding**, not clients the lab can
start working for. If the first lab needs to register samples for clinics that haven't
onboarded (e.g. paper requisitions), that is a separate feature: lab-side order entry.
It's not in this plan.

**2. Existing security issue in onboarding. Fix it before sending invitations to
imported clients.**

`completeAdminOnboarding` (`apps/api/src/onboarding/onboarding.service.ts:794-819`), for a
lab-created client: when `dto.adminEmail` belongs to an existing `User` with no membership
in that clinic, the code **sets that user's Supabase password** to the one submitted in the
form (`authService.updateSupabaseUserPassword`). `adminEmail` is typed by whoever holds the
link, and nothing ties it to the invited clinic's email. So anyone with a valid lab
invitation link can set the password of any existing account whose email they know.

The problem exists today for single clients. Bulk import makes it worse: it creates
pending clients by the hundred, and their links will travel over WhatsApp. **Phase 0** fixes it
in its own PR: never change the password of an existing user during onboarding. Instead,
the existing user signs in first (Supabase session on the client); the server checks that
the JWT `sub` equals that user's id, then adds the membership. New users keep the current
"create account" path.

### A1. Clinics already in KesherIO through another lab

**How it works today**

- `createClient` (`apps/api/src/lab/lab-clients.service.ts:236`) only checks for a
  duplicate **email among clinics connected to this lab** (lines 241-253). A clinic
  that already exists through lab A gets a **second, separate tenant** when lab B adds it.
- There is no process today to connect an existing clinic to another lab.
  `ClinicLabConnection` is only created in `createClient` (line 287), and onboarding with a
  lab token always activates the pre-created tenant (`onboarding.service.ts:888-906`).
- The email check is **case-sensitive** (`email: dto.primaryContactEmail`, and
  `buildClinicProfileUpdate` trims but doesn't lowercase). `Clinic@x.com` and `clinic@x.com`
  become two clients of the same lab.

**Why import must not match clinics outside the lab**

If the import looked up clinics across all of KesherIO, it would:

- **reveal another lab's clients**: "skipped, this clinic already exists" tells lab B that
  the email or tax ID is a client of some other lab;
- **give lab B power over a clinic it doesn't own**:
  - `updateClient` (line 320) writes the shared `Tenant` profile;
  - `suspendClient` sets `Tenant.clientStatus`, which is a single value for the whole
    clinic, not per lab;
  - `getClientDetail` lists the clinic's last 10 orders without filtering by lab
    (lines 147-160), so lab B would see orders sent to lab A.

**Decision**

- Import works exactly like Add client: every new row becomes a **new tenant owned by this
  lab**, and duplicates are checked **only among this lab's clients**. Import never reads,
  links or edits a tenant connected only to other labs, and responses never mention them.
- Tradeoff: a clinic that already uses KesherIO with lab A will exist twice (once per lab)
  until there is a real "connect an existing clinic" feature. That feature needs the
  clinic's own consent (the clinic admin accepts lab B), plus the per-lab fixes above
  (status per connection, orders filtered by lab). It's listed as a follow-up. The
  duplicate keeps tenants isolated and doesn't make anything worse than it is today.
- The case-insensitive email fix goes into the shared create helper (A2). Add client
  benefits from it as well.

### A2. Concurrent imports and safe retries

**Problem:** loading existing emails once, then inserting, is check-then-insert. Two imports at the
same time, or an import and Add client, can both pass the check and both insert. There's no
unique constraint to stop them: `Tenant.email` isn't unique (and can't be: the same clinic
can be a separate tenant per lab, see A1), and `ClinicLabConnection` is only unique on
`(clinicId, labId)` (`schema.prisma:1050`).

**Options considered**

| Option                                                       | Pros                                                 | Cons                                                                                                                                                    |
| ------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unique "identity keys" table `(labId, kind, value)`          | Enforced by the database                             | Copies email/tax ID that change from 4 places (lab edit, onboarding, clinic settings, import). Keeping it in sync is new code and a new source of bugs. |
| Unique columns on `ClinicLabConnection` (email key, tax key) | Enforced by the database                             | Same sync problem: the values live on the shared `Tenant`.                                                                                              |
| **Per-lab transaction lock + check inside the transaction**  | No copied data; checks the live values; small change | Every create path must use it. Solved by having **one** create helper.                                                                                  |

**Decision: per-lab advisory lock.** Every client creation for a lab (import rows and Add
client) goes through one helper, `createClinicForLab(tx, …)`, which:

1. Takes `SELECT pg_advisory_xact_lock(hashtextextended('clinic-create:' || $labId, 0))`.
   It's held until the transaction ends; creations for **the same lab** queue behind each
   other, other labs aren't affected. It works with the Supabase session pooler we use
   (`DATABASE_URL`, port 5432) and would also work with transaction pooling, because the
   lock is scoped to the transaction. A hash collision between two labs would only make
   them wait for each other, never give a wrong result.
2. Inside the same transaction, looks for a clinic **connected to this lab** with the same
   email (case-insensitive), or the same **(country, ID type, normalized ID)** when a tax
   ID is given.
3. Creates the tenant and the connection only if nothing matched.

The codebase already uses transaction locks for the same kind of problem (`FOR UPDATE` in
`deleteClient`, line 473; `release.service.ts:244`). A transaction lock is used here
instead of `FOR UPDATE` on the lab's tenant row: that row lock would also block every
insert that references the lab (orders, results…) while held.

**Safe retries.** The request carries an `importBatchId` (UUID created by the browser when
the import starts). Each created connection stores `importBatchId`, `importRowNumber` and
`importRowHash`: a SHA-256 of the row's normalized submitted values (email, name, country,
ID type, normalized ID, and the other fields). The database enforces
`@@unique([labId, importBatchId, importRowNumber])`. Connections created by Add client
leave these fields null, and Postgres allows any number of null rows in a unique index.

**Order of checks for each row (inside the lock):**

1. **Replay lookup first**, by `(labId, importBatchId, importRowNumber)`. Checking by
   identity instead of by email or tax ID means a retry is still recognized even if
   someone edited the client's profile between the two attempts.
   - Found with the same `importRowHash` → it's a **replay** of a request that timed out:
     return `created` with that `clientId`, insert nothing.
   - Found with a different hash → `status: 'conflict'`, reason
     `BATCH_ROW_MISMATCH`, insert nothing. The same batch and row number can't be reused
     for different data. The normal UI never does this; it would mean a bug or a tampered
     request.
2. **Duplicate check** by email (case-insensitive) or tax key, among this lab's clients:
   - the match was created by the same batch with another row number →
     `skipped: DUPLICATE_IN_FILE`;
   - otherwise → `skipped: EMAIL_EXISTS` or `TAX_ID_EXISTS`.
3. **Create** the tenant and the connection.

Importing the same file again later (new batch id) skips every row that was already
created, at step 2. Nothing gets duplicated either way.

**Tax ID comparison** uses `country + taxIdType + taxIdNormalized`, never the number alone.
To make that key complete, a tax ID number given without an ID type or country is
`invalid` (`TAX_ID_INCOMPLETE`). Country defaults to the lab's country, so in practice this
only applies when the user clears it.

**Known limit:** a profile edit (lab edit, clinic settings, onboarding) can still change a
clinic's email to one another client of the lab already uses. Edits don't take the lock:
the clinic-side edits would need the locks of every connected lab, and the goal here is to
stop duplicate **creation**. Documented, not solved.

**Unique errors are retried by running the whole row transaction again.** In PostgreSQL,
a unique-constraint error aborts the transaction it happened in; without a savepoint, no
later statement in that transaction can succeed. So the helper doesn't catch `P2002` inside
the transaction. The row runner catches it **outside**, after the rollback, and runs the
whole row transaction again (lock, replay lookup, duplicate check, insert), once:

- **Slug conflict** (`P2002` on `slug`): `Tenant.slug` is unique across all of KesherIO,
  and two labs creating "Vet Center" at the same time can collide, because the lock is per
  lab. The retry generates a new random suffix.
- **Conflict on `(labId, importBatchId, importRowNumber)`**: shouldn't happen, since the
  lock queues creations for the same lab, but if it does, the retry's replay lookup
  (step 1) answers correctly.
- A second `P2002`, or any other error → the row is `failed` (`UNEXPECTED`) and the next
  rows continue.

### A3. Server-side validation per row

**Today:** `ValidationPipe({ whitelist: true, transform: true })` (`apps/api/src/main.ts:24`)
rejects the whole request when one nested field is invalid.

**Change:**

- The request DTO only validates the **structure**:

  - `importBatchId` is a UUID;
  - `dryRun` is a boolean;
  - `rows` is an array of 1 to `IMPORT_MAX_ROWS_PER_REQUEST` (50) plain objects
    (`@IsObject({ each: true })`, **no** `@ValidateNested`);
  - `rowNumber` values are integers and unique within the request.

  A broken structure or too many rows → `400` for the whole request.

- The **service** validates each row on its own, with `plainToInstance(ImportClientRowDto)` +
  `validate(row, { whitelist: true, forbidNonWhitelisted: true })`. Field errors become
  codes: `{ field, code }`, with codes `REQUIRED`, `INVALID_EMAIL`, `TOO_LONG`,
  `INVALID_COUNTRY`, `INVALID_CLIENT_TYPE`, `INVALID_TAX_ID_TYPE` and `TAX_ID_INCOMPLETE`.
  An invalid row gets `status: 'invalid'` and the other rows continue.
- `ImportClientRowDto` and `CreateClientDto` extend one base class with the field rules,
  so Add client and import can't drift apart.
- Frontend validation only makes the preview better. The server never relies on it, and
  a test sends invalid rows directly to prove partial success works.

### A4. Preview after corrections, and final re-check

- Every preview row keeps the **dry-run result together with the values it was checked
  with**: email, country, ID type, ID number, name.
- Editing any of those fields marks the row **"checking…"**, removes its old result and
  queues it. Edited rows are sent again as a dry run (debounced ~500 ms, in groups of up
  to 50).
- Duplicates within the file are recomputed in the browser after every edit, for all rows:
  fixing one row can clear or create a duplicate in another.
- The Import button is disabled while rows are still being checked.
- The final import **checks everything again on the server** (A2). The preview always
  says "as of the last check". The final summary comes **only from the import response**,
  never from the preview: another admin may have added clients in between.
- The same words are used in the preview and the final summary:

| Bucket                        | Meaning                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| Will be created / **Created** | New client in this lab                                                                 |
| **Already in your lab**       | `EMAIL_EXISTS` / `TAX_ID_EXISTS` — skipped                                             |
| **Duplicate in file**         | Same email or tax ID as an earlier row — skipped                                       |
| **Invalid**                   | Field errors (from browser or server) — not imported                                   |
| **Excluded**                  | User unticked the row — not sent                                                       |
| **Failed**                    | Unexpected server error (can be retried), or `BATCH_ROW_MISMATCH` (needs a new import) |
| **Not confirmed**             | Import stopped before this row's group was confirmed (A5)                              |

### A5. Request duration and the 500-row limit

Real limits on the production path (browser → Vercel → Railway API → Supabase pooler):

- **Vercel rewrites** (`apps/lab/vercel.json`) wait at most **120 s for the first byte**
  from the origin ([Vercel docs](https://vercel.com/docs/routing/rewrites),
  [changelog](https://vercel.com/changelog/cdn-origin-timeout-increased-to-two-minutes)).
  The endpoint returns one JSON response at the end, so a request must **finish** within
  120 s.
- **Railway**: up to 15 min with data flowing, 5 min idle
  ([Railway limits](https://docs.railway.com/networking/public-networking/specs-and-limits)).
  Not the binding limit.
- **Interactive transactions** in Prisma default to a 5 s timeout and 2 s max wait. The
  lock wait counts toward them, so the helper sets them explicitly (e.g. `maxWait: 5000,
timeout: 10000`), like the other services do (`review.service.ts:105`,
  `release.service.ts:523`).
- **Connections**: `PrismaPg` uses the default `pg` pool (10). Rows run one after another,
  so one import uses **one** connection at a time. No pool pressure, and no parallel rows.

**Estimate.** A row costs about 6-7 database round trips: begin, lock, duplicate query,
insert tenant, insert connection, commit. The time depends on the latency between Railway
and Supabase, which isn't in the repo (`railway.toml` sets no region; the env files point to
poolers in `ap-northeast-1` and `eu-west-1`):

| API ↔ DB latency          | Per row | 500 rows in one request |
| ------------------------- | ------- | ----------------------- |
| ~2 ms (same region)       | ~15 ms  | ~8 s                    |
| ~40 ms                    | ~0.3 s  | ~2.5 min ❌             |
| ~150 ms (other continent) | ~1 s    | ~8 min ❌               |

One request of 500 rows **does not fit** unless both are in the same region. Even then it
leaves little room.

**Decision: groups of 25 rows, sent one after another, with progress.**

- The browser sends groups of `IMPORT_CHUNK_SIZE = 25`; the server accepts up to 50. Even
  at 1 s per row a group takes about 25 s, well under 120 s.
- Progress: "Importing 75 / 154". The modal can't be closed while importing; leaving the
  page asks for confirmation (`beforeunload`).
- A group that fails because of the network, a timeout or a 5xx is **retried with the same
  `importBatchId`** (2 retries with backoff). The replay rule in A2 makes the retry safe.
- If it still fails: stop, report the confirmed groups, and mark the rest **Not
  confirmed**, with a **Resume** button (same batch id). Closing the tab is also safe:
  importing the file again skips what was already created.
- The file limit stays at **500 rows** (that's 20 groups), to keep the preview usable.
- The server logs the duration of each group. Before release, check it on staging with the
  first lab's 154 rows, then tune `IMPORT_CHUNK_SIZE`.
- **No queue.** Nothing shows a need for one: groups keep each request short. If staging
  shows groups getting near the 120 s limit even at small sizes, look at the latency between
  Railway and the database first.

### A6. ID number storage and Excel parsing

**Storage**

- `taxId` keeps the value as entered (trimmed), for display: leading zeros, letters and
  check digits included (e.g. Chile `12.345.678-K`, Colombia `900.123.456-7`).
- `taxIdNormalized` is a separate column used **only for comparisons**: uppercase, with
  spaces, `.`, `-` and `/` removed, and digits, letters and check digit kept.
  `0012345` stays `0012345`. It's computed in `buildClinicProfileUpdate` whenever `taxId` is
  written, so lab edit, import, onboarding and clinic settings all store it the same way.
- No check-digit validation in v1.

**CSV parsing** (papaparse, `dynamicTyping: false`): every value stays the exact text in
the file, nothing becomes a number. Handle a UTF-8 BOM and detect the `,` or `;` separator.

**XLSX parsing** (exceljs, loaded with dynamic `import()`). Cell types in the ID and phone
columns:

| Cell                                                                  | Handling                                                                                                                                             |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text                                                                  | Use the text exactly.                                                                                                                                |
| Number with a zero-padding format (e.g. `0000000000`)                 | Pad to the format's width. Excel shows that padding to the user and it is stored in the file, so this reproduces what they saw rather than guessing. |
| Number, other formats, ≤ 15 digits                                    | `String(value)`, plus a **warning** on the row: "Stored as a number in Excel — leading zeros may have been removed. Check against the original."     |
| Number with more than 15 significant digits, or not a safe integer    | **Error**: "Excel may have rounded this number." The user must type the value.                                                                       |
| Text that looks like scientific notation (`1.09874E+09`, also in CSV) | **Error**: "Digits were lost when this was saved from Excel."                                                                                        |
| Formula                                                               | Use the cached result; same rules as above.                                                                                                          |
| Rich text / hyperlink                                                 | Use the plain text.                                                                                                                                  |

Digits are **never** added or guessed. Warnings can be confirmed per row; errors must be
fixed. The exceljs behaviour for `numFmt` and formula results gets checked with real `.xlsx`
test files (a number with a zero-padding format, a 16-digit number, text-formatted cells)
before relying on it.

### A7. Retry file

- It's built from the **current preview state**, with the user's corrections. Original
  values are not used.
- It contains every row that isn't **Created**: Invalid (browser or server), Already in
  your lab, Duplicate in file, Excluded, Failed and Not confirmed.
- Columns use **our template headers** (current language) plus `Notes`, `Status` and
  `Reason`. Imported again, the mapping is recognized automatically.
- Escaping:
  - RFC 4180: fields quoted, `"` doubled, CRLF line ends, UTF-8 BOM so Excel shows
    accents correctly.
  - **Formula injection**: every value starting with `=`, `+`, `-`, `@`, tab or carriage
    return gets a leading `'`, with no exceptions
    ([OWASP CSV injection](https://owasp.org/www-community/attacks/CSV_Injection)).
    That includes phones like `+57 300 123 4567`. One rule, applied the same way to every
    value.
- **Uploaded files are never changed automatically.** The import doesn't remove leading
  apostrophes from any file, ours or not. Instead, the preview shows a **warning** for
  values that start with `'` followed by one of those characters ("Starts with an
  apostrophe — probably added by a spreadsheet export"). It offers an **explicit** action
  to remove it, for one cell or for a whole column. Nothing changes until the user clicks.
- **Manual check before release**, written down in the PR:

  - open the retry file in Excel (Windows and Mac) and Google Sheets: does the `'` show,
    and do phones and IDs look right?
  - import the file back unchanged: the warning appears, removal works, and the values
    then match the originals;
  - in Excel, edit it and save it again as CSV and as XLSX, then import that: what happens
    to the `'`?

  If Excel removes the `'` when it saves (it treats it as "this cell is text"), that is
  the user's own edit and the import takes the file as it is.

- The download is a `Blob` + object URL in the lab app.

### A8. Explicit mapping

- Each file column starts on **Ignore**. The app only guesses mappings for real fields
  (name, legal name, contact, email, phone, address, city, country, ID type, ID number).
  It **never** guesses Notes or Client type.
- Notes only receives columns the user explicitly maps there. Several columns can go to
  Notes, saved as `Header: value` lines.
- Billing categories, document links, timestamps and "already created?" columns stay
  ignored unless the user maps them to Notes.
- The "use legal name as contact name" checkbox is removed.

### A9. End-to-end checks

| Behaviour                                                                       | Status today                                                                                                                                                                                                                                                                                                                              | Where                                                                                                                                                         |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A pending imported client can receive orders before onboarding                  | **No.** Only clinic users create orders, from a case. Same for Add client.                                                                                                                                                                                                                                                                | `orders.service.ts:29`, `orders.controller.ts:15`. See A0.                                                                                                    |
| Import creates the organization + connection without users or invitation tokens | **New code**, written for it: `createClinicForLab(…, { withInvitation: false })`.                                                                                                                                                                                                                                                         | Refactor of `lab-clients.service.ts:236-319`                                                                                                                  |
| A client that never had a token can get an invitation later                     | **Works already.** `regenerateInvitation` revokes with `updateMany` (no match → nothing to do) and creates a token with `clinicTenantId`. The card shows "No invitation sent yet" with a button when `invitation` is `null`.                                                                                                              | `lab-clients.service.ts:404-445`; `ClientInvitationCard.tsx` (`inv ? … : …` branch); detail page shows the card while not ACTIVE (`ClientDetailPage.tsx:248`) |
| Small fix                                                                       | That button says **"Regenerate link"** even when there was never a link. Use a "Generate invitation" label in the `null` branch.                                                                                                                                                                                                          | `apps/lab/src/assets/i18n/*.json:625`                                                                                                                         |
| That client can complete onboarding with the imported data                      | **Works already**, for the current fields. `verifyOnboardingToken` returns the tenant profile (`CLINIC_PROFILE_SELECT`) as `clinic`; the clinic setup form fills in from `prefillClinic`; `completeAdminOnboarding` updates the existing tenant (fields left out keep the stored value), sets `ACTIVE` and keeps the existing connection. | `onboarding.service.ts:704-720`, `:888-906`; `clinic-setup.component.ts:74-110`                                                                               |
| Same for the new fields                                                         | **Needs change**: add them to `CLINIC_PROFILE_SELECT`/`FIELDS` so the prefill and the "keep the stored value" rule apply.                                                                                                                                                                                                                 | `clinic-profile.util.ts:13-48`                                                                                                                                |
| Note                                                                            | Onboarding requires address, city and phone (`REQUIRED_CLINIC_DETAILS`, `onboarding.service.ts:34`). An imported client missing them is asked for them in onboarding. Import doesn't need to require them.                                                                                                                                |                                                                                                                                                               |
| Blocker                                                                         | Before sending links to imported clients, fix the password issue (A0).                                                                                                                                                                                                                                                                    | Phase 0                                                                                                                                                       |

---

## Part B — Revised implementation plan

### B1. Data model

`Tenant` (the clinic's identity, part of the shared clinic profile):

```prisma
legalName        String?
taxIdType        String? // "NIT", "CC", "RUT", "CUIT", "RUC", "CNPJ", "CPF", "RFC", "OTHER", …
taxId            String? // as entered (trimmed), for display
taxIdNormalized  String? // comparison only — see A6

@@index([country, taxIdType, taxIdNormalized])
```

`ClinicLabConnection` (the lab's private view of the client):

```prisma
notes            String? // lab-internal, never shown to the clinic or other labs
importBatchId    String? // set by bulk import, for safe retries (A2)
importRowNumber  Int?
importRowHash    String? // SHA-256 of the normalized submitted row — detects reuse with different data

@@unique([labId, importBatchId, importRowNumber]) // nulls (Add client) don't collide
```

One migration, nullable columns only, safe for existing data. The only new unique
constraint is the import identity above. Email and tax ID get no unique constraints
(see A2 for why).

**Shared profile**: add `legalName`, `taxIdType` and `taxId` to `CLINIC_PROFILE_FIELDS` /
`CLINIC_PROFILE_SELECT` (`apps/api/src/tenants/clinic-profile.util.ts`) and to
`ClinicProfileModel` (`libs/shared-types/src/lib/clinic-profile.model.ts`). All optional.
`buildClinicProfileUpdate` sets `taxIdNormalized` whenever `taxId` is present (and clears
it when `taxId` is cleared). `taxIdNormalized` is never accepted from a client.

**Tax ID types**: a table per country (CO: NIT, CC, CE, PP · CL: RUT · AR: CUIT, CUIL, DNI ·
PE: RUC, DNI, CE · EC: RUC, CI · BR: CNPJ, CPF · MX: RFC · any: OTHER). One copy in
`libs/shared-types` (frontend + api), one in `apps/lab/src/app/shared/taxIdTypes.ts` (the
lab keeps its own types). Each copy has a comment pointing to the other. The API checks that
the type exists for the country, or is `OTHER`.

### B2. API (`apps/api/src/lab/`)

**Shared create helper** (`lab-clients.service.ts`):

```ts
private async createClinicForLab(
  tx, labTenantId, row, opts: { withInvitation: boolean; createdByUserId: string;
                                importBatchId?: string; importRowNumber?: number }
): Promise<{ status: 'created'; clientId; invitation? }
         | { status: 'skipped'; reason; clientId? }
         | { status: 'conflict'; reason: 'BATCH_ROW_MISMATCH' }>
```

Steps inside the transaction:

1. advisory lock;
2. replay lookup by `(labId, importBatchId, importRowNumber)` and hash comparison (import
   only);
3. duplicate lookup in this lab (case-insensitive email; tax key);
4. create the tenant;
5. create the connection (notes, import fields);
6. create the onboarding token, only if `withInvitation`.

No `P2002` is caught inside the transaction. The caller (`runClientRow`) retries the whole
transaction once, outside it (A2).

- `createClient` calls it with `withInvitation: true`. The API response stays the same, but
  a duplicate email in any letter case or a duplicate tax ID now returns `409`.
- `importClients` calls it with `withInvitation: false`, one transaction per row.

**Endpoint**: `POST /lab/clients/import`, ADMIN only, same guards as `POST /lab/clients`
(`lab.controller.ts:1286`).

```ts
// dto/import-clients.dto.ts — structure only (A3)
class ImportClientsDto {
  importBatchId: string; // IsUUID
  dryRun?: boolean;
  rows: Record<string, unknown>[]; // IsArray, ArrayMinSize(1), ArrayMaxSize(50), IsObject({each})
}

// validated per row in the service; fields shared with CreateClientDto via a base class
class ImportClientRowDto {
  rowNumber: number;
  name: string;
  clientType: ClientType;
  primaryContactEmail: string;
  primaryContactName?;
  phone?;
  address?;
  city?;
  country?;
  legalName?;
  taxIdType?;
  taxId?;
  notes?;
}
```

Response:

```ts
{
  results: Array<
    | { rowNumber; status: 'created' | 'would_create'; clientId? }
    | {
        rowNumber;
        status: 'skipped';
        reason: 'EMAIL_EXISTS' | 'TAX_ID_EXISTS' | 'DUPLICATE_IN_FILE';
      }
    | {
        rowNumber;
        status: 'invalid';
        errors: { field: string; code: string }[];
      }
    | { rowNumber; status: 'conflict'; reason: 'BATCH_ROW_MISMATCH' }
    | { rowNumber; status: 'failed'; reason: 'UNEXPECTED' }
  >;
  summary: {
    created;
    wouldCreate;
    skipped;
    invalid;
    conflict;
    failed;
  }
}
```

- Duplicates **within the request** are detected before any write (first row wins).
- A dry run takes no locks and does no writes. It runs one query for this lab's existing
  emails and tax keys and returns `would_create` / `skipped` / `invalid`. It's a preview
  only; the real import checks again (A4).
- `failed` is only for unexpected errors: logged with the request id, row number and lab
  id, no row contents. The other rows continue.
- Codes, not English text: the lab app translates them.
- Logs the duration of each request (A5).

**Single client screens**: `CreateClientDto` / `UpdateClientDto` accept `legalName`,
`taxIdType`, `taxId`, `notes`. `listClients` / `getClientDetail` return them. Notes are read
from and written to the connection of **this** lab only.

### B3. Lab app (`apps/lab`)

Entry: **Import clients** button next to **+ Add client** in `ClientsPage.tsx`.

```
pages/clients/
  ImportClientsModal.tsx   ← step state, batch id, group runner (A5)
  ImportUploadStep.tsx     ← file, template download, batch defaults (client type, country)
  ImportMappingStep.tsx    ← column → field, starts on Ignore (A8)
  ImportPreviewStep.tsx    ← table, edits, re-checks (A4), warnings (A6)
  ImportResultStep.tsx     ← summary buckets, retry file (A7)
shared/
  spreadsheet.ts           ← CSV/XLSX → { headers, rows: string[][], cellWarnings } (A6)
  clientImport.ts          ← header guessing, normalization, row validation, in-file dups,
                             retry-file CSV writer + escaping (pure functions)
  taxIdTypes.ts
```

Types in `apps/lab/src/app/types/lab.types.ts`. API: `labApi.clients.import(body)` in
`labApi.ts`. New dependencies **papaparse** and **exceljs** need approval before install.
The npm `xlsx` package is not used.

- **Upload**: `.csv` / `.xlsx` (first sheet); defaults for client type (Veterinary clinic)
  and country (the lab's country); template download; up to 500 data rows.
- **Mapping**: one line per column (header, sample values, field select). Guesses come from
  aliases in ES/PT/EN, after removing accents and punctuation, for real fields only.
  Email is required; Name or Legal name is required (an empty Name falls back to Legal
  name). The mapping is saved in `localStorage` per lab and header set (wrapped in
  try/catch).
- **Preview**:
  - the table, with filters by bucket (A4);
  - row edits: name, email, country, ID type, ID number, client type;
  - exclude a row;
  - warnings to confirm (A6);
  - dry-run checks in groups, and again for edited rows.
- **Import**: groups of 25 sent one after another, progress, retry and resume (A5).
- **Result**: counts per bucket, table of non-created rows with translated reasons,
  **Download rows to fix** (A7). Closing refreshes the clients list.
- **Invitation card**: "Generate invitation" label when there was never a link (A9).
- `AddClientModal.tsx` / `ClientInfoCard.tsx`: legal name, ID type (options depend on
  country), ID number, notes.
- i18n: `clients.import.*`, reason and error codes, ID type labels in `en.json` / `es.json`.

### B4. Clinic app (`apps/frontend`)

- **Onboarding, clinic setup step** (`features/onboarding/clinic-setup/`):
  - add Legal name, ID type (`app-select`, options depend on country) and ID number
    (`app-input`), all optional;
  - fill them in from `prefillClinic`;
  - include them in the back-navigation draft (`storeClinicSetupDraft`);
  - clear the ID type when the country changes and the type doesn't exist there.
- API side: add the fields to `SaveClinicSetupDto` / `CompleteAdminOnboardingDto` and pass
  them through `buildClinicProfileUpdate` in `onboarding.service.ts`.
- **Clinic settings** (`features/settings/clinic/`, `settings.service.ts`): view and edit
  the same fields, through the existing `tenants.service.ts` `updateClinic`.
- Notes are never shown in the clinic app.
- i18n: `en.json` / `es.json`.

### B5. Example: first lab's file

| File column                                                               | Default | Suggested by the app | Notes                                                 |
| ------------------------------------------------------------------------- | ------- | -------------------- | ----------------------------------------------------- |
| NOMBRE COMERCIAL                                                          | Ignore  | Name                 | 5 empty → falls back to legal name                    |
| NOMBRE COMPLETO / RAZON SOCIAL                                            | Ignore  | Legal name           |                                                       |
| Correo electrónico                                                        | Ignore  | Email                |                                                       |
| Número de teléfono                                                        | Ignore  | Phone                |                                                       |
| DIRECCION PRINCIPAL                                                       | Ignore  | Address              |                                                       |
| CIUDAD                                                                    | Ignore  | City                 | Kept as written                                       |
| TIPO DE IDENTIFICACION                                                    | Ignore  | ID type              | `CEDULA` → `CC`, `NIT` → `NIT`                        |
| NUMERO DE IDENTIFICACION                                                  | Ignore  | ID number            | `1 0 9 8 …` displayed as entered, compared normalized |
| Comentarios, SOLCITUD                                                     | Ignore  | —                    | User may map them to Notes                            |
| TIPO DE PERSONA, FACTURACION, ADJUNTAR ×5                                 | Ignore  | —                    | Stay ignored unless mapped to Notes                   |
| Marca temporal, CREADO EN LA PLATAFORMA?, Dirección de correo electrónico | Ignore  | —                    | The last one is the form submitter, not the client    |

Checked in the file: 154 rows, all with a valid email, no duplicate emails, no duplicate ID
numbers → expected 154 created, minus any that are already clients of the lab.

### B6. Tests

**API (Jest)**

`lab-clients.service.spec.ts`:

- Import creates tenant + connection (`clientStatus: 'PENDING'`, notes and batch fields on
  the connection). It **doesn't** call `onboardingToken.create`, `user.create` or
  `userTenantMembership.create`.
- Invalid rows (missing email, bad country, tax ID without type) come back as `invalid`
  with field codes, while valid rows in the same request are created. Rows are sent
  straight to the service, without frontend validation.
- Too many rows, a missing batch id or duplicate `rowNumber` → `400` (controller spec).
- Duplicate checks:
  - email differing only in letter case → `EMAIL_EXISTS`;
  - same normalized ID with the same country and type → `TAX_ID_EXISTS`;
  - same number with **another type or country** → created;
  - duplicates within the request → `DUPLICATE_IN_FILE` (first row created).
- A clinic connected **only to another lab**, with the same email or tax ID, does **not**
  block the import. The new tenant is a different row, and the response doesn't mention
  the other lab's client.
- Replay:
  - same batch id + row number + same data → `created` with the existing `clientId`, no
    insert;
  - same batch id + row number, but the client's email was **edited** since → still
    `created` (replay found by identity, not by email);
  - same batch id + row number + **different data** → `conflict: BATCH_ROW_MISMATCH`, no
    insert;
  - same batch, another row with the same email → `DUPLICATE_IN_FILE`;
  - new batch → `EMAIL_EXISTS`.
- Order inside the transaction: lock → replay lookup → duplicate lookup → insert (checked
  through the order of mocked `tx` calls).
- `P2002` on the slug: the first transaction is rolled back and a **new** transaction
  runs (two `$transaction` calls, the second with a different slug). There is no second
  insert inside the failed one.
- `P2002` twice, or any other error → the row is `failed` and the next rows continue.
- Dry run: no inserts, no locks; same statuses as a real import for the same data.
- `createClient` still creates an invitation, and now returns `409` for a case-insensitive
  email match and for a tax ID match.
- `regenerateInvitation` for a client with no previous token creates one with
  `clinicTenantId` (protects the A9 behaviour).

`clinic-profile.util.spec.ts`:

- `taxIdNormalized` is derived from `taxId` (spaces, dots and dashes removed; leading zeros
  and `K` kept), and cleared with it.
- `taxIdNormalized` can't be set directly.

`onboarding.service.spec.ts`:

- Lab invitation for an imported client: `verifyOnboardingToken` returns the imported
  profile, including the new fields.
- `completeAdminOnboarding` with fields left out keeps the stored values (legal name, tax
  ID), sets `ACTIVE` and doesn't create a second connection.
- Phase 0:
  - existing user's email, no session → rejected, and `updateSupabaseUserPassword` is
    never called;
  - existing user's email, session of a **different** user → rejected;
  - existing user signed in as themselves → onboarding succeeds: membership created,
    token marked used, password untouched;
  - new email → current "create account" path still works.

**Concurrency (opt-in, real Postgres)**: `lab-clients.import.int-spec.ts`, runs only when
`INTEGRATION_DATABASE_URL` is set (a local Postgres or a throwaway Supabase branch). The repo
has no database-backed tests today, and `apps/api-e2e` is only the Nx scaffold.

- Two imports of the same 25 rows **at the same time** for one lab → 25 tenants in total.
- An import and an Add client with the same email at the same time → one client.
- The same group sent twice with the same batch id → 25 tenants; both responses say
  `created`.

Mocked unit tests can't prove the locking works. This test can. Tradeoff: one small new
test setup, run by hand (or in CI later), not on every `nx test`.

**Lab (Vitest)**, pure functions:

- `spreadsheet.ts`:
  - CSV with quoted multi-line fields, BOM and a `;` separator;
  - IDs that are text in the CSV are kept exactly (`00123`, `12.345.678-K`);
  - scientific notation → error;
  - XLSX test files: number with a zero-padding format → padded, plain number → warning,
    16+ digits → error, formula → cached result.
- `clientImport.ts`:
  - header guessing with the first lab's real headers and with PT/EN headers;
  - unknown headers and Comentarios/FACTURACION stay **Ignore**;
  - notes joining only for columns mapped to Notes;
  - in-file duplicates recomputed after an edit (fixing row A clears row B's duplicate);
  - editing email, country, ID type, ID number or name clears that row's dry-run result,
    and editing only the client type doesn't.
- Retry file:
  - contains the **corrected** values;
  - includes Invalid, Excluded, Already in your lab, Duplicate, Failed and Not confirmed
    rows, not Created ones;
  - every value starting with `= + - @`, tab or CR gets a leading `'`, including
    `+57 300 123 4567`;
  - quotes, commas and line breaks are escaped;
  - parsing the file back gives the escaped values **unchanged** (no automatic stripping);
  - the preview shows the apostrophe warning for those cells, and the explicit
    "remove" action for one cell or a column gives the original values back.
- Uploaded files: a leading `'` in any value is kept unless the user removes it.
- Group runner (with a mocked `labApi`):
  - a group that fails once is retried with the **same** batch id;
  - after the retries run out, the rest is marked Not confirmed and Resume continues;
  - the final summary is built from responses, not from the preview.

**Frontend (Vitest)**: `clinic-setup.component.spec.ts` and
`clinic-settings.component.spec.ts`:

- the new fields are filled in from the record and sent on submit;
- the ID type clears when the country changes.

**Manual, before release (staging)**:

- import the first lab's 154 rows;
- check the duration of each group in the logs (A5);
- import the same file again → all skipped;
- generate an invitation for one imported client and complete onboarding with it.

### B7. Phases

0. **Security fix (own PR, first)**: existing users must sign in during onboarding; the
   password is never overwritten (A0). Until it's deployed, **send no new invitations** to
   any client, imported or added by hand.
1. **Data model + API**:
   - migration, shared profile fields, `taxIdNormalized`;
   - `createClinicForLab` (lock, checks, replay, slug retry);
   - per-row validation, `POST /lab/clients/import` with dry run;
   - Add client / edit with the new fields;
   - unit tests + opt-in integration test.
2. **Lab UI**: upload, mapping, preview with re-checks, groups with progress and resume,
   result + retry file, invitation label, Add client / edit fields, i18n.
3. **Clinic app**: onboarding clinic setup + settings fields.
4. **Staging check** with the real file; tune `IMPORT_CHUNK_SIZE`.

### B8. Not in this work / follow-ups

- **Lab-side order entry** for clients that haven't onboarded (A0). Needed if labs
  should work for clients before they onboard.
- **Connect an existing clinic to another lab**, with the clinic's consent. Needs first:
  - client status per connection;
  - `getClientDetail` orders filtered by lab (A1);
  - `listClients` `orderCount` filtered by lab: today it counts all of the clinic's
    orders (`_count.orders`, `lab-clients.service.ts:69`).
- **Export clients**: see B9. A small task that starts **after** the import is finished and
  tested.
- Bulk invitation generation / a list of WhatsApp messages; email invitations.
- **Updating existing clients from a file** (update-import). A separate feature with its
  own plan. It needs a match key (the `Client ID` column from B9, safer than email), rules
  for each field, a preview of the changes, and the same rules as editing a clinic's shared
  profile.
- Check-digit validation per country.
- Merging city spellings.

### B9. Follow-up: Export clients

Lets the lab download its client list for internal administration, reporting or moving
data between tools. Kept small on purpose. It reuses the CSV writer and escaping from the
import (`apps/lab/src/app/shared/clientImport.ts`), so it's built only after the import is
complete and tested.

**Scope**

- ADMIN only. Exports only clients **connected to the current lab**.
- **All clients** or **the current filtered list**, with clear labels: "Export all
  clients (154)" / "Export filtered list (37): Pending, search 'vet'".
- **Include internal notes** checkbox, **unchecked** by default: notes may contain
  sensitive comments.
- CSV download. XLSX is a possible next step (see "Numbers in Excel" below).

**API**: `GET /lab/clients/export?status=&search=&includeNotes=`

- Same guards as the other client endpoints. Same `status` / `search` filters as
  `listClients` (`lab-clients.service.ts:35`), but **not paged**. The list is limited to
  100 per page (`list-clients.dto.ts:31`), so the lab app can't build the export from the
  list. Capped at a generous number of rows (e.g. 5,000), with an error above it instead
  of a half-finished file.
- Returns JSON rows. The lab app writes the CSV with the shared writer, so there's one
  escaping code path.
- **Notes are only included when `includeNotes=true`**, and only this lab's
  `ClinicLabConnection.notes`. Never sent and then hidden in the browser.
- Logs each export: user id, lab id, row count, filters, `includeNotes`, request id. No
  row contents. The file is a full client list with personal data (Colombia's Ley 1581
  and Brazil's LGPD apply).

**Columns**: the import template headers (current language), so the import recognizes the
file:

`Client ID` · Name · Legal name · Contact name · Email · Phone · Address · City · Country ·
Client type · ID type · ID number · Status · (Notes, only if chosen)

- **ID number** is the value as entered (`taxId`), not the normalized copy.
- **Client type** and **Status** are written as their translated labels. The import
  recognizes Client type labels; Status and Client ID stay **Ignore** on import (A8).
- `Client ID` is the tenant id: not secret, and it's the match key a future update-import
  can use.

**Never exported**:

- invitation links, tokens, password data;
- clinic users and memberships;
- `orderCount`, which counts other labs' orders (B8);
- the normalized tax ID copy and import fields (`importBatchId`, …);
- anything from other labs.

**Escaping**: same rules as the retry file (A7): RFC 4180 quoting, UTF-8 BOM, CRLF, and a
leading `'` on every value starting with `= + - @`, tab or CR, phones included.

**Numbers in Excel**

- The CSV keeps IDs and phones exactly as stored.
- A CSV can't force Excel to treat a column as text. Opened by double-click, Excel removes
  leading zeros (`0012345` → `12345`) and shows long numbers in scientific notation.
- The usual workaround, `="0012345"`, is itself a formula, which goes against the formula
  protection. Not used.
- v1: a short note next to the button: "To keep ID numbers exact in Excel, open the file
  with Data → From Text/CSV, or use Google Sheets."
- Next step, if Biomet's staff usually double-click files: an **XLSX** export with the ID
  and phone cells set to text (exceljs is already a dependency from the import).

**Limitation, shown in the UI and docs**: this file is a **copy**. Import only creates
clients, so editing the exported file and importing it again **doesn't update** existing
clients: every row comes back as "Already in your lab". Messages:

- export: "This file is a copy. Editing it and importing it again won't update existing
  clients."
- import result: when every row is "Already in your lab", explain why, with the same text.

Updating from a file is the separate update-import feature (B8).

**Tests**

- API (Jest):
  - returns only clients connected to this lab, never a clinic connected only to another
    lab;
  - non-ADMIN → `403`;
  - `status` / `search` filters match `listClients`;
  - no `notes` field at all unless `includeNotes=true`, and then only this lab's notes;
  - the response has no invitation or token fields, no users and no `orderCount`;
  - above the row cap → error, not a cut-off file;
  - one log entry per export, without row contents.
- Lab (Vitest):
  - the CSV has the template headers and the escaping rules from A7;
  - IDs like `0012345` and `12.345.678-K` and phones come out exactly as stored;
  - the labels for all clients / filtered list show the right counts;
  - an exported file goes into the import → mapping recognized automatically,
    Status / Client ID on Ignore, and every row "Already in your lab".
- Manual: open the file in Excel (double-click, and Data → From Text/CSV) and in Google
  Sheets. Write down how IDs and phones look in each.

## Resolved

- **Phase 0**: yes, first, as its own PR. No new invitations of any kind until it's deployed.
- **Group size**: keep 25 rows. Measure on staging; check the regions in the Railway and
  Supabase dashboards. This doesn't block the plan.
- **One tenant per lab** for the same real clinic: accepted as a documented temporary
  limit (A1). It will matter when one clinic account needs to work with several labs.

## Open question (doesn't block this feature)

- **Orders before onboarding**: decide based on Biomet's actual workflow. If technicians
  need to register samples from clinics that haven't joined KesherIO, lab-side order entry
  gets **its own plan**. This import is not expanded for it.

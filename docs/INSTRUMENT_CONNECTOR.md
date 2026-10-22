# Analyzer connector — backend design and runbook

Local receiver: `apps/connector` (see its README). This document covers the API side:
`apps/api/src/instruments/`, the five tables in migrations `20261021000001/2`, and the lab portal page
`/instruments`.

## Flow

```
connector ──POST /api/instrument-ingest/messages──▶ ConnectorAuthGuard (token → ONE lab + ONE analyzer)
   exact frame bytes (gzip), sha-256, received-at, complete|incomplete
        │
        ▼  verify sha-256 ▸ same bytes already stored? → return it (duplicateUpload) ▸ store raw (gzip) in instrument_message_payloads
        │  complete? ─ no ─▶ INCOMPLETE (kept, never processed)
        ▼  yes
   parse ORU^R01 ─▶ status RECEIVED ─▶ InstrumentProcessorService.process()
        │              dedupe ▸ change detection ▸ OBX-13 flags ▸ explicit sample link ▸ explicit mapping + units
        ▼              ▸ order/test/template checks ▸ existing-values check
   IMPORTED (draft via ResultEntryService.saveAnalytes)  or  a review-queue status with reason codes
```

Raw bytes are always stored first and the upload is acknowledged even if processing fails (`FAILED`, with the
error), so the connector never retries because of a processing bug.

## Security

- **Credential** (`connector_credentials`): `kvc_<8 hex>_<43 chars>`, bound to one lab **and one analyzer**,
  revocable. Only `sha256(token)` is stored (the secret has 256 bits, so no password stretching is needed);
  lookup is by the public prefix, compare is constant-time. Shown once at creation. Revocation is immediate
  (every request re-reads the row). Also refused when the analyzer is disabled or no longer belongs to the lab.
- The ingest route is `@Public()` only in the sense of skipping the Supabase JWT guard; `ConnectorAuthGuard`
  protects it, and **the lab always comes from the credential — never from the body or a header**.
  A connector token is not a user JWT and vice versa (both directions are tested).
- Every staff route sits behind `JwtAuthGuard` + `LabTenantGuard`; every query filters by the caller's lab;
  another lab's message, analyzer, order, credential or link is a 404. Roles: staff (Analyst+) read, link,
  reprocess, dismiss; **approve = Reviewer/Admin/Owner**; mappings and credentials = Admin/Owner.
  Pinned in `lab-routes.authz.spec.ts`.
- New tables have RLS on with no policies (`migrations-security.spec.ts`). Upload size is capped at 16 MB
  decompressed (gzip bombs included).
- The connector requires `https://` except for localhost.

## Matching: explicit, never inferred

The analyzer's sample ID (PID-3) is its own counter and is reused. **Nothing ever treats it as an order
number.** A message matches an order only through an `instrument_sample_links` row:
`(lab, analyzer, sampleId) → order`, valid in `[validFrom, validUntil]`, checked against the run time
(OBR-7, converted from the analyzer's wall clock using the lab's time zone). Zero links → `UNMATCHED`;
links to different orders → `AMBIGUOUS`. Creating a link refuses an overlapping window for a different order
(409) and requires both the analyzer and the order to belong to the caller's lab. Links are created by
staff from the review queue ("Link and import as draft"; the window is run time −1 h … +24 h), by
`POST /lab/instruments/sample-links`, or by the dev seed.

## Mapping and units: explicit

`instrument_parameter_mappings` keys `(analyzer, parameter code, unit the analyzer sends, catalog code)` →
`template analyte code` × `multiplier`. A mapped parameter arriving in a unit that has no row (e.g. HGB in
`g/L` when only `g/dL` is mapped) is **not imported**: `UNIT_MISMATCH:HGB:g/L` goes to review, and adding a
mapping row (`g/L`, ×0.1) then *Reprocess* imports it converted. Parameters with no mapping at all, text
parameters, alarms and images are ignored and listed on the message ("not mapped").
Dev mappings (see `seed-instrument-dev.mjs`): WBC RBC HGB HCT MCV MCH MCHC PLT MPV (HGB and MCHC also in g/L ×0.1).
Deliberately **not** mapped: `Lym#/Lym%/Mid#/Mid%/Gran#/Gran%` (the whole differential, see the lab decision below), (a 3-part differential is not NEU/MON/EOS/BAS), RDW, PDW,
PCT, P-LCC, P-LCR (no equivalent template field). That is a lab decision to change, not a code default.

**Lab decision (2026-10-22, dev test lab):** the five differential percentages on the CBC form (neutrophils, monocytes,
eosinophils, basophils, bands) are entered by the technician from the **manual smear count** ("Recuento en placa"), so the
analyzer's Mid%/Gran% (and Mid#/Gran#) are deliberately not imported; they stay visible on the Analyzer results page. The VH-30
is a 3-part differential analyzer and never sends those five. Follow-up (same day): the lab also chose to enter Lym% by hand, so the `Lym%` and `Lym#` mapping rows were removed from the dev analyzer and from the seed script (dev now has 11 mapping rows). The earlier sample-1111 draft still holds the Lym% imported before that change until a technician overwrites it.

## Duplicates and changed results

- **Same bytes again** (connector retry): the unique key `(lab, analyzer, sha256)` returns the original record.
- **Resend** (same run, new MSH-7): `contentHash` excludes MSH-7 and MSH-10 and covers PID fields, OBR-7, every
  parameter with unit / range / both flags, and a hash of each histogram. Same hash as a message already
  seen for that run (same analyzer + sample ID + OBR-7) → `DUPLICATE`; nothing imported or queued.
- **Changed**: a different hash for a run that was already `IMPORTED` → `NEEDS_REVIEW` with reason
  `CONTENT_CHANGED` and a per-parameter before/after diff (values, units, ranges, flags, histogram-only
  changes, patient fields). The draft is untouched until a reviewer approves. Re-sending an *old* version is
  treated as a duplicate of it, not as a new change.

## OBX-13 flags (kept separate)

Stored per parameter (`parsed.parameters[].userFlag`) and summarised as two independent booleans.
- `O` expired reagent → `hasExpiredReagent`, reason **`EXPIRED_REAGENT`**: always held for review, shown with its own badge.
- `E` / `e` edited on the analyzer → `hasAnalyzerEdits`: retained and shown ("Edited on analyzer"); not blocking
  by itself. If the edit arrives after an import it is caught as `CONTENT_CHANGED`.
The PDF defines these only in its table; **whether an edit changes MSH-10 / OBR-7 is unknown until the hardware
checklist (step 10) is done** — change detection does not depend on it.

## Interrupted transfers

The connector uploads cut-off or unframeable bytes with `X-Transfer-Status: incomplete`. They are stored as
`INCOMPLETE`, never parsed into results, never processed (also guarded inside `process()`), cannot be linked,
approved or reprocessed, and appear under "Interrupted transfers". A complete copy of the same message
(same control ID + sample ID) later settles them (`resolvedAt`); staff can acknowledge one with a note. They
stay `INCOMPLETE` forever — they are acknowledged, not relabelled.

## Review queue

`NEEDS_REVIEW`, `UNMATCHED`, `AMBIGUOUS`, `FAILED` (unresolved) + interrupted transfers. Reason codes:

| Code | Meaning | Resolve by |
| --- | --- | --- |
| `UNMATCHED`, `AMBIGUOUS_SAMPLE` | no / several links | link to an order (or end a bad link) |
| `CONTENT_CHANGED` | differs from what was imported | **approve** (reviewer+) |
| `EXPIRED_REAGENT` | OBX-13 = O | **approve** (reviewer+) |
| `EXISTING_MANUAL_VALUES` | a technician already typed values for these analytes | **approve** (reviewer+) |
| `DRAFT_MODIFIED_SINCE_IMPORT` | the draft no longer holds what the analyzer import wrote (someone edited it) | **approve** (reviewer+) |
| `UNIT_MISMATCH:<code>:<unit>` | unit has no mapping | add mapping, reprocess |
| `NO_MAPPED_PARAMETERS`, `NO_MATCHING_TEST:<code>`, `ANALYTE_NOT_IN_TEMPLATE:<code>` | configuration gap | fix config, reprocess |
| `ORDER_NOT_AVAILABLE`, `TEST_NOT_EDITABLE` | order cancelled; test not accepted / in review / released | fix, reprocess (a released test needs the amendment workflow) |

Only the four approvable codes above can be approved; approving requires accepting *all* of them and a note, and
is refused outright when nothing approvable is open. Everything else must be fixed and reprocessed.

## Approval rechecks the live state

Approving never replays an old decision: `process()` re-reads everything at the moment of approval — the
current mappings, the test's status and release state, and the current draft values. So:
- the draft is compared with what this analyzer run last wrote; if anyone edited it since, that is a new
  reason (`DRAFT_MODIFIED_SINCE_IMPORT`) and an approval of only `CONTENT_CHANGED` goes **back to review**
  without overwriting anything — the reviewer must accept both, knowingly;
- if the test was submitted for review or released in the meantime, the result-entry rules refuse the write
  (`TEST_NOT_EDITABLE`) and nothing changes — a released result needs the amendment workflow.

## Partial mapping is visible

`GET …/messages/:id` returns `mappingPreview` computed with the **current** mappings (same function as the
importer): which values map to which result field, which parameters are not mapped, which arrived in an unmapped
unit, and `isPartial` when fewer values import than the analyzer sent. The detail screen shows it for every
complete message — including unmatched ones, before anything is imported.

## Fields the template computes

Many CBC templates define MCV, MCH, MCHC and the absolute differential counts as **formula fields**: the existing
result-entry code recalculates them on every save and overwrites anything written to them. The importer therefore
does **not** write analyzer values to formula analytes and does not count them as imported; it records them in
`parsed.import.formulaComputed` (with the analyzer's own figure) and the detail screen explains it. Expect small
differences from the analyzer's printout for those fields (e.g. MCV 68.59 computed vs 68.5 printed). The
"draft was edited since import" check ignores them, so the platform's own computed values never look like an edit.

## Import = draft only

`ResultEntryService.saveAnalytes` (the same path as manual entry) writes the values under the report lock,
so review, release, amendment and audit rules are unchanged: the report stays `DRAFT`, the test moves
`READY → IN_PROGRESS`, `entryMethod = INSTRUMENT`, `resultEntrySource = DIRECT_INTEGRATION`, `analyzerId` set,
and an `INSTRUMENT_RESULTS_IMPORTED` timeline event records message, analyzer and any approved reasons. A test
that is not editable (pending, in review, released) is never written: the message waits in review.
An import for several tests is not atomic across tests (the one-analyzer-one-test case is); a failure part-way
is reported on the message.

## Endpoints

Connector: `GET /api/instrument-ingest/ping`, `POST /api/instrument-ingest/messages`.
Staff (`/api/lab/instruments/…`): `summary`, `messages`, `messages/:id`, `messages/:id/raw`,
`messages/:id/{resolve-sample,reprocess,approve,dismiss}`, `sample-links` (+`/:id/end`), `mappings`,
`credentials` (+`/:id/revoke`). Lab portal: `/instruments` (queue, detail, connectors tab for admins);
nav badge = needs-review + interrupted.

## Verifying locally (nothing touches dev or prod)

```bash
# 1. a throwaway LOCAL database (never dev/prod); pgvector is needed by the schema
createdb vh30_it && psql vh30_it -c 'CREATE EXTENSION IF NOT EXISTS vector'
DATABASE_URL=postgresql://localhost/vh30_it npx prisma db push --schema apps/api/prisma/schema.prisma

# 2. the connector bundle (the e2e spec runs the real one)
(cd apps/connector && node scripts/bundle.mjs)

# 3. the instrument specs: unit + pipeline + end to end
cd apps/api
INTEGRATION_DATABASE_URL=postgresql://localhost/vh30_it \
  node ../../node_modules/.bin/jest --config jest.config.js --runInBand instruments
```
The migrations themselves were additionally applied on top of the previous schema in a scratch database
(both files apply cleanly; RLS is on for all five tables).
`instruments.pipeline.int.spec.ts` drives the real capture through every rule above on a real database.
`instruments.e2e.int.spec.ts` runs the **real bundled connector** against the **real AppModule** (global guards)
over HTTP: replay → capture → upload → import, offline and incomplete handling, credential revocation. It refuses
to run unless the database host is local. Run integration specs with `--runInBand`: several existing specs count
rows table-wide and interfere with each other when run in parallel against one database.

## Development order

```bash
DATABASE_URL=<DEV ONLY> node apps/api/prisma/seeds/seed-instrument-dev.mjs \
  --lab <lab id|slug> --clinic <clinic id|slug> --catalog-code CBC --sample-id 9001
```
Creates (or reuses) analyzer "VH-30 (dev)", the mapping rows, one clearly-labelled development order
(`DEV-VH30-…`, patient "ZZ VH-30 DEV") with a `READY` CBC test, a sample link for the given analyzer sample ID,
and prints a connector token once. `--catalog-code` must be the code on the lab's CBC ordered test / template.

## Dev rollout (2026-10-21)

- **Database:** the development database only (never production). Both migrations applied with `prisma migrate deploy`
  after `migrate status` showed exactly those two pending; RLS on, no anon/authenticated grants. A pre-migration dump was
  taken first and is kept outside the repo (the migrations are additive).
- **Seed:** run for the dev test lab and one test clinic with catalog code `CBC`; created analyzer "VH-30 (dev)", 13 mappings
  (11 after the differential decision), one clearly-labelled development order (with an accepted EDTA specimen), a link for
  one analyzer sample ID, and one connector credential (token stored outside the repo, owner-only). Existing data was not modified.
- **Hosting:** there is **no hosted dev API or portal**; the only hosted target in the repo is production, and
  `apps/lab/vercel.json` proxies `/api` to the production API — a dev portal deploy needs its own rewrite. "Dev" here means
  API + portal running locally against the dev database. For the Windows connector a temporary public tunnel points at
  a **dev-only allow-list proxy** (`apps/connector/src/ingest-proxy.ts`, port 3011), never at the API: from the internet only
  `GET /api/health/live`, `GET /api/instrument-ingest/ping` and `POST /api/instrument-ingest/messages` get through (the last two
  need a connector-shaped bearer token; the API still authenticates it); everything else — Swagger, `health/ready`, every
  lab/clinic/auth route — is a bare 404 that never reaches the API. A temporary tunnel can drop and its URL changes on
  restart. Port 3000 may be taken by another project: run the API with `PORT=3010` and the portal with
  `LAB_API_TARGET=http://localhost:3010`.
- **Slow first import:** an import takes ~20 s when the API is far from its database (~25 sequential round trips); the
  connector's 60 s timeout and idempotent retries make that safe, and it is much faster next to the database.

## Not done yet (deliberately out of this phase)

- Production: nothing here touches production. A hosted dev (or prod) deployment needs the lab `vercel.json` API rewrite and the Railway service decided first.
- UI for sample links and parameter mappings (API + seed exist; the review queue creates links).
- Reading the analyzer's patient name/species is display-only; it is never used for matching.
- ACK on the real device (see the connector README, Phase C); histogram images are stored raw but not rendered or imported.
- Amendments for already-released tests: a changed result for a released test stays in review (use the amendment workflow).

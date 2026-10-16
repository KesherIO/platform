# Resultados — released results search (rev. 2)

## Goal

The lab asked for: _"rol que pueda acceder a buscar los resultados completos (liberados),
que puedan buscar por entidad, por fecha, por paciente y por analito"_. On 2026-10-15 it
added a billing need: someone who sees **orders in progress** (status only) but not the
values.

## Decisions (2026-10-15)

- **Roles** (docs/LAB_PERMISSION_MATRIX.md section 0): the search is a page for every lab
  role except Mensajero; the role only changes which rows appear. The new role
  **Consulta** (RESULTS_VIEWER) sees only this page. Its checkbox **"Puede ver órdenes en
  proceso"** (`canViewInProgress`) adds the in-progress view (Facturación).
- **Entidad** = the ordering clinic (`clinicTenantId` on the release / `tenantId` on the
  order).
- **Current version only**: an amended result appears once, as the amendment, marked
  "Corregido". Earlier versions stay reachable from the release history.
- **Date** = release date of the current version, so a corrected result is found by its
  correction date. In the in-progress view: order date.
- **Bounded search**: without a clinic, patient or analyte filter the range defaults to the
  last 30 days and may not exceed one year. Dates are UTC days, like the orders queue.
- **Analyte (v1)**: tests that contain the analyte code, showing its released value, unit
  and H/L flag. No min/max or abnormal-only filters yet.
- **In progress** = ordered tests of this lab not COMPLETED or CANCELLED, with their status.
  **Never values**. Consulta (billing) only sees orders the lab has received (order past
  PENDING / READY_FOR_PICKUP / COLLECTED); staff also see orders still waiting for the sample.

## API (PR 2, `apps/api/src/lab/results-search.service.ts`)

All routes: `LAB_RESULTS_ROLES` (staff + RESULTS_VIEWER), scoped to the caller's lab.

| Route                              | Returns                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET lab/results/search`           | `view=released` (default): one row per current released test — release id/sequence/date, amended, order id, requisition, clinic, patient (species), owner, test; with `analyteCode`, that analyte's value/unit/flag. `view=in_progress`: one row per open test — status, order date, requisition, clinic, patient, test. Paged (`pageSize` ≤ 50); echoes the applied `dateFrom`/`dateTo`. |
| `GET lab/results/clinics`          | Clinics that sent this lab orders (id, name).                                                                                                                                                                                                                                                                                                                                             |
| `GET lab/results/analytes?search=` | Analyte codes in this lab's releases with their latest name (≤ 30).                                                                                                                                                                                                                                                                                                                       |

- `view=in_progress` → 403 for a RESULTS_VIEWER without `canViewInProgress`; 400 with
  `analyteCode`.
- Patient filter: patient name, owner or requisition number, contains, case-insensitive;
  `%` and `_` are taken literally.
- The released view reads the frozen release snapshots (raw SQL: current version =
  `result_report_tests.latestReleaseId = release.id`).
- One log line per search: lab, user, view, which filters were used, total. No patient
  names or search terms.
- Detail of a row reuses `GET orders/:orderId/current-results` and
  `GET orders/:orderId/releases` (+ PDF routes), all open to RESULTS_VIEWER.
- Migration `20261016000002_results_search_indexes`: indexes only.

## Lab page (PR 3)

`/results`, "Resultados" in the sidebar for every role except Mensajero; Consulta is locked
to it. Tabs **Liberados** / **En proceso** (second tab for staff and for Consulta with the
checkbox). Filters: clinic, date range (last 30 days), patient, analyte (Liberados only).
Expanding a released row shows the complete released report with the analyte highlighted,
the PDF and the version history. In-progress rows show status chips only; staff get a link
to the order, Consulta doesn't.

## Not in v1

Abnormal-only / min-max analyte filters; exporting search results; species filter;
full-text index for patient names (revisit if slow).

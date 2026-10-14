# Lab Permission Matrix — Proposal

## 1. Purpose and status

**Proposal — not implemented. Confirm with Biomet before PR 2.**

This document records who can do what in the lab portal today, and proposes moving from
role lists on each endpoint to **named actions** checked against one central matrix.

- **PR 1** (security, in progress): every lab route gets an explicit role list. Routes that
  had no `@Roles` now allow **staff** = TECHNICIAN, ANALYST, REVIEWER, DATA_ENTRY, ADMIN,
  OWNER (`LAB_STAFF_ROLES` in `apps/api/src/lab/lab-roles.ts`). MESSENGER keeps only its own
  pickup workflow. The unused route `POST lab/reports/:reportId/release` is removed. Staff
  permissions do not change.
- **PR 2** (this proposal): action-based permissions, once Biomet confirms the matrix.

"Current" in this document means **the state after PR 1**.

Role names as the lab sees them (`apps/lab/src/assets/i18n/es.json`, `team.roles`):

| Enum         | Lab UI (ES)   | Assignable in Team page                                                     |
| ------------ | ------------- | --------------------------------------------------------------------------- |
| OWNER        | Propietario   | Listed in the UI, but the API rejects it (see 5.3)                          |
| ADMIN        | Administrador | Yes                                                                         |
| REVIEWER     | Revisor       | Yes                                                                         |
| ANALYST      | Analista      | Yes                                                                         |
| DATA_ENTRY   | Digitador     | Yes                                                                         |
| TECHNICIAN   | Personal      | Yes                                                                         |
| MESSENGER    | Mensajero     | Yes                                                                         |
| RECEPTIONIST | —             | No. Clinic role. Some lab routes still list it, but no lab user can have it |

---

## 2. Key finding

1. **TECHNICIAN, ANALYST, REVIEWER and DATA_ENTRY have identical API permissions.** No lab
   route lists one of them without the other three.
2. **The only UI difference** between those four: the **Collections** tab is hidden for
   ANALYST, REVIEWER and DATA_ENTRY (`Layout.tsx`). Personal (TECHNICIAN) sees it. The API
   still lets all four list pickups, confirm received and cancel.
3. **Release and approval are ADMIN/OWNER only:** approve-release, request corrections,
   approve amendment, reverse missing specimen, reassign test, retry PDF. A Revisor
   **cannot** release or request corrections today, even though the name suggests it.
4. **Any staff role can edit and publish result templates and test configs.** This includes
   Digitador.
5. **Signers on the PDF are not user accounts.** The "reviewer" printed on a release is a
   `LabSigner` record from Lab Settings, not the user who pressed Release (section 6).

### Who has which role in production (2026-10-14, all memberships ACTIVE)

| Lab                                | Propietario | Administrador | Revisor | Analista    | Digitador | Personal | Mensajero |
| ---------------------------------- | ----------- | ------------- | ------- | ----------- | --------- | -------- | --------- |
| Biomet Laboratorio                 | 1           | 1             | 2       | 2           | 0         | 0        | 9         |
| Kesher Diagnostics (internal/test) | 1 (pickups) | 0             | 0       | 1 (pickups) | 0         | 0        | 1         |

"(pickups)" = `canPerformPickups` is on. At Biomet **nobody has Personal or Digitador**, so
changing those two roles affects no current Biomet user.

---

## 3. Action catalogue (current roles, after PR 1)

Abbreviations:

- **Staff** = TECHNICIAN, ANALYST, REVIEWER, DATA_ENTRY, ADMIN, OWNER
- **Staff+R** = Staff plus RECEPTIONIST. RECEPTIONIST cannot reach these routes in practice
  (no lab membership has it), so in effect this is the same as Staff
- **Staff+M** = Staff plus MESSENGER. The service also checks that the pickup is assigned to
  the caller
- **A/O** = ADMIN, OWNER

### 3.1 Orders, specimens, results

| Action                    | Routes                                                                                                                                           | Current roles |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| session.me                | `GET lab/me`                                                                                                                                     | Staff+M       |
| orders.view               | `GET lab/orders`, `GET lab/orders/:id`, `GET lab/orders/:id/expected-specimens`, `GET lab/orders/:id/timeline`                                   | Staff         |
| orders.receive            | `PATCH lab/orders/:id/status`, `POST lab/orders/:id/ordered-tests`, `PATCH lab/ordered-tests/:testId/receive`, `POST lab/orders/:id/receive-all` | Staff+R       |
| orderedTests.update ¹     | `PATCH lab/ordered-tests/:testId`                                                                                                                | Staff         |
| specimens.accession       | `POST lab/orders/:id/accession`, `PATCH lab/specimens/:specimenId`                                                                               | Staff+R       |
| specimens.markMissing     | `POST lab/orders/:orderId/specimens/:specimenId/mark-missing`                                                                                    | Staff+R       |
| specimens.reverseMissing  | `POST lab/orders/:orderId/specimens/:specimenId/reverse-missing`                                                                                 | A/O           |
| templateAssignment        | `POST lab/ordered-tests/:testId/resolve-template`, `POST lab/ordered-tests/:testId/assign-template`                                              | A/O           |
| results.enter             | `GET lab/ordered-tests/:testId/result-session`, `PATCH lab/ordered-tests/:testId/analytes`, `POST lab/ordered-tests/batch-result-sessions`       | Staff         |
| results.submit ²          | `POST lab/ordered-tests/:testId/submit-results`, `POST lab/ordered-tests/batch-save-submit`                                                      | Staff         |
| reports.view (draft)      | `GET lab/reports/by-order/:orderId`, `GET lab/reports/:reportId`                                                                                 | Staff         |
| review.submit             | `POST lab/orders/:orderId/submit-for-review`                                                                                                     | Staff         |
| review.requestCorrections | `POST lab/orders/:orderId/request-corrections`                                                                                                   | A/O           |
| results.release           | `POST lab/orders/:orderId/approve-release`                                                                                                       | A/O           |
| signers.view              | `GET lab/signers/reviewers`, `GET lab/signers/analysts`                                                                                          | Staff         |
| releases.view             | `GET lab/orders/:orderId/releases`, `GET lab/orders/:orderId/current-results`                                                                    | Staff         |
| releases.pdf              | `GET lab/releases/:releaseId/artifacts/pdf`, `GET lab/releases/:releaseId/artifacts/pdf/download`                                                | Staff         |
| releases.pdfRetry         | `POST lab/releases/:releaseId/artifacts/pdf/retry`                                                                                               | A/O           |
| amendments.view           | `GET lab/orders/:orderId/active-amendments`, `GET lab/orders/:orderId/amendments/:amendmentId`                                                   | Staff         |
| amendments.create         | `POST lab/orders/:orderId/amendments`                                                                                                            | Staff         |
| amendments.edit           | `PUT lab/orders/:orderId/amendments/:amendmentId/analytes`                                                                                       | Staff         |
| amendments.submit         | `POST lab/orders/:orderId/amendments/:amendmentId/submit`                                                                                        | Staff         |
| amendments.cancel         | `POST lab/orders/:orderId/amendments/:amendmentId/cancel`                                                                                        | Staff         |
| amendments.approve        | `POST lab/orders/:orderId/amendments/:amendmentId/approve`                                                                                       | A/O           |

¹ `PATCH lab/ordered-tests/:testId` accepts `status` (incl. COMPLETED / CANCELLED),
`entryMethod`, `instrumentId` and **`assignedUserId`**. Any staff member can therefore
re-assign a test through this route, even though `reassign` is A/O only. PR 2 should map it
to `worklist.reassign` or drop `assignedUserId` from it.
² `batch-save-submit` saves and submits in one call, so it needs both `results.enter` and
`results.submit`. As far as I found, saving and submitting results do **not** check that the
caller claimed the test. Only `unclaim` checks the assignee.

### 3.2 Worklist

| Action            | Routes                                                                                                                 | Current roles |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------- |
| worklist.view     | `GET lab/worklist/ready-count`, `GET lab/worklist`, `GET lab/worklist/counts`                                          | Staff         |
| worklist.claim    | `POST lab/ordered-tests/:testId/claim`, `POST lab/ordered-tests/:testId/unclaim`, `POST lab/ordered-tests/batch-claim` | Staff         |
| worklist.start    | `POST lab/ordered-tests/:testId/start`, `POST lab/ordered-tests/batch-start`                                           | Staff         |
| worklist.reassign | `POST lab/ordered-tests/:testId/reassign`                                                                              | A/O           |

### 3.3 Configuration

| Action            | Routes                                                                                                                                                                                                                                        | Current roles |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| templates.view    | `GET lab/templates`, `GET lab/templates/:id`                                                                                                                                                                                                  | Staff         |
| templates.edit    | `POST lab/templates`, `POST lab/templates/:id/clone`, `POST lab/templates/:id/draft`, `PATCH lab/template-versions/:id`, `DELETE lab/templates/:id`                                                                                           | Staff         |
| templates.publish | `POST lab/template-versions/:id/publish`, `POST lab/template-versions/:id/archive`                                                                                                                                                            | Staff         |
| testConfig.view   | `GET lab-config/test-configs`                                                                                                                                                                                                                 | Staff         |
| testConfig.edit   | `POST lab-config/test-configs`, `POST lab-config/test-configs/generate`, `DELETE lab-config/test-configs/:id`                                                                                                                                 | Staff         |
| analyzers.view    | `GET lab-config/analyzers`                                                                                                                                                                                                                    | Staff         |
| analyzers.manage  | `POST lab-config/analyzers`, `PATCH lab-config/analyzers/:id`, `POST lab-config/analyzers/:id/enable`, `POST lab-config/analyzers/:id/disable`                                                                                                | A/O           |
| catalog.manage    | `GET catalog/admin`, `POST catalog/`, `PATCH catalog/:id`, `POST catalog/:id/enable`, `POST catalog/:id/disable`, `POST lab/catalog/import-platform`, `POST lab/catalog/import`, `GET lab/catalog/readiness`, `GET lab/catalog/:id/readiness` | A/O           |
| settings.view     | `GET lab/settings/laboratory`, `GET lab/settings/contact`                                                                                                                                                                                     | Staff         |
| settings.edit     | `PATCH lab/settings/laboratory`, `PATCH lab/settings/contact`                                                                                                                                                                                 | A/O           |

### 3.4 Clients, team, verifications

| Action                  | Routes                                                                                                                                                                                                                                                                                                                                             | Current roles |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| clients.manage          | `GET lab/clients`, `GET lab/clients/:id`, `POST lab/clients`, `POST lab/clients/import`, `PATCH lab/clients/:id`, `POST lab/clients/:id/suspend`, `POST lab/clients/:id/reactivate`, `POST lab/clients/:id/invitation/regenerate`, `POST lab/clients/:id/invitation/revoke`, `DELETE lab/clients/:id`, `PATCH lab/clients/:id/collection-settings` | A/O           |
| users.view              | `GET lab/users`                                                                                                                                                                                                                                                                                                                                    | Staff         |
| team.manage             | `POST lab/users`, `PATCH lab/users/:userId/role`, `PATCH lab/users/:userId`, `DELETE lab/users/:userId`                                                                                                                                                                                                                                            | A/O           |
| vetVerifications.view   | `GET lab/vet-verifications/count`, `GET lab/vet-verifications`, `GET lab/vet-verifications/:id`, `GET lab/vet-verifications/:id/document`                                                                                                                                                                                                          | Staff         |
| vetVerifications.decide | `POST lab/vet-verifications/:id/approve`, `POST lab/vet-verifications/:id/reject`, `POST lab/vet-verifications/:id/revoke`                                                                                                                                                                                                                         | A/O           |

### 3.5 Pickups

`pickups.manage` is split into four actions because its routes already have different
roles.

| Action              | Routes                                                                                                                                                                                                          | Current roles |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| pickups.view        | `GET lab/pickups`, `GET lab/pickups/unassigned-count`, `GET lab/pickups/:id`, `GET lab/messengers`                                                                                                              | Staff         |
| pickups.assign      | `POST lab/pickups/:id/assign`                                                                                                                                                                                   | A/O           |
| pickups.receive     | `POST lab/pickups/:id/received`                                                                                                                                                                                 | Staff         |
| pickups.cancel      | `POST lab/pickups/:id/cancel`                                                                                                                                                                                   | Staff         |
| pickups.ownWorkflow | `GET lab/my-pickups`, `POST lab/pickups/:id/accept`, `POST lab/pickups/:id/collected`, `POST lab/pickups/:id/problem`, `POST lab/messengers/me/push-subscription`, `DELETE lab/messengers/me/push-subscription` | Staff+M       |

### 3.6 Not lab-role routes (listed for completeness, not part of the matrix)

| Route                 | Guard                                                                |
| --------------------- | -------------------------------------------------------------------- |
| `POST lab/setup`      | `InternalApiKeyGuard`: bootstraps the first lab admin                |
| `POST catalog/import` | `InternalApiKeyGuard`                                                |
| `GET catalog/`        | `TenantGuard`: any tenant member (clinics too), not `LabTenantGuard` |

Removed in PR 1: `POST lab/reports/:reportId/release`.

**Check:** `routes.json` lists 120 routes. 1 is removed in PR 1. **The 119 that remain each
appear exactly once above**: 116 in actions (3.1–3.5) and 3 outside lab roles (3.6). Role
lists were checked against the controllers on this branch
(`lab.controller.ts`, `lab-config.controller.ts`, `template.controller.ts`,
`catalog.controller.ts`).

---

## 4. Proposed matrix (for discussion)

✓ = allowed · – = not allowed · **?** = Biomet decides · **flag?** = only if the user has an
explicit extra permission (section 5).

| Action                            | Propietario | Administrador | Revisor | Analista | Digitador | Personal | Mensajero | Consulta de resultados |
| --------------------------------- | ----------- | ------------- | ------- | -------- | --------- | -------- | --------- | ---------------------- |
| session.me                        | ✓           | ✓             | ✓       | ✓        | ✓         | ?        | ✓         | ✓                      |
| orders.view                       | ✓           | ✓             | ✓       | ✓        | ✓         | ?        | –         | ?                      |
| orders.receive                    | ✓           | ✓             | ?       | ?        | ?         | ?        | –         | –                      |
| orderedTests.update               | ✓           | ✓             | ?       | ?        | –         | ?        | –         | –                      |
| specimens.accession               | ✓           | ✓             | ?       | ?        | ?         | ?        | –         | –                      |
| specimens.markMissing             | ✓           | ✓             | ?       | ?        | ?         | ?        | –         | –                      |
| specimens.reverseMissing          | ✓           | ✓             | –       | –        | –         | ?        | –         | –                      |
| templateAssignment                | ✓           | ✓             | –       | –        | –         | ?        | –         | –                      |
| results.enter                     | ✓           | ✓             | ?       | ✓        | ✓         | ?        | –         | –                      |
| results.submit                    | ✓           | ✓             | ?       | ✓        | ?         | ?        | –         | –                      |
| reports.view (draft)              | ✓           | ✓             | ✓       | ✓        | ✓         | ?        | –         | –                      |
| review.submit                     | ✓           | ✓             | ?       | ✓        | ?         | ?        | –         | –                      |
| review.requestCorrections         | ✓           | ✓             | ✓       | –        | –         | ?        | –         | –                      |
| results.release                   | ✓           | ✓             | flag?   | –        | –         | ?        | –         | –                      |
| signers.view                      | ✓           | ✓             | ✓       | ✓        | ?         | ?        | –         | –                      |
| releases.view                     | ✓           | ✓             | ✓       | ✓        | ?         | ?        | –         | ✓                      |
| releases.pdf                      | ✓           | ✓             | ✓       | ✓        | ?         | ?        | –         | ✓                      |
| results.search (new)              | ✓           | ✓             | ✓       | ✓        | ?         | ?        | –         | ✓                      |
| releases.pdfRetry                 | ✓           | ✓             | ?       | –        | –         | ?        | –         | –                      |
| amendments.view                   | ✓           | ✓             | ✓       | ✓        | ?         | ?        | –         | –                      |
| amendments.create / edit / submit | ✓           | ✓             | ?       | ✓        | ?         | ?        | –         | –                      |
| amendments.cancel                 | ✓           | ✓             | ?       | ?        | –         | ?        | –         | –                      |
| amendments.approve                | ✓           | ✓             | flag?   | –        | –         | ?        | –         | –                      |
| worklist.view                     | ✓           | ✓             | ✓       | ✓        | ✓         | ?        | –         | –                      |
| worklist.claim / start            | ✓           | ✓             | ?       | ✓        | ?         | ?        | –         | –                      |
| worklist.reassign                 | ✓           | ✓             | ?       | –        | –         | ?        | –         | –                      |
| templates.view                    | ✓           | ✓             | ✓       | ✓        | ?         | ?        | –         | –                      |
| templates.edit / publish          | ✓           | ✓             | ?       | ?        | –         | ?        | –         | –                      |
| testConfig.view                   | ✓           | ✓             | ✓       | ✓        | ?         | ?        | –         | –                      |
| testConfig.edit                   | ✓           | ✓             | ?       | ?        | –         | ?        | –         | –                      |
| analyzers.view                    | ✓           | ✓             | ✓       | ✓        | ?         | ?        | –         | –                      |
| analyzers.manage                  | ✓           | ✓             | –       | –        | –         | ?        | –         | –                      |
| catalog.manage                    | ✓           | ✓             | –       | –        | –         | ?        | –         | –                      |
| settings.view                     | ✓           | ✓             | ?       | ?        | ?         | ?        | –         | –                      |
| settings.edit                     | ✓           | ✓             | –       | –        | –         | ?        | –         | –                      |
| clients.manage                    | ✓           | ✓             | –       | –        | –         | ?        | –         | –                      |
| users.view                        | ✓           | ✓             | ✓       | ✓        | ?         | ?        | –         | –                      |
| team.manage                       | ✓           | ✓             | –       | –        | –         | ?        | –         | –                      |
| vetVerifications.view             | ✓           | ✓             | –       | –        | –         | ?        | –         | –                      |
| vetVerifications.decide           | ✓           | ✓             | –       | –        | –         | ?        | –         | –                      |
| pickups.view / receive / cancel   | ✓           | ✓             | ?       | ?        | ?         | ?        | –         | –                      |
| pickups.assign                    | ✓           | ✓             | –       | –        | –         | ?        | –         | –                      |
| pickups.ownWorkflow               | ✓ ³         | ✓ ³           | ✓ ³     | ✓ ³      | ✓ ³       | ✓ ³      | ✓         | –                      |

³ Only pickups assigned to the caller. Staff can be assigned only when `canPerformPickups`
is on.

Notes on the proposal:

- **Propietario / Administrador** keep everything they have today.
- **Revisor:** reviews and requests corrections, which is new for this role (today A/O only).
  Releasing and approving amendments only with an explicit grant.
- **Analista:** processes the tests assigned to them, enters results, submits for review.
  Does not release.
- **Digitador:** enters and saves results only. Whether they may submit (results.submit /
  review.submit) is a Biomet decision. No approval or release.
- **Personal:** the whole column is open. The role's purpose is unclear and nobody has it at
  Biomet.
- **Mensajero:** unchanged. Own pickup workflow only.
- **Consulta de resultados:** new role from the results-search plan
  (`docs/RESULTS_SEARCH_PLAN.md`, not on this branch). Released results, their PDFs and the
  new search only. Whether it also needs `orders.view` is open.
- **vetVerifications.view:** proposed A/O only, because the UI already shows Verifications
  to admins only. The API currently lets all staff download the vet's verification document.
- **Not proposed:** adding Recepcionista as a lab role, or changing any existing user's role.

---

## 5. Multiple responsibilities

### 5.1 Current model

- One role per user per lab. `UserTenantMembership.role` holds a single value.
- One extra capability: `canPerformPickups` (boolean). It lets a non-messenger be assigned
  pickups. Turning it on or off is part of `PATCH lab/users/:userId` (A/O).

### 5.2 Options

| Option                                                   | How                                                                                                            | Pros                                                                        | Cons                                                                        |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| A. Combined roles                                        | New enum values, e.g. "Analista-Revisor"                                                                       | No schema change beyond the enum                                            | Number of roles grows with every combination                                |
| B. Multiple roles                                        | `role` becomes a list                                                                                          | Matches how people describe their job                                       | Every check and UI must merge roles; harder to reason about                 |
| C. **Main role + explicit extra permissions** (proposed) | Keep `role`, add a small set of grantable actions per membership, e.g. `results.release`, `amendments.approve` | Same pattern as `canPerformPickups`; one matrix plus a short list of grants | Need rules for who grants, how grants are revoked, and how they are audited |

### 5.3 Questions to answer before choosing

1. **Real combinations Biomet needs.** For example: an Analista who also reviews; a Revisor
   who can release.
2. **Who may grant extra permissions?** Owner only, or Admin too?
3. **How are grants revoked,** and how fast must that take effect? Since PR 1 the guard reads
   the membership on every request (no cache) and only ACTIVE memberships pass, so a role
   change or removal applies on the next request. Removing a user hard-deletes the
   membership.
4. **How are grants and role changes audited?** Today there is **no audit log** of role
   changes. `LabUsersService.updateRole` only updates the membership row and records nothing
   about who changed what, or when. The same is true of `updateUser` (incl.
   `canPerformPickups`) and `removeMember`.
5. **Owner protection** is handled in its own PR (`SCRUM-owner-protection`): only an owner
   can change or remove an owner, the last owner is kept, and the Team page no longer offers
   OWNER. Ownership transfer is out of scope.

---

## 6. Signers vs permissions

|                   | Lab Settings signer (`LabSigner`)                                        | User account role (`UserTenantMembership.role`)   |
| ----------------- | ------------------------------------------------------------------------ | ------------------------------------------------- |
| What it is        | Name, title, registration number and signature image printed on the PDF  | Login identity that controls what the user can do |
| Roles             | `roles: String[]` with ANALYST / REVIEWER / DATA_ENTRY (`LabSignerRole`) | One `TenantRole`                                  |
| Linked to a user? | **No.** No `userId` on `LabSigner`                                       | —                                                 |

How it works today:

- `submit-for-review` fails if the lab has **no** signer with REVIEWER (`review.service.ts`).
- On approve-release, the caller (A/O) **picks** a reviewer signer and, optionally, an
  analyst signer. `validateReviewerAuthorization` (`release.service.ts`) checks only that the
  signer belongs to the lab and has the REVIEWER signer role.
- The release stores the chosen signer (`signerId` + snapshot) and the actual user who
  released it (`releasedByUserId`, `releasedByName`). These two can be different people.
- The **analyst signer** must belong to the lab and have the ANALYST signer role (fixed in
  PR 1; before, it was looked up by id only).

The gap: the PDF can show a reviewer who never logged in or reviewed anything. The person
who actually released appears only in the database, not on the PDF.

Questions:

1. Must the reviewer signer on a release be a user who has the review permission (or the
   release permission)?
2. Should signers be linked to user accounts (an optional `userId` on `LabSigner`), so that
   "who signed" and "who released" can be checked to be the same person?
3. If they stay separate, may anyone with `results.release` choose any reviewer signer?

---

## 7. Collections and pickups

| Who                            | Today (API)                                                        | Today (UI)                  | Proposal                                            |
| ------------------------------ | ------------------------------------------------------------------ | --------------------------- | --------------------------------------------------- |
| Owner / Admin                  | View, assign, confirm received, cancel                             | Collections tab             | Unchanged                                           |
| Personal                       | View, confirm received, cancel (no assign)                         | Collections tab             | ?                                                   |
| Analista / Revisor / Digitador | Same as Personal                                                   | Collections tab **hidden**  | ? (API to match the UI, or the UI to match the API) |
| Staff with `canPerformPickups` | Own workflow for pickups assigned to them                          | "My pickups" tab            | Unchanged                                           |
| Mensajero                      | Own workflow only (`my-pickups`, accept, collected, problem, push) | Redirected to `/my-pickups` | Unchanged                                           |

`assign` checks that the target user is a MESSENGER or has `canPerformPickups`
(`pickup.service.ts`). Own-workflow actions check that the pickup is assigned to the caller.

---

## 8. Open questions for Biomet

1. What does **Personal** do at Biomet? Keep it, rename it, or leave it unused?
2. May a **Digitador** submit results and submit for review, or only save?
3. May a **Revisor** release? Everyone with the role, or only named people (grant)?
4. Should a Revisor also be able to approve amendments?
5. Should Analista / Revisor be able to receive orders and accession or mark-missing
   specimens, or is that reception staff only?
6. Who edits and publishes **templates** and **test configs**? Today it is any staff member.
7. Who confirms pickups as received or cancels them? Should non-admins keep the API access
   the UI hides?
8. Which **combined responsibilities** exist today (e.g. Analista + Revisor)?
9. Who may grant extra permissions: Owner only, or Admin as well?
10. Must the PDF reviewer signer be a real user with the review permission?
11. Does **Consulta de resultados** need to see order lists, or only released results?
12. Is an audit trail of role and permission changes required (and for how long)?

---

## 9. What PR 2 will do once confirmed

- One central matrix file (action → roles, plus grantable actions). Routes declare
  `@RequireAction('results.release')` instead of role lists. The guard denies by default.
- `GET lab/me` returns the caller's allowed actions. The lab UI shows tabs and buttons from
  that list instead of `isAdmin` and role-name checks.
- Fix the gaps found above where Biomet confirms: `assignedUserId` on
  `PATCH lab/ordered-tests/:testId`, and the analyst signer tenant/role check.
- Tests per role: for every action, one allowed and one denied case, driven from the matrix
  file.
- No change to existing users' roles. Any data change (grants, audit table) is a migration,
  applied together with the other migrations at the production merge.

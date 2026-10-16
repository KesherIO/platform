# Lab authorization fixes (PR 1)

Branch `SCRUM-security-lab-authz`. Security fixes that must be deployed **before**
the "Consulta de resultados" role (docs/RESULTS_SEARCH_PLAN.md). No migration.
Staff permissions are unchanged; the permission redesign is PR 2
(docs/LAB_PERMISSION_MATRIX.md, a proposal for Biomet).

## How the audit was done

- Every route behind `LabTenantGuard` (117 of the 120 routes in `LabController`,
  `LabConfigController`, `CatalogController`, `TemplateController`; the other 3
  use the internal API key or the clinic guard) was listed from Nest's route
  metadata, so none is missed.
- Each handler was traced into its service to check that every id from the URL
  or body (nested ids, ids inside arrays, signer/assignee ids, PDF release ids)
  is constrained to the caller's lab before it is read or written.
- Production role counts (read-only, aggregate only, 2026-10-14): Biomet
  Laboratorio has OWNER 1, ADMIN 1, ANALYST 2, REVIEWER 2, MESSENGER 9; Kesher
  Diagnostics has OWNER 1, ANALYST 1, MESSENGER 1. All memberships are ACTIVE.
  No platform template has ever been edited in production (226 versions, all v1).

## Findings and fixes

| #   | Finding                                                                                                                                                                                                                                                                                        | Severity   | Fix                                                                                                                                                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `POST lab/reports/:reportId/release` released **any lab's** report by id, with no role check, outside the review/approval/snapshot pipeline (no release record, no PDF; sets the clinic case to COMPLETED). Unused by the lab app.                                                             | Critical   | Route and `labApi.results.releaseReport` removed. The internal-key route in `results.controller.ts` is unchanged.                                                                                                                                                                        |
| 2   | Template drafts, edits, publish and archive (`lab/templates/:id/draft`, `lab/template-versions/:id`, `/publish`, `/archive`) had no lab or scope check: any lab user could rewrite, publish or switch off **another lab's** templates and the **shared platform templates** used by every lab. | Critical   | Writes require a LABORATORY template of the caller's lab: platform → 403 ("clone it to customize it"), other lab / missing → 404. The UI only offered these actions on lab templates.                                                                                                    |
| 3   | `GET lab/templates/:id` returned any lab's template with drafts.                                                                                                                                                                                                                               | Medium     | Only platform templates and the caller's own.                                                                                                                                                                                                                                            |
| 4   | `GET lab/reports/:reportId` returned any lab's report (patient data).                                                                                                                                                                                                                          | High       | Looked up through `order.labTenantId`.                                                                                                                                                                                                                                                   |
| 5   | `GET lab/reports/by-order/:orderId` compared the lab id with the report's **clinic** tenant column (always 404).                                                                                                                                                                               | Bug        | Same lookup through the order.                                                                                                                                                                                                                                                           |
| 6   | `PATCH lab/settings/laboratory` updated signers by id only: lab A could overwrite lab B's signer name, registration and signature image (what lab B's PDFs show).                                                                                                                              | High       | Signer ids are checked against the lab **before anything is written**; updates are also scoped to the profile.                                                                                                                                                                           |
| 7   | `approve-release` accepted any `analystId`: another lab's analyst (and signature) could be put on a release PDF.                                                                                                                                                                               | High       | Must be a signer of this lab with the ANALYST role (same rule as the reviewer).                                                                                                                                                                                                          |
| 8   | `POST lab/clients/:id/invitation/regenerate` issued a clinic **ADMIN** onboarding token even for a clinic that had already onboarded (possibly also working with other labs) → the lab could create an admin for the clinic.                                                                   | High       | Refused once the clinic has users. The UI only shows the card for clients that aren't active.                                                                                                                                                                                            |
| 9   | `PATCH lab/ordered-tests/:testId` accepted any user id as assignee.                                                                                                                                                                                                                            | Medium     | Must be a member of the lab.                                                                                                                                                                                                                                                             |
| 10  | `POST lab-config/test-configs` accepted another lab's catalog item / analyzer (and exposed their names).                                                                                                                                                                                       | Low–Medium | Both must belong to the lab.                                                                                                                                                                                                                                                             |
| 11  | Image fetch for PDFs accepted any URL **starting with** `SUPABASE_URL`, e.g. `https://<project>.supabase.co.attacker.example` (server-side request), and followed redirects.                                                                                                                   | Medium     | Same origin **and** a `/storage/v1/` path; redirects refused (`redirect: 'error'`), so a redirect can't lead outside the check. All logo/signature URLs in production are data URLs or Storage paths (checked).                                                                          |
| 12  | Routes without `@Roles` were open to every lab member. Messengers (UI-locked to their pickups) could call result entry, submit, batch save, reports, PDFs, cancel/receive any pickup, list members' emails, etc.                                                                               | High       | Every lab route now declares roles. Former open routes → all staff roles (unchanged for staff). MESSENGER keeps only its workflow: `GET me`, `GET my-pickups`, pickup `accept`/`collected`/`problem` (the service checks the pickup is assigned to them), push subscription save/remove. |
| 13  | `LabTenantGuard` cached the membership 60 s **per server**: a role change or removal could keep working for a minute, longer on other instances. It also ignored `membership.status`.                                                                                                          | Medium     | No cache: the membership is read on every request (one primary-key lookup), so changes apply on the next request on every instance. Only ACTIVE memberships pass.                                                                                                                        |

Everything else in scope was already lab-scoped (orders, ordered tests,
specimens incl. nested `orderId/specimenId`, worklist incl. batch claim/start,
result entry incl. batch, review, release history/current results, PDF status /
download / retry, amendments incl. nested `orderId/amendmentId`, clients,
vet verifications, catalog, analyzers, pickups, users).

## Behavior changes to check with Biomet

- **Messengers** can't call anything outside their pickup screen. They never
  had more in the UI; MyPickupsPage needs nothing else.
- **Platform templates** can't be edited from a lab account; clone to customize
  (already the UI's flow).
- **Regenerate invitation** fails for a clinic that already has users.
- Each lab request does one extra small database read (the removed cache).

## Not fixed here (follow-ups)

Out of PR 1's scope (not cross-lab, or need a product decision):

- **Batch save & submit** (`result-entry.service.ts`): files every test under
  the first test's report if a batch mixes orders, and doesn't block tests whose
  results are already released (bypasses amendments). Same lab, but a data
  integrity risk — next priority.
- **Within-lab roles**: identical permissions for Personal/Analista/Revisor/
  Digitador; any staff can set an assignee (bypassing the admin-only reassign);
  an Admin can demote or remove the Owner (fixed, 48b1371); no audit log of
  role changes (fixed — see "Membership audit log" below) → PR 2.
- `PATCH lab/users/:userId` edits the global user row (shared with other tenants).
- Vet verification approve/revoke and "verification required" toggles act on
  clinics shared with other labs (status is per clinic, not per lab).
- Shared clinic profile: suspend/reactivate and pickup settings apply to every
  connected lab.
- `verifyLabClientConnection` ignores inactive connections' `isActive`.
- Push subscription upsert by endpoint reassigns the user (needed when another
  user signs in on the same device; the endpoint URL is a browser secret).
- Internal-key routes (`lab/setup`, `catalog/import`) don't check the tenant is a LAB.

## Tests

- `lab-routes.authz.spec.ts` (route permission audit, ~200 cases): every lab
  route declares `@Roles`; the removed route stays removed; MESSENGER is allowed
  on exactly its 7 routes and **gets 403 from the real guard on every other
  route**; TECHNICIAN keeps access to every staff route; every route is staff,
  staff+reception or admin-only (pins current staff permissions until PR 2);
  release/corrections/amendment approval/PDF retry/role changes stay admin-only.
- `lab-tenant.guard.spec.ts`: role change and removal apply on the next request;
  non-ACTIVE memberships and clinic tenants rejected.
- Cross-lab cases: reports (both lookups), templates (other lab → 404, platform
  → 403, nothing written), signers (rejected before any write), analyst signer,
  assignee, test-config ids, invitation for an onboarded clinic, look-alike
  storage hosts.

Results on this branch: API **49 suites passed, 1096 tests** (2 integration
suites skipped, they need a database); lab **50 tests** passed; API and lab type
checks clean; ESLint no errors; Prettier clean.

## Membership audit log (2026-10-15)

`membership_events` (migration `20261015000001_membership_events`) records every
lab membership change, written by `recordMembershipEvent()`
(`apps/api/src/lab/membership-events.ts`) **inside the same transaction** as the change:

| Event                       | Written by                                                                         | Reason   |
| --------------------------- | ---------------------------------------------------------------------------------- | -------- |
| `MEMBER_ADDED`              | `createLabUser` (lab UI), `bootstrapAdmin` (system), lab onboarding OWNER (system) | optional |
| `ROLE_CHANGED`              | `updateRole`                                                                       | required |
| `PICKUP_CAPABILITY_CHANGED` | `updateUser` when `canPerformPickups` actually flips                               | optional |
| `REMOVED`                   | `removeMember`                                                                     | required |

- Stores actor, target, lab, previous/new role, status and pickup flag, reason, source,
  timestamp, plus a snapshot of names/emails. No FK to users, so history survives removal.
- No-ops log nothing: same-role requests, unchanged pickup flag, schedule/profile edits,
  rejected (owner protection, 404, conflict) or rolled-back changes. The target membership
  row is locked (`FOR UPDATE`) before it is read, so a concurrent duplicate or a retry sees
  the first change and becomes a no-op (integration-tested).
- Read-only: `GET lab/users/history` (per lab, optional `userId`, cursor paging) and
  `GET lab/users/removed`, ADMIN/OWNER only. History is scoped to the lab, not to a
  current membership, so removed members stay reachable. No edit/delete endpoints; a DB
  trigger rejects UPDATE.
- `INVITED`, `INVITATION_ACCEPTED`, `DEACTIVATED`, `REACTIVATED` are reserved in the enum:
  lab staff have no invite or deactivate flow yet (staff invitations are clinic-only).
  Clinic memberships (`tenants.service`, `onboarding` invite/accept, vet-verification
  status changes) are not logged yet.

## Signers linked to the team (2026-10-15)

Biomet decision: the analyst and reviewer are still picked from dropdowns at release, but
an **Analyst signer must be a team member**. Reviewer (and Data entry) signers may be
people without an account, e.g. a director.

- `lab_signers.userId` (migration `20261015000002_signer_team_link`), one signer per person
  per lab. `upsertLaboratoryProfile` rejects, before writing: an Analyst signer without a
  link, a person linked twice, a new or changed link to someone who isn't a member of the
  lab. An unchanged link to someone since removed is kept so settings still save.
- Analyst dropdown (`getAnalystSigners`) and the release check (`approveAndRelease`) only
  accept analyst signers linked to an ACTIVE member of this lab: removing someone from the
  team takes them off the analyst list. Past releases keep their frozen snapshot.
- Link/unlink, signer role changes and signature replacement of a linked signer go to the
  team history (`SIGNER_LINKED`, `SIGNER_UNLINKED`, `SIGNER_ROLES_CHANGED`,
  `SIGNATURE_REPLACED`, `details` holds the signer), in the same transaction as the signer
  save. Unlinked signers aren't audited (no team member to attach them to).
- Team page shows a "Signer" badge; Settings has a "Team member" picker per signer.

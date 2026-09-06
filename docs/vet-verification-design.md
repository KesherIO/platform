# Veterinarian Verification — Complete Design

**Status:** Approved for implementation  
**Last updated:** 2026-09-04  
**Scope:** Clinic onboarding, vet credentials, per-lab approval, case/order vet tracking, result snapshots, lab review queue

---

## Table of Contents

1. [How the Current System Works](#1-how-the-current-system-works)
2. [Existing Files Involved](#2-existing-files-involved)
3. [Gaps](#3-gaps)
4. [Domain Model](#4-domain-model)
5. [Migration and Backfill Strategy](#5-migration-and-backfill-strategy)
6. [Complete Backend Flow](#6-complete-backend-flow)
7. [Clinic and Vet UI Changes](#7-clinic-and-vet-ui-changes)
8. [Lab Portal UI Changes](#8-lab-portal-ui-changes)
9. [Notification Strategy](#9-notification-strategy)
10. [Report and PDF Changes](#10-report-and-pdf-changes)
11. [Security and Privacy](#11-security-and-privacy)
12. [Edge Cases and Race Conditions](#12-edge-cases-and-race-conditions)
13. [Phased Implementation Plan](#13-phased-implementation-plan)
14. [Complexity and Risk](#14-complexity-and-risk)
15. [Confirmed Product Decisions](#15-confirmed-product-decisions)

---

## 1. How the Current System Works

### Multi-tenancy and roles

Three `TenantType` values: `CLINIC`, `LAB`, `PLATFORM`. Every user is linked to tenants via `UserTenantMembership` (composite PK: `userId + tenantId`). The `role` column holds one of: `OWNER`, `ADMIN`, `VET`, `TECHNICIAN`, `RECEPTIONIST`, `MESSENGER`.

Roles are **never read from the JWT**. On every request `TenantGuard` queries `user_tenant_memberships` for the `x-tenant-id` header tenant, then enforces `@Roles()` decorators. The JWT carries only the Supabase identity (`sub`, `email`).

A user holds **one role per tenant**. The composite PK enforces this. A person can be VET in Clinic A and ADMIN in Clinic B, but not both VET and ADMIN in the same clinic.

### Onboarding and invitation flows

Two flows:

- **Admin onboarding** — KesherIO generates a single-use `OnboardingToken`. The clinic owner completes it at `POST /onboarding/complete`. Creates Supabase user + `User` row + `Tenant` + ADMIN `UserTenantMembership` atomically with a compensating delete if the DB write fails.
- **Staff onboarding** — Clinic admin calls `POST /onboarding/invite?tenantId=` to generate a `TenantInvitation` token. Staff accepts at `POST /onboarding/complete-staff` (public) or `POST /onboarding/staff-profile` (authenticated). Creates/reuses Supabase user, updates `User.firstName/lastName`, creates `UserTenantMembership`.

### Post-login routing

`auth.service.ts getMe()` computes `onboardingCompleted` as:

```
clinicMemberships.length > 0 AND user.firstName != null AND clinicName != null
```

`navigateAfterAuth()` routes to `/onboarding/welcome` if false, `/dashboard` if true.

### Cases and orders

- `POST /cases` — accepts `CreateCaseDto` (patient + owner fields only). Sets `createdByUserId = req.user.id`. **No veterinarian field.**
- `POST /cases/:id/order` — accepts `SendOrderDto` (priority, deliveryMethod, clinicNotes). Calls `ordersService.createOrderForCase(tenantId, caseId)`. **No userId is passed. No vet reference in Order.**
- No `orderingVetId` or vet snapshot fields exist on `Case` or `Order`.

### Clinic-to-lab relationship

`ClinicLabConnection` table: `(clinicId, labId, isDefault, isActive)`. Unique on `(clinicId, labId)`. MVP: one active connection per clinic. No `vetVerificationRequired` field exists on this table or on `LaboratoryProfile`.

### Lab configuration

`LaboratoryProfile` (1:1 with LAB tenant): accreditationNumber, directorName, directorCredentials, defaultObservations, reportDisclaimer, signatureUrl, and `LabSigner[]`. No `vetVerificationRequired` field.

`LabSigner` model is the closest analogue to a `VeterinarianProfile`: name, roles[], title, specialty, university, registrationNumber, signatureUrl.

### Result releases and immutable snapshots

`ResultReportRelease` freezes at release time: signer details, analyst details, lab identity, clinic identity, order details, patient/owner data. **No ordering veterinarian information.**

PDF generation exists as a placeholder (`ResultReportReleaseArtifact` with status `PENDING`) — not yet implemented.

### Notification system

Web Push only (`PushSubscription` table + `web-push` library via `PushService`). Currently only messengers in the lab portal register subscriptions. No push mechanism for clinic-side users.

### Storage

One bucket confirmed: `clinic-logos`, public, path `{tenantId}/logo.{ext}`. No private bucket for sensitive documents. Signed URL generation not implemented.

### Audit trail

`TimelineEvent` (table `timeline_events`) is order-scoped. Stores: eventType, actorId, actorName, description, metadata (JSON), createdAt. No cross-cutting audit table.

---

## 2. Existing Files Involved

| Concern                 | Files                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| Prisma schema           | `apps/api/prisma/schema.prisma`                                                                                |
| Latest migration        | `apps/api/prisma/migrations/20260903000001_add_analyte_is_required`                                            |
| Auth strategy           | `apps/api/src/auth/strategies/jwt.strategy.ts`                                                                 |
| Auth service            | `apps/api/src/auth/auth.service.ts`                                                                            |
| Auth guards             | `apps/api/src/auth/guards/tenant.guard.ts`, `jwt-auth.guard.ts`, `roles.guard.ts`, `internal-api-key.guard.ts` |
| Lab tenant guard        | `apps/api/src/lab/lab-tenant.guard.ts`                                                                         |
| Roles decorator         | `apps/api/src/auth/decorators/roles.decorator.ts`                                                              |
| Onboarding              | `apps/api/src/onboarding/onboarding.controller.ts`, `onboarding.service.ts`                                    |
| Tenants (staff mgmt)    | `apps/api/src/tenants/tenants.controller.ts`, `tenants.service.ts`                                             |
| Cases                   | `apps/api/src/cases/cases.controller.ts`, `cases.service.ts`, `cases.dto.ts`                                   |
| Orders                  | `apps/api/src/orders/orders.service.ts`, `create-order.dto.ts`                                                 |
| Lab controller          | `apps/api/src/lab/lab.controller.ts`                                                                           |
| Lab service             | `apps/api/src/lab/lab.service.ts`                                                                              |
| Release service         | `apps/api/src/lab/release.service.ts`                                                                          |
| Review service          | `apps/api/src/lab/review.service.ts`                                                                           |
| Push notifications      | `apps/api/src/notifications/push.service.ts`                                                                   |
| Storage                 | `apps/api/src/storage/storage.service.ts`                                                                      |
| Results service         | `apps/api/src/results/results.service.ts`                                                                      |
| Shared types            | `libs/shared-types/src/lib/auth.model.ts`, `case.model.ts`, `order.model.ts`, `lab.model.ts`                   |
| Frontend auth service   | `apps/frontend/src/app/core/services/auth.service.ts`                                                          |
| Frontend auth guard     | `apps/frontend/src/app/core/guards/auth.guard.ts`                                                              |
| Frontend routing        | `apps/frontend/src/app/app.routes.ts`                                                                          |
| Clinic new-case form    | `apps/frontend/src/app/features/cases/new-case/new-case.component.ts`                                          |
| Clinic order form       | `apps/frontend/src/app/features/cases/order/order.component.ts`                                                |
| Clinic settings/staff   | `apps/frontend/src/app/features/settings/staff/staff-settings.component.ts`                                    |
| Clinic translations     | `apps/frontend/src/assets/i18n/en.json`, `es.json`                                                             |
| Lab portal types        | `apps/lab/src/app/types/lab.types.ts`                                                                          |
| Lab portal API client   | `apps/lab/src/app/shared/api/labApi.ts`                                                                        |
| Lab portal auth         | `apps/lab/src/app/auth/AuthContext.tsx`                                                                        |
| Lab portal StatusBadge  | `apps/lab/src/app/shared/components/StatusBadge.tsx`                                                           |
| Lab portal Layout       | `apps/lab/src/app/shared/components/Layout.tsx`                                                                |
| Lab portal translations | `apps/lab/src/assets/i18n/en.json`, `es.json`                                                                  |

---

## 3. Gaps

| Gap                                                 | Impact                                                   |
| --------------------------------------------------- | -------------------------------------------------------- |
| No `VeterinarianProfile` model                      | Cannot store professional identity                       |
| No `VeterinarianCredential` model                   | Cannot store or version license documents                |
| No `VetLabVerification` model                       | No approval record, no audit trail                       |
| No `VetVerificationEvent` audit table               | No per-event history for verification lifecycle          |
| No `MembershipStatus` on `UserTenantMembership`     | No per-clinic routing signal for pending vets            |
| No `isOrderingVet` on `UserTenantMembership`        | Cannot distinguish professional role from access role    |
| No `vetVerificationRequired` on `LaboratoryProfile` | Cannot configure per-lab requirement                     |
| No `attendingVetId` on `Case`                       | No vet association at case level                         |
| No `orderingVetId` or snapshot fields on `Order`    | No authoritative vet record at submission time           |
| No vet snapshot fields on `ResultReportRelease`     | Releases omit ordering vet from historical record        |
| `onboardingCompleted` is a global boolean           | Cannot express per-clinic verification state             |
| No private Supabase Storage bucket                  | Sensitive credential documents cannot be stored securely |
| Push notifications are messenger-only               | No notification path for clinic or vet users             |

---

## 4. Domain Model

### 4.1 `UserTenantMembership` — two new columns

```prisma
enum MembershipStatus {
  INVITED
  PROFILE_REQUIRED
  VERIFICATION_PENDING
  ACTIVE
  SUSPENDED
}

model UserTenantMembership {
  userId            String
  tenantId          String
  role              TenantRole        // application permissions — unchanged
  isOrderingVet     Boolean           @default(false)   // professional responsibility in this clinic
  status            MembershipStatus  @default(ACTIVE)  // per-clinic access state
  schedule          Json?
  canPerformPickups Boolean           @default(false)
  createdAt         DateTime          @default(now())

  user   User   @relation(fields: [userId], references: [id])
  tenant Tenant @relation(fields: [tenantId], references: [id])

  @@id([userId, tenantId])
  @@index([tenantId])
  @@index([userId])
}
```

**Separation of concerns:**

- `role` = application permissions (what menus and endpoints you can access)
- `isOrderingVet` = professional responsibility in this clinic (can you be selected as ordering vet)
- `VeterinarianProfile` = reusable professional identity and credentials (belongs to the person, not the clinic)

**Examples:**

```
role = VET,          isOrderingVet = true   → clinic staff vet
role = ADMIN,        isOrderingVet = true   → clinic admin who also practices
role = RECEPTIONIST, isOrderingVet = false  → front desk, can create cases but not order as vet
```

### 4.2 `VeterinarianProfile` — stable professional identity

```prisma
model VeterinarianProfile {
  id        String   @id @default(cuid())
  userId    String   @unique
  legalName String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user          User                     @relation(fields: [userId], references: [id])
  credentials   VeterinarianCredential[]
  verifications VetLabVerification[]
}
```

Holds only identity that does not change with credential renewals. License data, document, and expiry live in `VeterinarianCredential` for versioning. Reachable from any membership via `membership.userId → User → VeterinarianProfile` without needing a FK on the membership itself.

### 4.3 `VeterinarianCredential` — versioned, immutable credential records

```prisma
model VeterinarianCredential {
  id                    String    @id @default(cuid())
  veterinarianProfileId String
  documentKey           String    // immutable storage path; never overwritten
  licenseNumber         String
  issuingCountry        String    // ISO 3166-1 alpha-2
  issuingAuthority      String?
  licenseExpiresAt      DateTime?
  createdAt             DateTime  @default(now())
  replacedAt            DateTime? // null = current active credential

  veterinarianProfile VeterinarianProfile  @relation(fields: [veterinarianProfileId], references: [id])
  reviews             VetLabVerification[] @relation("ReviewedCredential")

  @@index([veterinarianProfileId])
}
```

The active credential is the row where `replacedAt IS NULL`. At most one per profile at any time.

**Storage path format:** `vet-credentials/{userId}/{credentialId}.{ext}`
The credential ID is included in the path so paths are unique and immutable. `upsert: false` is passed to Supabase Storage on upload to prevent accidental overwrites.

**When the vet uploads a new document:**

1. New `VeterinarianCredential` inserted (`replacedAt = null`)
2. Previous active credential stamped with `replacedAt = now()`
3. Every `VetLabVerification` with status `APPROVED` returns to `PENDING`
4. Affected `UserTenantMembership.status` rows revert to `VERIFICATION_PENDING`
5. A `RESUBMITTED` `VetVerificationEvent` is written for each affected verification

### 4.4 `VetLabVerification` — one record per vet × lab

```prisma
enum VetVerificationStatus {
  PENDING
  APPROVED
  REJECTED
  REVOKED
  EXPIRED
}

model VetLabVerification {
  id                   String                @id @default(cuid())
  vetProfileId         String
  labTenantId          String
  initiatingClinicId   String                // for audit and notifications only
  status               VetVerificationStatus @default(PENDING)
  reviewedCredentialId String?               // which VeterinarianCredential was reviewed
  submittedAt          DateTime              // set by backend only, never by client
  reviewedAt           DateTime?
  reviewedByUserId     String?
  reviewedByName       String?               // name snapshot
  rejectionReason      String?
  revokedAt            DateTime?
  revokedByUserId      String?
  revokedReason        String?
  createdAt            DateTime              @default(now())
  updatedAt            DateTime              @updatedAt

  vetProfile         VeterinarianProfile     @relation(fields: [vetProfileId], references: [id])
  labTenant          Tenant                  @relation("LabVerifications", fields: [labTenantId], references: [id])
  initiatingClinic   Tenant                  @relation("ClinicVerifications", fields: [initiatingClinicId], references: [id])
  reviewedBy         User?                   @relation(fields: [reviewedByUserId], references: [id])
  reviewedCredential VeterinarianCredential? @relation("ReviewedCredential", fields: [reviewedCredentialId], references: [id])
  events             VetVerificationEvent[]

  @@unique([vetProfileId, labTenantId])
  @@index([labTenantId, status])
  @@index([initiatingClinicId])
}
```

One row per (vet, lab). Status transitions are recorded in `VetVerificationEvent`; the row is updated in place. The `initiatingClinicId` is for audit and notification routing only — it does not make the approval clinic-specific. Any clinic connected to the same lab benefits from an approval.

### 4.5 `VetVerificationEvent` — dedicated audit table

```prisma
enum VetVerificationEventType {
  SUBMITTED
  APPROVED
  REJECTED
  RESUBMITTED
  REVOKED
  EXPIRED
  DOCUMENT_VIEWED
}

model VetVerificationEvent {
  id                  String                   @id @default(cuid())
  verificationId      String
  eventType           VetVerificationEventType
  actorId             String?
  actorName           String?
  clinicTenantId      String?
  credentialVersionId String?                  // VeterinarianCredential.id at event time
  reason              String?
  metadata            Json?
  createdAt           DateTime                 @default(now())

  verification VetLabVerification @relation(fields: [verificationId], references: [id])

  @@index([verificationId, createdAt])
}
```

`TimelineEvent` is not modified. Order events and verification events are different domains and must not share a table. `DOCUMENT_VIEWED` is written every time the API generates a signed URL for a lab reviewer — this is the audit record for sensitive document access.

### 4.6 `LaboratoryProfile` — new field

```prisma
vetVerificationRequired Boolean @default(false)
```

Default `false` — backward compatible. All existing labs and vets are unaffected.

### 4.7 `Case` — new field

```prisma
attendingVetId String?
attendingVet   User?   @relation("CaseAttendingVet", fields: [attendingVetId], references: [id])
```

UX convenience: preselected on case creation for vet users. Feeds into the order as the default `orderingVetId`.

### 4.8 `Order` — new fields

```prisma
orderingVetId               String?
orderingVetName             String?    // snapshot at submission time
orderingVetLicenseNumber    String?    // snapshot at submission time
orderingVetIssuingAuthority String?    // snapshot at submission time
orderingVet                 User?      @relation("OrderOrderingVet", fields: [orderingVetId], references: [id])
```

The FK `orderingVetId` is for live queries. The three snapshot fields ensure historical accuracy even if the vet updates their profile or gets revoked later.

### 4.9 `ResultReportRelease` — new fields

```prisma
orderingVetId               String?
orderingVetName             String?
orderingVetLicenseNumber    String?
orderingVetIssuingAuthority String?
```

Populated at release from the `Order` snapshot — never from the live `VeterinarianProfile`. Existing releases are unaffected (fields remain null).

---

## 5. Migration and Backfill Strategy

All new columns are nullable or have safe defaults. No blocking migration. Run in order.

### Migration A — VeterinarianProfile and VeterinarianCredential

Creates two new tables. No dependency on new enums.

### Migration B — VetVerificationStatus enum, VetLabVerification, VetVerificationEventType enum, VetVerificationEvent

### Migration C — MembershipStatus enum + two columns on UserTenantMembership

```sql
ALTER TABLE user_tenant_memberships
  ADD COLUMN is_ordering_vet BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE';

-- Backfill: existing VET memberships become ordering vets
UPDATE user_tenant_memberships SET is_ordering_vet = true WHERE role = 'VET';

-- Status backfill: ACTIVE is correct for all existing rows (they completed onboarding before
-- this feature. Do not block them.)
```

### Migration D — vetVerificationRequired on LaboratoryProfile

```sql
ALTER TABLE laboratory_profiles
  ADD COLUMN vet_verification_required BOOLEAN NOT NULL DEFAULT false;
-- No backfill needed; false is the safe backward-compatible default.
```

### Migration E — attendingVetId on Case, orderingVetId + snapshot fields on Order

```sql
ALTER TABLE cases ADD COLUMN attending_vet_id TEXT REFERENCES users(id);
ALTER TABLE orders
  ADD COLUMN ordering_vet_id TEXT REFERENCES users(id),
  ADD COLUMN ordering_vet_name TEXT,
  ADD COLUMN ordering_vet_license_number TEXT,
  ADD COLUMN ordering_vet_issuing_authority TEXT;
```

### Migration F — vet snapshot fields on ResultReportRelease

```sql
ALTER TABLE result_report_releases
  ADD COLUMN ordering_vet_id TEXT,
  ADD COLUMN ordering_vet_name TEXT,
  ADD COLUMN ordering_vet_license_number TEXT,
  ADD COLUMN ordering_vet_issuing_authority TEXT;
```

### Supabase Storage (manual step — document in runbook)

Create a **private** bucket `vet-credentials` via Supabase dashboard or management API:

- No public access policy
- RLS: deny all direct client access
- All access via API using service role key + signed URLs

### Seed update

In `apps/api/prisma/seeds/seed-lab-tenant.mjs` add `vetVerificationRequired: false` explicitly to the lab's `LaboratoryProfile` so the field is visible in development fixtures.

---

## 6. Complete Backend Flow

### 6.1 Module structure

**New module:**

```
apps/api/src/vet-profile/
  vet-profile.module.ts
  vet-profile.controller.ts
  vet-profile.service.ts
  vet-profile.dto.ts

apps/api/src/vet-verification/
  vet-verification.module.ts
  vet-verification.controller.ts     ← clinic-facing
  vet-verification.service.ts
  vet-verification.dto.ts
```

**Extended:**

```
apps/api/src/lab/
  lab-vet-verification.service.ts   ← new service, mounted in LabModule
  lab.controller.ts                 ← new endpoints added here
```

### 6.2 VeterinarianProfile endpoints

All use `JwtAuthGuard` (global) + `TenantGuard` (requires active clinic membership). Always self-service on `req.user.id`.

```
GET  /api/vet-profile
     → returns VeterinarianProfile with current VeterinarianCredential (replacedAt IS NULL)
     → 404 if no profile exists

POST /api/vet-profile
     → creates VeterinarianProfile for req.user.id
     → body: { legalName }
     → 409 if already exists

PATCH /api/vet-profile
     → updates legalName

POST /api/vet-profile/credential
     → multipart/form-data: { file, licenseNumber, issuingCountry, issuingAuthority?, licenseExpiresAt? }
     → requires VeterinarianProfile to exist
     → uploads to private bucket with immutable path: vet-credentials/{userId}/{credentialId}.{ext}
     → creates VeterinarianCredential (replacedAt = null)
     → sets replacedAt = now() on previous active credential
     → if any VetLabVerification is APPROVED: reset to PENDING, update membership status,
       write RESUBMITTED VetVerificationEvent
     → returns: { credentialId, documentKey }

GET  /api/vet-profile/credential/document
     → generates 1-hour signed URL for current credential's document
     → only accessible to the vet themselves (req.user.id === profile.userId)
     → writes DOCUMENT_VIEWED VetVerificationEvent
     → returns: { signedUrl, expiresAt }
```

### 6.3 Clinic-facing verification endpoints

```
GET  /api/vet-verification/status
     → TenantGuard (clinic)
     → returns VetLabVerification for (req.user's vetProfile, current clinic's lab)
     → null if no verification exists or lab does not require it
     → includes: status, rejectionReason, submittedAt, reviewedAt

POST /api/vet-verification/submit
     → TenantGuard (clinic)
     → validations in order:
       1. membership.isOrderingVet must be true
       2. VeterinarianProfile must exist for req.user.id
       3. Active VeterinarianCredential (replacedAt IS NULL) must exist
       4. if licenseExpiresAt is set: must be > now()
       5. ClinicLabConnection must exist for this clinic
       6. if vetVerificationRequired is false → return { required: false } (idempotent, no record)
       7. if existing verification is APPROVED → return { status: APPROVED } (idempotent)
       8. if existing is PENDING → return existing (idempotent)
       9. if existing is REJECTED or REVOKED → update to PENDING, set submittedAt, write RESUBMITTED event
       10. if none → create new VetLabVerification (PENDING), write SUBMITTED event
     → sets UserTenantMembership.status = VERIFICATION_PENDING
     → returns: { verificationId, status, submittedAt }
```

### 6.4 Lab-facing verification endpoints

All use `LabTenantGuard`.

```
GET  /api/lab/vet-verifications
     → no role restriction (all lab staff can view)
     → query: ?status=PENDING|APPROVED|REJECTED|REVOKED&search=&page=&pageSize=
     → returns paginated list: vet legalName, licenseNumber, issuingCountry, issuingAuthority,
       licenseExpiresAt, submittedAt, status, initiatingClinic name

GET  /api/lab/vet-verifications/:id
     → returns full record + VeterinarianProfile + active VeterinarianCredential fields
     → does NOT include signedUrl (separate call)

GET  /api/lab/vet-verifications/:id/document
     → @Roles(ADMIN, OWNER, TECHNICIAN)
     → generates 1-hour signed URL for the credential document
     → writes DOCUMENT_VIEWED VetVerificationEvent with actorId, clinicTenantId
     → returns: { signedUrl, expiresAt }

POST /api/lab/vet-verifications/:id/approve
     → @Roles(ADMIN, OWNER)
     → validation: status must be PENDING
     → transaction:
       a. status = APPROVED, reviewedAt, reviewedByUserId, reviewedByName
       b. reviewedCredentialId = current active VeterinarianCredential.id
       c. write APPROVED VetVerificationEvent
       d. UserTenantMembership.status = ACTIVE for all memberships where:
            userId = vet's userId
            AND tenant.labConnections.some(conn => conn.labId = this lab AND conn.isActive)
            AND isOrderingVet = true

POST /api/lab/vet-verifications/:id/reject
     → @Roles(ADMIN, OWNER)
     → body: { rejectionReason: string } (required, non-empty)
     → status = REJECTED, rejectionReason, reviewedAt, reviewedByUserId, reviewedByName
     → write REJECTED VetVerificationEvent
     → UserTenantMembership.status stays VERIFICATION_PENDING
       (vet can still authenticate; sees rejection screen)

POST /api/lab/vet-verifications/:id/revoke
     → @Roles(ADMIN, OWNER)
     → body: { revokedReason: string } (required)
     → status = REVOKED, revokedAt, revokedByUserId, revokedReason
     → write REVOKED VetVerificationEvent
     → UserTenantMembership.status = VERIFICATION_PENDING for affected clinics

GET  /api/lab/vet-verifications/count
     → query: ?status=PENDING
     → returns: { count: number }
     → used by lab Layout for badge polling

PATCH /api/lab/settings/laboratory   (existing endpoint, extended)
     → add vetVerificationRequired to UpsertLaboratoryProfileDto
     → when toggling true → false: sweep VERIFICATION_PENDING memberships
       connected to this lab → ACTIVE (unblock existing vets immediately)
     → when toggling false → true: no existing memberships changed
```

### 6.5 Extended getMe()

`auth.service.ts getMe()` now returns per-membership status and vet verification context:

```typescript
interface MembershipResponse {
  role: TenantRole;
  status: MembershipStatus; // NEW
  isOrderingVet: boolean; // NEW
  vetVerification?: {
    status: VetVerificationStatus;
    rejectionReason?: string | null;
  } | null;
  createdAt: string;
  tenant: { id; name; slug; email; phone; address; logoUrl; primaryColor };
}

// onboardingCompleted is preserved for backward compat but now derived from:
onboardingCompleted = activeMembership?.status === MembershipStatus.ACTIVE;
```

### 6.6 Order submission validation

New `SendOrderDto`:

```typescript
export class SendOrderDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional() // temporarily optional; falls back to Case.attendingVetId
  orderingVetId?: string;

  @IsEnum(OrderPriority)
  @IsOptional()
  priority?: OrderPriority;

  @IsEnum(DeliveryMethod)
  @IsOptional()
  deliveryMethod?: DeliveryMethod;

  @IsString()
  @IsOptional()
  orderNotes?: string;
}
```

`cases.service.ts` validation before calling `ordersService.createOrderForCase()`:

```typescript
async validateOrderingVet(
  orderingVetId: string,
  tenantId: string,
  labTenantId: string,
): Promise<{ profile: VeterinarianProfile; credential: VeterinarianCredential }> {

  // 1. Must be a member of this clinic with isOrderingVet = true
  const membership = await prisma.userTenantMembership.findUnique({
    where: { userId_tenantId: { userId: orderingVetId, tenantId } },
  });
  if (!membership) throw new BusinessError('ORDERING_VET_NOT_MEMBER');
  if (!membership.isOrderingVet) throw new BusinessError('ORDERING_VET_NOT_A_VET');

  // 2. Must have a VeterinarianProfile with an active credential
  const profile = await prisma.veterinarianProfile.findUnique({
    where: { userId: orderingVetId },
    include: { credentials: { where: { replacedAt: null } } },
  });
  if (!profile) throw new BusinessError('ORDERING_VET_NO_PROFILE');
  const credential = profile.credentials[0];
  if (!credential) throw new BusinessError('ORDERING_VET_NO_CREDENTIAL');

  // 3. License must not be expired
  if (credential.licenseExpiresAt && credential.licenseExpiresAt < new Date()) {
    throw new BusinessError('ORDERING_VET_LICENSE_EXPIRED');
  }

  // 4. If lab requires verification, check approval
  const labProfile = await prisma.laboratoryProfile.findUnique({ where: { tenantId: labTenantId } });
  if (labProfile?.vetVerificationRequired) {
    const verification = await prisma.vetLabVerification.findUnique({
      where: { vetProfileId_labTenantId: { vetProfileId: profile.id, labTenantId } },
    });
    if (verification?.status !== VetVerificationStatus.APPROVED) {
      throw new BusinessError('ORDERING_VET_NOT_APPROVED', {
        currentStatus: verification?.status ?? 'NOT_SUBMITTED',
      });
    }
  }

  return { profile, credential };
}
```

After validation, snapshot vet data into the Order within the same transaction:

```typescript
await tx.order.create({
  data: {
    // ... existing fields ...
    orderingVetId,
    orderingVetName: profile.legalName,
    orderingVetLicenseNumber: credential.licenseNumber,
    orderingVetIssuingAuthority: credential.issuingAuthority ?? null,
  },
});
```

**Fallback logic:** If `dto.orderingVetId` is omitted, fall back to `case.attendingVetId`. Require it in the new frontend. After all clients are updated and historical records addressed, remove the fallback and make `orderingVetId` required in the DTO.

### 6.7 Release snapshot extension

In `release.service.ts approveAndRelease()`, within the existing transaction:

```typescript
const vetSnapshot = order.orderingVetId
  ? {
      orderingVetId: order.orderingVetId,
      orderingVetName: order.orderingVetName,
      orderingVetLicenseNumber: order.orderingVetLicenseNumber,
      orderingVetIssuingAuthority: order.orderingVetIssuingAuthority,
    }
  : {};

await tx.resultReportRelease.create({
  data: {
    // ... existing snapshot fields (patient, clinic, lab, signer, etc.) ...
    ...vetSnapshot,
  },
});
```

The snapshot comes from the `Order` row (already frozen at submission time), not from the live `VeterinarianProfile`. Even if the vet updates their profile or the lab revokes their approval later, the release record reflects what was current and verified at submission time.

### 6.8 New clinic API endpoint

```
GET /api/tenants/:id/vets
    → TenantGuard (clinic)
    → returns UserTenantMembership where isOrderingVet = true
    → includes: userId, fullName, email, isOrderingVet, status,
      vetVerification.status (for this clinic's lab), vetVerification.rejectionReason
    → used by the ordering-vet dropdown in the case/order forms
```

---

## 7. Clinic and Vet UI Changes

### 7.1 Post-login routing (auth.service.ts)

`navigateAfterAuth()` switches on `memberships[0].status`:

```typescript
navigateAfterAuth(): void {
  const me = this.me();
  const activeMembership = me?.memberships?.[0];

  switch (activeMembership?.status) {
    case 'INVITED':
      return this.router.navigate(['/onboarding/welcome']);
    case 'PROFILE_REQUIRED':
      return this.router.navigate(['/onboarding/vet-profile']);
    case 'VERIFICATION_PENDING': {
      const vetStatus = activeMembership.vetVerification?.status;
      if (vetStatus === 'REJECTED') {
        return this.router.navigate(['/onboarding/verification-rejected']);
      }
      return this.router.navigate(['/onboarding/verification-pending']);
    }
    case 'ACTIVE':
      return this.router.navigate(['/dashboard']);
    case 'SUSPENDED':
      return this.router.navigate(['/suspended']);
    default:
      return this.router.navigate(['/onboarding/welcome']);
  }
}
```

`authGuard` enforces these routes: a vet with status `VERIFICATION_PENDING` who navigates directly to `/cases` is redirected to the pending screen.

### 7.2 New onboarding routes

Add to `onboarding.routes.ts`:

- `vet-profile` → `VetProfileComponent`
- `verification-pending` → `VerificationPendingComponent`
- `verification-rejected` → `VerificationRejectedComponent`

**`VetProfileComponent`:**

- Reactive form: `legalName`, `licenseNumber`, `issuingCountry`, `issuingAuthority` (optional), `licenseExpiresAt` (optional)
- Document upload using `LogoUploadComponent` pattern extended to accept PDF and images (validate MIME type and size server-side)
- Save profile (`POST /api/vet-profile`) then upload credential (`POST /api/vet-profile/credential`) then show "Submit for review" button
- "Submit for review" calls `POST /api/vet-verification/submit`
- All strings use translation keys

**`VerificationPendingComponent`:**

- Shows submission date and lab name (from `GET /api/vet-verification/status`)
- Polls every 30 seconds; on status change to APPROVED, calls `navigateAfterAuth()`
- "Something wrong? Contact the lab" copy with lab phone/email from tenant

**`VerificationRejectedComponent`:**

- Shows rejection reason
- "Update credentials" button → navigate to `vet-profile` with `?mode=edit`
- After updating and resubmitting, navigate to `verification-pending`

### 7.3 New case form (new-case.component.ts / .html)

Add `orderingVetId` `FormControl` to the reactive form:

- On init: call `GET /api/tenants/:id/vets` to load eligible vets
- If current user has `isOrderingVet = true`: preselect self (only if status is ACTIVE for the lab)
- Render using existing `app-select` component
- Options: active vets as normal options; PENDING/REJECTED vets as disabled options with status label
- Translation key for label: `cases.attendingVet.label`

### 7.4 Order form (order.component.ts / .html)

- Show attending vet selected on case (read-only display)
- Allow confirmation or change before submission if the vet selector is needed
- Pass `orderingVetId` in `SendOrderDto`
- Disable "Submit order" button if selected vet is not approved and lab requires verification; show inline message

### 7.5 Staff settings page (staff-settings.component.ts / .html)

Add `verificationStatus` column to the staff table:

- Shown only for members where `isOrderingVet = true`
- Status badge (Tailwind pill) with labels and colors:

| Status                 | Color   | Label            |
| ---------------------- | ------- | ---------------- |
| `PROFILE_REQUIRED`     | amber   | Profile required |
| `VERIFICATION_PENDING` | yellow  | Pending review   |
| `APPROVED`             | emerald | Approved         |
| `REJECTED`             | red     | Rejected         |
| `REVOKED`              | gray    | Revoked          |
| `EXPIRED`              | orange  | Expired          |

- No badge for members where `isOrderingVet = false`

---

## 8. Lab Portal UI Changes

### 8.1 New page: VetVerificationQueuePage.tsx

`apps/lab/src/app/pages/verifications/VetVerificationQueuePage.tsx`

Table columns:

- Vet name
- License number
- Issuing country / authority
- Requesting clinic
- Submission date
- `StatusBadge` (PENDING / APPROVED / REJECTED / REVOKED)
- Actions column

Filter bar: status tabs (All / Pending / Approved / Rejected / Revoked), date range, search by vet name.

"Review" per row → opens detail panel showing:

- All VeterinarianProfile + VeterinarianCredential fields
- Document viewer (fetch signed URL from `/api/lab/vet-verifications/:id/document`, embed PDF in iframe or download link)
- "Approve" button → `ConfirmDialog` variant `default` → calls `labApi.verifications.approve(id)`
- "Reject" button → `ConfirmDialog` variant `warning` with required `rejectionReason` textarea → calls `labApi.verifications.reject(id, reason)`
- Audit event list (SUBMITTED, RESUBMITTED, REJECTED, APPROVED, DOCUMENT_VIEWED)

### 8.2 Lab settings (LaboratorySettingsPage.tsx)

Add a toggle for `vetVerificationRequired` (ADMIN only):

- Label: "Require veterinarian verification before order submission"
- Description: "When enabled, vets must be reviewed and approved before they can place orders through connected clinics."
- Warning on toggle-on: "Vets already approved will remain active. New vets will require review."

### 8.3 Layout.tsx

Add "Verifications" nav item with a pending count badge. Badge polls `GET /api/lab/vet-verifications/count?status=PENDING` on the same interval as other counts (60s).

### 8.4 StatusBadge.tsx

Add new status mappings:

```typescript
PENDING: 'bg-yellow-400/15 text-yellow-300';
APPROVED: 'bg-emerald-400/15 text-emerald-300'; // already exists as green
REJECTED: 'bg-red-400/15 text-red-400';
REVOKED: 'bg-gray-400/15 text-gray-400';
EXPIRED: 'bg-orange-400/15 text-orange-300';
PROFILE_REQUIRED: 'bg-amber-400/15 text-amber-300';
VERIFICATION_PENDING: 'bg-yellow-400/15 text-yellow-300';
```

### 8.5 labApi.ts additions

```typescript
labApi.verifications = {
  list: (params?) => get('/api/lab/vet-verifications', params),
  getById: (id) => get(`/api/lab/vet-verifications/${id}`),
  getDocument: (id) => get(`/api/lab/vet-verifications/${id}/document`),
  approve: (id) => post(`/api/lab/vet-verifications/${id}/approve`, {}),
  reject: (id, rejectionReason) =>
    post(`/api/lab/vet-verifications/${id}/reject`, { rejectionReason }),
  revoke: (id, revokedReason) =>
    post(`/api/lab/vet-verifications/${id}/revoke`, { revokedReason }),
  getPendingCount: () => get('/api/lab/vet-verifications/count?status=PENDING'),
};
```

### 8.6 Order workspace / result entry / review pages

Add ordering vet display in the order header section of:

- `OrderWorkspacePage.tsx` — show `orderingVetName`, `orderingVetLicenseNumber` from order detail
- `ResultEntryPage.tsx` — show in order context header (read-only)
- `ReviewReleasePage.tsx` — show in the summary being approved

---

## 9. Notification Strategy

**v1: polling and badge count — no push notifications.**

| Location             | Mechanism              | Endpoint                                              |
| -------------------- | ---------------------- | ----------------------------------------------------- |
| Lab navigation badge | Polling (60s interval) | `GET /api/lab/vet-verifications/count?status=PENDING` |
| Vet pending screen   | Polling (30s interval) | `GET /api/vet-verification/status`                    |
| Clinic staff page    | On-demand refresh      | `GET /api/tenants/:id/staff`                          |

Push notifications (Web Push or email) are deferred to v2. The lab reviewer will see the badge on next visit. The vet will see the status update on their next poll cycle.

---

## 10. Report and PDF Changes

### Historical snapshot strategy

The snapshot chain guarantees historical accuracy:

1. **At order submission** (`POST /cases/:id/order`): validate vet, then snapshot `legalName`, `licenseNumber`, `issuingAuthority` from the active `VeterinarianCredential` into `Order`. This happens in the same transaction as order creation.

2. **At release** (`approveAndRelease()`): copy vet snapshot from `Order` into `ResultReportRelease`. Never read from live `VeterinarianProfile` at this point.

3. **At PDF generation** (when implemented): read from `ResultReportRelease` fields only. No live data access needed.

If the vet updates their profile or the lab revokes their approval after order submission, every released result from before that change still shows the credentials that were current and verified at submission time.

### PDF report content (when implemented)

The report template must include a "Requesting Veterinarian" section with:

- Professional name (`orderingVetName`)
- License / registration number (`orderingVetLicenseNumber`)
- Issuing authority (`orderingVetIssuingAuthority`, if present)
- Clinic name (already in snapshot as `clinicName`)

### Changing the ordering vet after submission

**Blocked entirely in v1.** `orderingVetId` is immutable once the order is created. If an administrative correction is genuinely needed in the future, it requires an explicit admin-only endpoint with a mandatory reason, stored as a `TimelineEvent`. Do not implement this correction workflow in v1.

### Result display locations

Add vet fields to API responses from:

- `GET /api/lab/orders/:id` — include `orderingVetName`, `orderingVetLicenseNumber`
- `GET /api/results/by-order/:orderId/released` — include from `ResultReportRelease` snapshot
- `GET /api/lab/orders/:orderId/releases` — include in `ReleaseInfo`
- `GET /api/lab/orders/:orderId/current-results` — include in header section

---

## 11. Security and Privacy

### Credential document storage

- Bucket: `vet-credentials` — **private, no public access**
- Path format: `vet-credentials/{userId}/{credentialId}.{ext}` — credential ID in path = immutable
- `upsert: false` on upload — Supabase Storage will error rather than silently overwrite
- The backend stores `documentKey` (storage path), never a public URL
- The API generates short-lived signed URLs (3600s TTL) server-side only
- Signed URLs are generated fresh on each document view — never cached in the frontend

### Access control for documents

| Requester                  | Can access              | How                                                                                |
| -------------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| The vet themselves         | Own current credential  | `GET /api/vet-profile/credential/document`                                         |
| Lab ADMIN/OWNER/TECHNICIAN | Credential under review | `GET /api/lab/vet-verifications/:id/document` — only if active verification exists |
| Clinic admin               | No document access      | Not authorized to generate signed URLs for vet credentials                         |
| Other vets                 | No                      | Not authorized                                                                     |

Every signed URL generation writes a `DOCUMENT_VIEWED` `VetVerificationEvent` with `actorId`, `credentialVersionId`, and `clinicTenantId` if applicable.

### Duplicate license detection

`@@index([licenseNumber])` on `VeterinarianCredential` enables a query for profiles sharing a license number. When a lab admin opens a verification request, the API queries for other credentials with the same `licenseNumber` and includes a non-blocking warning in the response: `duplicateLicenseDetected: boolean`. Surface this warning visually in the detail panel.

**Do not auto-merge. Do not block.** The duplicate is flagged for human review. The lab admin escalates to the platform if needed. Resolution is manual.

### JWT and authorization

No vet profile data flows through the JWT — consistent with the existing pattern where roles come from the DB. The `vetVerification` context in `getMe()` is computed fresh from the DB on every authenticated request.

---

## 12. Edge Cases and Race Conditions

### Concurrent submissions (two clinics, same vet, same lab)

The `@@unique([vetProfileId, labTenantId])` constraint prevents two rows. The service uses `upsert` or `findOrCreate` with proper conflict handling. The second clinic's call finds the existing PENDING record and returns it. Both clinics benefit from the single approval.

### Concurrent approve + reject by two lab admins

Use a transaction with a status check inside: `WHERE status = PENDING`. If the record has already been updated, the second operation returns a 409. No double-update is possible.

### Vet removed from clinic while verification is pending

`DELETE /tenants/:id/staff/:userId` removes `UserTenantMembership`. `VeterinarianProfile` and `VetLabVerification` are untouched — they belong to the vet, not the clinic. If the vet is re-invited later, the existing profile and verification status apply immediately.

### Credential replaced after approval

Service resets `VetLabVerification.status` to PENDING, writes RESUBMITTED event, updates membership status to VERIFICATION_PENDING. The lab sees the vet back in their queue. The vet cannot place orders until re-approved. The old released results are unaffected (their snapshots are frozen).

### Rejected vet invited by another clinic using the same lab

The existing `VetLabVerification` row has status REJECTED. The second clinic sees the REJECTED status. The vet can update their profile and resubmit. The existing row is updated to PENDING on resubmission (one row per vet × lab, updated in place). Both clinics benefit when the lab approves.

### Multiple labs per clinic (future)

Currently MVP: one lab per clinic. When multi-lab support arrives, the `orderingVetId` validation checks the specific lab receiving the order (from `Case.selectedCatalogItems → CatalogItem.labTenantId`), not all connected labs. A vet approved by Lab A can order tests from Lab A even if they're still pending for Lab B.

### Admin who is also a vet but not approved

The admin can perform all administrative work — their `role = ADMIN` permission is unaffected. They cannot be selected as the ordering vet in the dropdown and the backend rejects `orderingVetId = self` if `isOrderingVet = true` but `VetLabVerification.status != APPROVED`. Administrative access and professional authorization are independent.

### License expiry

Checked at order submission time: if `credential.licenseExpiresAt < now()`, the order is rejected with `ORDERING_VET_LICENSE_EXPIRED`. No cron in v1 — expiry is only enforced at the point where it matters.

### Race condition: approval revoked between validation and order creation

The vet validation and order creation happen in the same transaction. Inside the transaction, `SELECT ... FOR UPDATE` on `VetLabVerification` prevents concurrent status changes. If the revocation transaction commits first, the order transaction reads the revoked status and throws `ORDERING_VET_NOT_APPROVED`. If the order transaction commits first, the revocation applies from that point forward and does not invalidate the already-submitted order.

---

## 13. Phased Implementation Plan

### Phase 1 — Data layer

**Goal:** All schema changes land. Nothing breaks. No user-facing change.

- Prisma migrations A through F (see Section 5)
- Backfill: `isOrderingVet = true` for existing VET memberships; `status = ACTIVE` for all existing memberships
- Supabase: create private `vet-credentials` bucket (manual)
- Shared-types: add `VeterinarianProfileModel`, `VeterinarianCredentialModel`, `VetLabVerificationModel`, `VetVerificationEventModel`, `VetVerificationStatus`, `VetVerificationEventType`, `MembershipStatus`; update `TenantContext` and membership response types
- Seed: add `vetVerificationRequired: false` to `seed-lab-tenant.mjs`

**Tests:**

- Migration rollback (`prisma migrate reset`) runs cleanly
- Existing seed completes without errors
- All existing `npx nx test api` and `npx nx test frontend` pass unchanged
- `POST /cases/:id/order` still works with all new fields null (nullable columns)
- Backfill verification: `SELECT COUNT(*) FROM user_tenant_memberships WHERE role = 'VET' AND is_ordering_vet = false` = 0

---

### Phase 2 — VeterinarianProfile and VeterinarianCredential API

**Goal:** Vets can create and manage their professional profile and upload credential documents.

- `VetProfileModule` with all endpoints in Section 6.2
- `StorageService` two new methods: `uploadPrivate(key, buffer, contentType)` with `upsert: false`; `getSignedUrl(key, expiresIn)`
- `VetVerificationEvent` writes for DOCUMENT_VIEWED
- Cross-domain call: credential upload resets APPROVED verifications → written in a transaction with the credential creation

**Tests:**

- `GET /api/vet-profile` returns 404 when no profile exists
- `POST /api/vet-profile` creates profile; second POST returns 409
- `POST /api/vet-profile/credential` creates credential; stamps previous `replacedAt`
- When APPROVED verification exists: credential upload resets it to PENDING, writes RESUBMITTED event, sets membership VERIFICATION_PENDING
- When no approved verification: credential upload does not touch verifications
- `GET /api/vet-profile/credential/document` returns signed URL for the vet; returns 403 for a different user
- Signed URL endpoint writes DOCUMENT_VIEWED event
- Storage mock: `upsert: false` is passed; path includes credentialId

---

### Phase 3 — Verification workflow and membership status API

**Goal:** Complete backend for submitting, reviewing, and tracking verification. `getMe()` returns per-membership status.

- `VetVerificationModule` with clinic-facing endpoints (Section 6.3)
- `LabVetVerificationService` + lab controller additions (Section 6.4)
- Extend `auth.service.ts getMe()` with per-membership `status`, `isOrderingVet`, `vetVerification`
- `onboardingCompleted` derived from `activeMembership.status === ACTIVE`
- Lab settings: extend `UpsertLaboratoryProfileDto` with `vetVerificationRequired`; implement toggle sweep (Section 6.4)
- Duplicate license warning in `GET /api/lab/vet-verifications/:id` response

**Tests:**

- `POST /api/vet-verification/submit` when lab does not require verification → `{ required: false }`, no record
- When lab requires and no verification exists → creates PENDING record, writes SUBMITTED event
- Idempotent: called again with PENDING → returns existing
- Called with REJECTED → updates to PENDING, writes RESUBMITTED
- No profile → 422 `ORDERING_VET_NO_PROFILE`
- Expired license → 422 `ORDERING_VET_LICENSE_EXPIRED`
- Membership status: PROFILE_REQUIRED → VERIFICATION_PENDING on submit
- `POST /approve` when PENDING → APPROVED, membership ACTIVE for all connected clinics
- `POST /approve` when already APPROVED → 409
- `POST /reject` without reason → 422
- `POST /reject` with reason → REJECTED, membership stays VERIFICATION_PENDING
- `POST /revoke` → REVOKED, membership → VERIFICATION_PENDING
- `GET .../document` writes DOCUMENT_VIEWED; TECHNICIAN can access; clinic member cannot
- Concurrent approve + reject → one 409
- `getMe()` returns correct per-membership status and vetVerification for VET member
- `getMe()` for non-ordering-vet member → vetVerification null, status ACTIVE
- `onboardingCompleted` true iff `membership.status === ACTIVE`
- Toggle `vetVerificationRequired` false → true: no existing memberships changed
- Toggle `vetVerificationRequired` true → false: VERIFICATION_PENDING memberships → ACTIVE

---

### Phase 4 — Order submission validation

**Goal:** Backend enforces ordering vet eligibility at order creation.

- Extend `SendOrderDto` with optional `orderingVetId` (fallback to `Case.attendingVetId`)
- Add `attendingVetId` to `CreateCaseDto`; store in `Case` on creation
- Implement `validateOrderingVet()` in `cases.service.ts`
- Snapshot vet data into `Order` within the order creation transaction
- Structured error codes: `ORDERING_VET_NOT_MEMBER`, `ORDERING_VET_NOT_A_VET`, `ORDERING_VET_NO_PROFILE`, `ORDERING_VET_NO_CREDENTIAL`, `ORDERING_VET_NOT_APPROVED`, `ORDERING_VET_LICENSE_EXPIRED`

**Tests:**

- All error code paths tested
- Receptionist can submit with an approved vet's ID
- Receptionist cannot use their own ID as vet (isOrderingVet = false)
- Admin with `isOrderingVet = true` and APPROVED verification can be ordering vet
- Admin with `isOrderingVet = false` cannot be ordering vet even with a profile
- Snapshot fields populated correctly on Order
- Fallback: null `orderingVetId` in DTO falls back to `Case.attendingVetId`
- Existing orders with null `orderingVetId` load correctly (backward compat)

---

### Phase 5 — Release snapshot extension

**Goal:** Released results include ordering vet identity.

- Extend `release.service.ts approveAndRelease()` to copy vet snapshot from Order into ResultReportRelease
- Update `ResultReportRelease` response DTO to include vet fields
- Include vet fields in release history and current-results responses

**Tests:**

- Snapshot populated when order has vet
- Null-safe when order has no vet (backward compat — existing releases load correctly)
- Amendment releases also carry the original vet snapshot

---

### Phase 6 — Clinic frontend — vet onboarding screens

**Goal:** Vets who are PROFILE_REQUIRED or VERIFICATION_PENDING are routed to appropriate screens.

- New Angular routes: `vet-profile`, `verification-pending`, `verification-rejected` in `onboarding.routes.ts`
- `VetProfileComponent`: reactive form + document upload + submit flow
- `VerificationPendingComponent`: polling status display
- `VerificationRejectedComponent`: rejection reason + correction + resubmit
- Extend `navigateAfterAuth()` to switch on `memberships[0].status`
- Extend `authGuard` to block PROFILE_REQUIRED and VERIFICATION_PENDING from protected routes
- Translations: all new keys in `en.json` + `es.json`

**Tests:**

- Guard unit tests: PROFILE_REQUIRED → redirects to vet-profile; VERIFICATION_PENDING → pending screen; ACTIVE → dashboard
- VerificationPendingComponent polls and navigates on APPROVED
- VerificationRejectedComponent shows rejection reason; resubmit navigates to pending

---

### Phase 7 — Clinic frontend — case and order forms

**Goal:** Ordering vet is selectable and required in the new case and order flows.

- Add ordering-vet `app-select` to `new-case.component.ts`
- Load eligible vets from `GET /api/tenants/:id/vets`
- Preselect self if current user has `isOrderingVet = true` and is ACTIVE
- Show PENDING/REJECTED vets as disabled options with status label
- Pass `attendingVetId` in case creation; pass `orderingVetId` in order submission
- Disable submit if no eligible vet available; show informative message
- Translations

**Tests:**

- Preselection logic (vet user → self preselected; receptionist → no preselection)
- Disabled options render with correct status label
- Form validation: requires vet selection before order submission (frontend)
- Backend validation still fires (integration test)

---

### Phase 8 — Clinic frontend — staff page status

**Goal:** Clinic staff can see verification status for ordering vets.

- Add `verificationStatus` to staff member display type
- Status badge component (Tailwind pill)
- Filter by verification status
- Translations

---

### Phase 9 — Lab portal — verification queue

**Goal:** Lab staff can review, approve, and reject vet verification requests.

- `VetVerificationQueuePage.tsx` with filters, table, detail panel, approve/reject via ConfirmDialog
- Document viewer (signed URL, PDF embed or download)
- `labApi.verifications.*` API methods
- `vetVerificationRequired` toggle in lab settings
- Navigation entry in `Layout.tsx` with pending count badge (polling)
- Extend `StatusBadge.tsx` with new status mappings
- Translations

---

### Phase 10 — Result and order display

**Goal:** Ordering vet is visible everywhere results are shown.

- Include vet fields in order detail, released result, release history, and current-results responses
- Update order workspace, result entry, and review pages in lab portal to show ordering vet
- Update clinic results view
- Translations
- PDF template: add "Requesting Veterinarian" section (when PDF generation is implemented)

---

### Phase 11 — Edge case hardening

- License expiry check at order submission (already in Phase 4 validation; confirm all paths covered)
- `profileChangedAfterApproval` flag: set when credential is replaced after approval; surface as a warning badge in lab verification queue
- Duplicate license number warning in lab review detail
- `DOCUMENT_VIEWED` audit trail review: confirm all code paths write the event
- Revocation end-to-end test: revoke → vet cannot submit new orders → vet sees VERIFICATION_PENDING → vet can update and resubmit
- Load test: verification queue with 1,000+ PENDING records, confirm pagination and counts perform correctly

---

## 14. Complexity and Risk

| Area                                  | Complexity | Risk   | Reason                                                                                                                                                                                               |
| ------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access gate for pending vets          | Medium     | High   | Extending `authGuard` and `navigateAfterAuth()` affects every user's login flow; a bug blocks all clinic users                                                                                       |
| Private credential document storage   | Low-Medium | High   | If signed URL generation leaks a public URL or the bucket is misconfigured, PII is exposed                                                                                                           |
| Order submission validation           | Medium     | High   | `POST /cases/:id/order` is used by every case; adding `orderingVetId` is a behavior change that must coordinate frontend and backend deployment                                                      |
| Snapshot consistency                  | Low        | Medium | Vet snapshot in Order must be written in the same transaction as order creation. Use `SELECT FOR UPDATE` on `VetLabVerification` inside the transaction to prevent revocation racing with the write. |
| VetLabVerification state machine      | Medium     | Medium | Status transitions must be one-directional and audited; concurrent approvals/rejections need optimistic locking                                                                                      |
| Per-membership status in getMe()      | Medium     | Medium | Changing `onboardingCompleted` semantics affects every frontend routing path; must be backward compatible                                                                                            |
| Multi-clinic/multi-lab vet UX         | High       | Medium | When a vet is approved for Lab A but pending for Lab B, the frontend must show the correct per-clinic state                                                                                          |
| VeterinarianProfile + Credential CRUD | Low        | Low    | Straightforward, analogous to existing settings patterns (LabSigner)                                                                                                                                 |
| Lab verification queue UI             | Medium     | Low    | Lab portal has established patterns; mostly following OrdersQueuePage shape                                                                                                                          |

**Most likely to block a phase:**

1. The `orderingVetId` field in `SendOrderDto` is a behavior change — frontend and backend must deploy together, or the field must remain optional with fallback for a defined transition window.
2. The `authGuard` extension must not break non-vet users or the admin flow when `isOrderingVet = false`.

---

## 15. Confirmed Product Decisions

| Decision                                  | Resolved                                                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin who is also a vet                   | Allowed via `isOrderingVet = true` on the membership. Role stays ADMIN; professional identity is separate.                                              |
| Admin with isOrderingVet but not approved | Can do admin work. Cannot be selected as ordering vet until approved.                                                                                   |
| License expiration enforcement            | Validate at order submission in v1. No cron sweep.                                                                                                      |
| Credential change after approval          | New credential automatically returns approval to PENDING. Vet re-enters verification queue.                                                             |
| Rejected vet resubmission                 | Reuse existing VetLabVerification row (update to PENDING). Write RESUBMITTED event for audit trail.                                                     |
| Multiple labs                             | Require approval only from the lab receiving that specific order. Not all connected labs.                                                               |
| Verification submission trigger           | Explicit "Submit for review" button. Triggered after profile + credential are complete.                                                                 |
| Pending vet and case creation             | Allow draft cases. Block order submission only.                                                                                                         |
| Lab reviewers                             | OWNER and ADMIN.                                                                                                                                        |
| Pending/rejected vets in dropdown         | Show as disabled options with status label. Not hidden.                                                                                                 |
| Notifications in v1                       | Queue badge and polling only. No push notifications.                                                                                                    |
| Existing labs default                     | `vetVerificationRequired = false`. Not retroactively blocked.                                                                                           |
| Existing orders and vets                  | All historical vet fields nullable. No backfill of vet data on old orders. Existing vets get `status = ACTIVE` and `isOrderingVet = true` on migration. |
| Duplicate license numbers                 | Flag as a warning to lab reviewers. Never auto-merge accounts. Escalate to platform for investigation.                                                  |
| Changing ordering vet post-submission     | Blocked in v1. Future admin correction requires explicit endpoint with mandatory reason and audit event.                                                |

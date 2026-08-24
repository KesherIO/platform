# KesherIO Laboratory Sample-Processing and Result-Entry Workflow — Final Design (v3.2)

**Date:** 2026-08-11
**Status:** Approved implementation source of truth
**v3.2 amendments:** Adds operational-readiness gating, grouped specimen requirements, explicit missing-specimen handling, lossless original-order-line provenance, and server-authoritative formula evaluation.

---

## 1. Updated Domain Model

### 1.1 New Enums

```
Department (fixed enum):
  HEMATOLOGY | CHEMISTRY | URINALYSIS | PARASITOLOGY
  SEROLOGY | ENDOCRINOLOGY | MICROBIOLOGY | OTHER

ProcessingMethod (how the test was physically performed):
  MANUAL | ANALYZER

ResultEntrySource (how values entered KesherIO):
  MANUAL_ENTRY | FILE_IMPORT | DIRECT_INTEGRATION

TemplateScope (who owns the template):
  PLATFORM | LABORATORY

TemplateStatus (template lifecycle):
  DRAFT | PUBLISHED | ARCHIVED

SpecimenStatus:
  EXPECTED | MISSING | RECEIVED | ACCEPTED | REJECTED

OrderedTestStatus (extended 8-state):
  PENDING → READY → IN_PROGRESS → RESULTS_ENTERED → IN_REVIEW → COMPLETED
  PENDING → BLOCKED (specimen issue) → READY (resolved)
  Any → CANCELLED

BlockReason:
  MISSING_SPECIMEN | REJECTED_SPECIMEN | INSUFFICIENT_VOLUME
  ANALYZER_UNAVAILABLE | REAGENT_UNAVAILABLE | REQUIRES_RECOLLECTION
  MISSING_RESULT_TEMPLATE | OTHER

OrderedTestSourceType (NEW):
  DIRECT    — test ordered as a standalone line item
  PACKAGE   — test derived from a package expansion

ResultReportStatus (extended):
  DRAFT | IN_REVIEW | RELEASED
```

### 1.2 New and Modified Entities

```
LabTestConfiguration (NEW — lab-specific operational config per test)
  ├── id, labTenantId, catalogItemId
  ├── department: Department
  ├── defaultProcessingMethod: ProcessingMethod
  ├── allowedProcessingMethods: ProcessingMethod[]
  ├── defaultAnalyzerId → Analyzer?
  ├── unique: [labTenantId, catalogItemId]
  └── specimens: LabTestSpecimenRequirement[] (1:N)

LabTestSpecimenRequirement (NEW — separate from LabTestConfiguration)
  ├── id, labTestConfigurationId
  ├── specimenType (e.g., "EDTA_BLOOD", "SERUM", "URINE")
  ├── containerType (e.g., "EDTA_TUBE", "SST_TUBE")
  ├── minimumVolumeMl: Float?
  ├── requirementGroupKey: String        (every group must be satisfied)
  ├── specimenRole: String?              (PRIMARY, PATIENT, DONOR, OTHER)
  ├── isAlternativeWithinGroup: Boolean (one accepted option satisfies its group)
  ├── notes: String?
  └── sortOrder: Int

Analyzer (NEW)
  ├── id, labTenantId
  ├── name, model, manufacturer
  ├── department: Department
  ├── connectionType: NONE (MVP)
  ├── isActive: Boolean
  └── unique: [labTenantId, name]

Specimen (NEW — first-class physical sample)
  ├── id, orderId, labTenantId
  ├── accessionNumber (auto-generated, unique per lab: SPEC-2026-000001)
  ├── specimenType, containerType
  ├── tubeIndex: Int @default(1)  ← supports multiple tubes of same type
  ├── status: SpecimenStatus (EXPECTED → RECEIVED → ACCEPTED | REJECTED)
  │
  │   Condition flags (boolean, multiple can be true simultaneously):
  ├── isHemolyzed: Boolean @default(false)
  ├── isLipemic: Boolean @default(false)
  ├── isIcteric: Boolean @default(false)
  ├── isInsufficient: Boolean @default(false)
  ├── isContaminated: Boolean @default(false)
  ├── isWrongContainer: Boolean @default(false)
  ├── isLeaking: Boolean @default(false)
  │
  ├── receivedAt, receivedById
  ├── markedMissingAt, markedMissingById
  ├── rejectionReason, notes
  └── linked to OrderedTests via OrderedTestSpecimen (M:N)

OrderedTestSpecimen (NEW — M:N link table)
  ├── orderedTestId
  └── specimenId

OrderedTest (EXTENDED — existing entity gains new fields)
  ├── sources: OrderedTestSource[] (1:N) ← replaces sourcePackageId
  ├── department: Department? (snapshotted from LabTestConfiguration)
  ├── status: OrderedTestStatus (8-state, replaces current 4-state)
  ├── processingMethod: ProcessingMethod?
  ├── resultEntrySource: ResultEntrySource?
  ├── analyzerId: String? → Analyzer
  ├── claimedAt: DateTime?
  ├── blockReason: BlockReason?
  ├── blockReasonDetail: String?
  ├── version: Int @default(1) (optimistic locking)
  └── entryMethod field RETIRED (replaced by processingMethod + resultEntrySource)

OrderedTestSource (NEW — preserves all ordering/billing origins)
  ├── id
  ├── orderedTestId → OrderedTest
  ├── originCatalogItemId → CatalogItem  (the ordered line item: test or package)
  ├── sourceType: OrderedTestSourceType (DIRECT | PACKAGE)
  ├── originalOrderItemKey: String        (immutable ID of the original orderedItems line)
  ├── originalOrderItemIndex: Int         (snapshot position for migration/debugging)
  ├── quantity: Int @default(1)
  ├── originCode: String?               (snapshot of catalog item code at order time)
  ├── originName: String                (snapshot of catalog item name at order time)
  └── @@unique([orderedTestId, originalOrderItemKey, originCatalogItemId])

  Example: clinic orders "Perfil Básico" (ALB, GLU, CREA, ALT) + standalone "CREA":
    ot_alb  ← PACKAGE origin (Perfil Básico)
    ot_glu  ← PACKAGE origin (Perfil Básico)
    ot_crea ← PACKAGE origin (Perfil Básico) + DIRECT origin (Creatinina)
    ot_alt  ← PACKAGE origin (Perfil Básico)
  CREA has two source rows — deduplicated test, both origins preserved for billing.

ResultTemplateDefinition (NEW — replaces ResultTemplate identity)
  ├── id
  ├── catalogItemCode: String         ← stable platform test code, NOT a CatalogItem FK
  ├── species: PatientSpecies
  ├── ageMinWeeks: Int @default(-1)   ← sentinel: -1 = no lower bound (avoids NULL in unique)
  ├── ageMaxWeeks: Int @default(-1)   ← sentinel: -1 = no upper bound
  ├── scope: TemplateScope (PLATFORM | LABORATORY)
  ├── labTenantId: String? → Tenant   (null for PLATFORM)
  ├── ownerKey: String                ← non-nullable: "platform" for PLATFORM, labTenantId for LABORATORY
  ├── parentDefinitionId: String? → ResultTemplateDefinition
  ├── activeVersionId: String? @unique → ResultTemplateVersion  (one active PUBLISHED version)
  ├── versions: ResultTemplateVersion[] (1:N)
  └── @@unique([catalogItemCode, species, ageMinWeeks, ageMaxWeeks, ownerKey])
      No NULLs in the constraint. ownerKey discriminates PLATFORM from each lab.
      Sentinels on ageMinWeeks/ageMaxWeeks eliminate NULL-uniqueness problems.

ResultTemplateVersion (NEW — immutable content snapshot per version number)
  ├── id
  ├── definitionId → ResultTemplateDefinition
  ├── version: Int                    (auto-increment per definition: 1, 2, 3…)
  ├── title: String
  ├── status: TemplateStatus (DRAFT | PUBLISHED | ARCHIVED)
  ├── defaultObservations: String?
  ├── publishedAt: DateTime?
  ├── createdAt: DateTime
  ├── sections: ResultTemplateSection[] (moved from old ResultTemplate)
  ├── analytes: ResultTemplateAnalyte[] (moved from old ResultTemplate)
  └── @@unique([definitionId, version])

  Invariants:
  - A definition has at most ONE version with status=PUBLISHED, pointed to by activeVersionId.
  - Publishing atomically: old PUBLISHED → ARCHIVED, new DRAFT → PUBLISHED, update activeVersionId.
  - PUBLISHED and ARCHIVED versions are immutable — no field changes allowed.
  - Sections and analytes belong to ResultTemplateVersion, not ResultTemplateDefinition.

ResultReportTest (NEW — per-test template provenance within a report)
  ├── id
  ├── reportId → ResultReport
  ├── orderedTestId → OrderedTest
  ├── templateVersionId → ResultTemplateVersion (exact immutable version used)
  ├── templateDefinitionId → ResultTemplateDefinition (convenience for lookup)
  ├── analytes: ResultReportAnalyte[] (1:N)
  └── @@unique([reportId, orderedTestId])

ResultReport (EXTENDED — gains review fields, loses single template provenance)
  ├── status: ResultReportStatus (DRAFT → IN_REVIEW → RELEASED)
  ├── tests: ResultReportTest[] (1:N) ← replaces templateId + templateVersionSnapshot
  ├── reviewedById, reviewedAt, reviewNotes: String?
  └── correctionNotes: String? (when returned from IN_REVIEW to DRAFT)

ResultReportAnalyte (MODIFIED — reparented under ResultReportTest)
  ├── reportTestId → ResultReportTest  ← REPLACES reportId + orderedTestId
  ├── templateAnalyteId → ResultTemplateAnalyte? (unchanged)
  ├── ...snapshot fields (code, name, technique, unit, valueType, etc.) — unchanged
  ├── ...value fields (numericValue, textValue, booleanValue, selectValue) — unchanged
  ├── ...flag, referenceSnapshot — unchanged
```

### 1.3 Unchanged Entities

| Entity                   | Status                                                                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CatalogItem`            | **Unchanged.** No new fields. Remains the orderable catalog definition. Lab-specific configuration is in `LabTestConfiguration`.                                                       |
| `Order`                  | Mostly unchanged. `sampleType`/`sampleNotes` remain for backward compatibility but become secondary to the new `Specimen` records. Order status becomes **derived** (see section 1.4). |
| `CatalogItemComposition` | **Unchanged.** Package → component TEST mapping.                                                                                                                                       |
| `LaboratoryProfile`      | **Unchanged.**                                                                                                                                                                         |
| `LabSigner`              | **Unchanged.** REVIEWER role used for review/release authorization.                                                                                                                    |
| `Pickup`                 | **Unchanged.**                                                                                                                                                                         |
| `TimelineEvent`          | Gains new event types (see section 10).                                                                                                                                                |

### 1.3.1 Replaced / Reparented Entities

| Entity                  | Status                                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `ResultTemplate`        | **Replaced** by `ResultTemplateDefinition` + `ResultTemplateVersion`. Old table migrated and dropped.                        |
| `ResultTemplateSection` | **Reparented.** FK moves from `templateId` to `versionId` (→ `ResultTemplateVersion`).                                       |
| `ResultTemplateAnalyte` | **Reparented.** FK moves from `templateId` to `versionId`.                                                                   |
| `ResultReport`          | **Modified.** `templateId` removed. Gains `tests: ResultReportTest[]`.                                                       |
| `ResultReportAnalyte`   | **Modified.** `reportId` and `orderedTestId` replaced by `reportTestId → ResultReportTest`. Snapshotting behavior unchanged. |

### 1.4 Order Status Derivation Rules

Order status is **derived** from the aggregate state of its ordered tests and specimens. Only cancellation and exceptional administrative actions change it directly.

| Rule | Derived Order Status | Condition                                                                                                                                                                                                        |
| ---- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `PENDING`            | No specimens with status ACCEPTED exist                                                                                                                                                                          |
| 2    | `RECEIVED_BY_LAB`    | Reception is complete: every required specimen group is satisfied by an ACCEPTED specimen or explicitly resolved as MISSING/REJECTED, affected tests are READY or BLOCKED, and no test has progressed past READY |
| 3    | `PROCESSING`         | Any test is IN_PROGRESS, RESULTS_ENTERED, or IN_REVIEW                                                                                                                                                           |
| 4    | `COMPLETED`          | ResultReport status = RELEASED                                                                                                                                                                                   |
| 5    | `CANCELLED`          | Explicitly cancelled (direct status change, not derived)                                                                                                                                                         |

**Important distinctions:**

- "Any test READY" alone does NOT move order to `RECEIVED_BY_LAB` — partial reception (some specimens accepted, others still EXPECTED) keeps the order in an intermediate state visible to reception staff but the order status stays `PENDING` until all expected specimens are resolved.
- A single test moving to `IN_PROGRESS` is sufficient to derive `PROCESSING` — the order does not wait for all tests.
- `COMPLETED` requires report release, not just all tests being individually COMPLETED.
- When the derivation function runs, it evaluates rules in order 5→4→3→2→1 (most terminal state wins).

**Implementation:** A private `deriveOrderStatus()` function runs after any operation that changes test or specimen status. It reads all tests and specimens for the order, applies the rules above, and updates the order status if changed. Wrapped in the same transaction as the triggering operation.

### 1.5 Extensibility (unchanged from v2)

**ProcessingAttempt (future):** OrderedTest gains a `processingAttempts` relation. The single-pass MVP flow is equivalent to one attempt. The current `processingMethod`, `resultEntrySource`, and `analyzerId` fields on OrderedTest become "current/final" summaries. No field changes meaning when the extension is added.

**AnalyzerRun (future):** Groups multiple ProcessingAttempts across orders into one analyzer batch session. OrderedTest is unaware of batching.

---

## 2. Template Ownership, Selection, and Versioning

### 2.1 Platform Template → Lab Catalog Item Mapping

**Problem:** CatalogItem is tenant-specific (`labTenantId` FK, unique `[labTenantId, code]`). A PLATFORM template cannot hold a `catalogItemId` FK because each lab has its own CatalogItem rows with distinct IDs.

**Solution:** `ResultTemplateDefinition.catalogItemCode` is a plain string — a stable platform-level test identity (e.g., `"CBC"`, `"ALB"`, `"T4"`), not a foreign key. This code is a shared convention across the platform:

- The 170 existing seed templates already use consistent codes (`cbc-dog-adult.json` → `catalogItemCode: "CBC"`).
- Labs create CatalogItems with codes. As long as a lab's CatalogItem.code matches the definition's `catalogItemCode`, the template is found.
- If a lab uses a non-standard code (e.g., `"HEM"` instead of `"CBC"`), the PLATFORM template won't match. The lab must either rename their code or create a LABORATORY template with `catalogItemCode = "HEM"`.
- No explicit mapping table is needed for MVP. If code divergence becomes common, a `PlatformCodeMapping(labTenantId, platformCode, localCode)` table can be added later without schema changes to the template model.

### 2.2 Two Ownership Scopes

| Scope        | `ownerKey` value     | `labTenantId`   | Managed by                                               |
| ------------ | -------------------- | --------------- | -------------------------------------------------------- |
| `PLATFORM`   | `"platform"`         | `null`          | InternalApiKeyGuard (existing `POST /results/templates`) |
| `LABORATORY` | `<labTenantId cuid>` | `<labTenantId>` | Lab ADMIN/OWNER via lab frontend                         |

`ownerKey` is a non-nullable derived field set at creation time. It exists solely to make the unique constraint NULL-safe. Application logic sets it automatically — it is never user-facing.

**Key principle:** A `LABORATORY` template does not modify the `PLATFORM` original. It is a **separate definition** that optionally points to the original via `parentDefinitionId`. The platform template remains available and unchanged.

### 2.3 Template Lifecycle (DRAFT → PUBLISHED → ARCHIVED)

Lifecycle is on `ResultTemplateVersion`, not the definition:

```
Definition (identity — long-lived)
  └── Version 1: ARCHIVED  (was published, then superseded)
  └── Version 2: ARCHIVED  (was published, then superseded)
  └── Version 3: PUBLISHED (current active — pointed to by activeVersionId)
  └── Version 4: DRAFT     (work in progress — not yet available for reports)
```

- **DRAFT:** Editable. Not available for report creation. Only one DRAFT per definition at a time (enforced at application level).
- **PUBLISHED:** Immutable. Used for report creation. Exactly one per definition, pointed to by `activeVersionId`.
- **ARCHIVED:** Immutable. Preserved for audit. Released reports that used this version remain valid — their `ResultReportTest.templateVersionId` still points to the archived version.

**Publishing rules:**

1. Only a DRAFT version can be published.
2. Publishing atomically: DRAFT → PUBLISHED, old PUBLISHED → ARCHIVED, update `activeVersionId`.
3. To edit a published template: clone it into a new DRAFT (version N+1), edit, publish.
4. `activeVersionId = null` means no published version exists — the definition has only drafts/archives.

**PLATFORM templates:** All 170 existing seed templates are migrated to `scope=PLATFORM, ownerKey="platform"` definitions with one PUBLISHED version each. The `importTemplate()` endpoint continues to work for PLATFORM templates — it creates or finds a definition, then creates a new version (archiving the old PUBLISHED one).

### 2.4 Unique Constraint Design (NULL-safe)

On `ResultTemplateDefinition`:

```
@@unique([catalogItemCode, species, ageMinWeeks, ageMaxWeeks, ownerKey])
```

- **No NULLs in the constraint.** `ownerKey` is always set (`"platform"` or `<labTenantId>`). Age sentinels use `-1` instead of NULL.
- This allows: one PLATFORM definition for CBC + DOG + adult AND one LABORATORY definition per lab for the same combination.

On `ResultTemplateVersion`:

```
@@unique([definitionId, version])
```

- Each version number is unique within its definition. Version numbers are immutable after creation.

### 2.5 Template Selection at Report Creation

When creating `ResultReportTest` rows during accessioning/report creation:

```
For each OrderedTest:
  1. Get catalogItem.code from the test's CatalogItem
  2. Find all ResultTemplateDefinition where:
     - catalogItemCode = item.code
     - species matches (exact or ANY)
     - age range matches (using sentinel -1 = no bound)
     - activeVersionId IS NOT NULL (has a published version)
  3. Score candidates (same logic as v2/v3):
     - species-specific + age-specific = 3
     - species-specific + age-agnostic = 2 (or age-specific + ANY = 2)
     - ANY + age-agnostic = 0
  4. Among equal scores, prefer ownerKey = labTenantId over ownerKey = 'platform'
  5. Winner: load its activeVersion → create ResultReportTest + analyte slots
  6. NO WINNER: test → BLOCKED with MISSING_RESULT_TEMPLATE (see section 8.2)
```

Only definitions with `activeVersionId IS NOT NULL` are considered. DRAFT-only definitions are invisible to report creation.

### 2.6 Lab Template Customization Workflow

1. Lab admin navigates to Template Management (new section).
2. Sees a list of all templates available: PLATFORM definitions (read-only) and any LABORATORY definitions they've created.
3. To customize a PLATFORM template: "Customize for our lab" → creates a new LABORATORY `ResultTemplateDefinition` with `parentDefinitionId` pointing to the PLATFORM definition. Clones the PLATFORM's active version content into a LABORATORY DRAFT (version 1).
4. Edits the DRAFT: adjusts reference ranges, adds/removes analytes, renames sections, etc.
5. Publishes the DRAFT → LABORATORY definition now has an active version → takes priority over PLATFORM for this lab.
6. "Revert to platform default" → archive the LABORATORY definition's active version, clear `activeVersionId`. Falls back to PLATFORM.

### 2.7 Existing importTemplate() Migration

The current `POST /results/templates` (InternalApiKeyGuard) is updated:

- Creates or finds a `ResultTemplateDefinition` with `scope=PLATFORM, ownerKey='platform'`.
- Creates a new `ResultTemplateVersion` with the imported content.
- If a PUBLISHED version already exists for this definition, it is ARCHIVED and the new version is PUBLISHED.
- The `catalogItemId` FK lookup is removed from the definition. The endpoint still accepts `labTenantId` + `catalogItemCode` for validation (confirming the code exists in a lab's catalog), but the definition stores only `catalogItemCode`.

---

## 3. Catalog-Test Creation and Template-Assignment Workflow

### 3.1 Separation of Concerns

| Concept                                | What it defines                                                              | Who manages it                                            | Where it lives                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **CatalogItem**                        | What can be ordered: code, name, kind (TEST/PACKAGE), category, turnaround   | Lab ADMIN (catalog page)                                  | `catalog_items` table                                                            |
| **LabTestConfiguration**               | How a test is processed at this lab: department, processing method, analyzer | Lab ADMIN (test config page)                              | `lab_test_configurations` table                                                  |
| **LabTestSpecimenRequirement**         | What physical specimens a test needs: type, container, volume                | Lab ADMIN (test config page)                              | `lab_test_specimen_requirements` table                                           |
| **ResultTemplateDefinition + Version** | What the report looks like: sections, analytes, reference ranges, formulas   | Platform (PLATFORM scope) or Lab ADMIN (LABORATORY scope) | `result_template_definitions` + `result_template_versions` + sections + analytes |

### 3.2 Workflow: Adding a New Test to the Lab

1. **Create CatalogItem** (existing flow): Lab admin adds a TEST to their catalog with code, name, category, turnaround time. This makes it orderable by connected clinics.
2. **Configure LabTestConfiguration** (new): Lab admin opens Test Configuration, finds the new test, and sets department, default processing method, allowed methods, default analyzer.
3. **Add specimen requirements** (new): Within the test configuration, lab admin adds one or more `LabTestSpecimenRequirement` rows — e.g., "EDTA blood in EDTA tube, 2mL minimum."
4. **Assign or create template** (new): Lab admin checks if a PLATFORM template exists for this catalog item. If yes, it's automatically available. If the lab wants custom reference ranges, they customize it (clone → edit → publish). If no PLATFORM template exists, they create a LABORATORY template from scratch.

**Operational readiness is mandatory for ordering.** A lab may save an incomplete test as an administrative draft, but connected clinics must not be able to order it until all of the following are true:

- `LabTestConfiguration` is complete.
- At least one required specimen group is configured.
- A compatible PUBLISHED template can be resolved.
- A valid active analyzer is configured when the default method is ANALYZER.

The UI displays `CONFIGURATION_INCOMPLETE` with the missing requirements and keeps the test unavailable to clinics. A package is orderable only when every active required component is operationally ready. The backend enforces readiness; frontend hiding alone is insufficient. `MISSING_RESULT_TEMPLATE` remains a defensive accessioning block for legacy orders or configuration removed after ordering.

### 3.3 Template-to-CatalogItem Relationship

Templates are linked to catalog items by **code convention**, not by foreign key:

- `ResultTemplateDefinition.catalogItemCode` = `CatalogItem.code` (string match).
- No FK between them. A definition with `catalogItemCode = "CBC"` applies to any lab's CatalogItem whose `code = "CBC"`.
- Creating a CatalogItem does NOT auto-create a template definition. Creating a definition does NOT auto-create a CatalogItem. They are independent.
- The template readiness check (section 8.2) verifies at accessioning time that a compatible published template exists. Missing templates block the test.

---

## 4. Template-Builder UX

### 4.1 Visual Template Builder (Phase 2 — Lab Template Management)

A form-based editor for creating and editing LABORATORY DRAFT templates. Not a drag-and-drop canvas — a structured form that maps directly to the template data model.

**Layout:**

- Left panel: Template metadata (title, species, age range, default observations)
- Main area: Sections list, each expandable to show analytes
- Each section: name, sort order, "Add analyte" button
- Each analyte row: code, name, technique, valueType selector, unit, reference range (min/max/displayText), formula, isHeader toggle, options (for SELECT type), sort order
- Bottom: "Save draft" / "Publish" / "Discard changes" actions

**Interactions:**

- Reorder sections and analytes via up/down buttons (sort order changes)
- Add/remove sections
- Add/remove analytes within a section
- Inline editing of all fields
- Formula editor with `[CODE]` autocomplete from sibling analytes in the same template
- Reference range editor: numeric min/max inputs + display text
- Preview mode: renders the template as it would appear on a result report (read-only view)

### 4.2 Narrative Test Support (Pathology/Cytology)

Current state: histopathology and cytology templates use `TEXT` valueType analytes (e.g., HISTOPATH_MACRO, HISTOPATH_MICRO, HISTOPATH_DX). These work but are minimal — single-line text fields.

**Enhancements for narrative tests:**

1. **New valueType: `LONG_TEXT`** — rendered as a multi-line textarea (not a single-line input). Used for macroscopic descriptions, microscopic findings, diagnostic conclusions.

2. **Template builder support:** When valueType = `LONG_TEXT`, the form renders a textarea with configurable minimum height. The builder preview shows the approximate report layout.

3. **Result entry form:** `LONG_TEXT` fields render as resizable textareas with markdown-light formatting (bold, italic, bullet lists). No rich text editor — plain text with optional simple formatting.

4. **Future (not MVP):** Image/attachment support for pathology specimens. The data model does not need to change — attachments would be stored externally (S3/Supabase Storage) and linked via a future `ResultReportAttachment` entity. Placeholder note in the template builder: "Image upload coming soon."

**Impact on existing templates:** The 3 existing histopath analytes (HISTOPATH_MACRO, HISTOPATH_MICRO, HISTOPATH_DX) and 1 cytology analyte (CYTO_RESULT) should be migrated from `TEXT` to `LONG_TEXT` via a data migration. This is backward-compatible — existing released reports snapshot the valueType, so their display is unaffected.

### 4.3 Template Builder Permissions

| Action                       | Roles                               |
| ---------------------------- | ----------------------------------- |
| View PLATFORM templates      | All lab members                     |
| View LABORATORY templates    | All lab members                     |
| Create/edit LABORATORY DRAFT | ADMIN, OWNER                        |
| Publish LABORATORY template  | ADMIN, OWNER                        |
| Archive LABORATORY template  | ADMIN, OWNER                        |
| Import PLATFORM template     | InternalApiKeyGuard only (existing) |

---

## 5. Current Template Readiness Inventory

Analysis of the 170 existing seed templates against the 137 TEST catalog items and 7 PACKAGE items:

### 5.1 Coverage by Department

| Department    | Catalog Tests                                                           | Templates                                  | Coverage | Notes                                                                     |
| ------------- | ----------------------------------------------------------------------- | ------------------------------------------ | -------- | ------------------------------------------------------------------------- |
| HEMATOLOGY    | CBC (1 test + age variants)                                             | 6 templates (dog adult + 4 age, cat adult) | Full     | Formulas for MCV, MCH, MCHC, differentials                                |
| CHEMISTRY     | ~60 individual analytes (ALB, GLU, CREA, ALT, AST, ALP, GGT, BUN, etc.) | ~100 templates (per analyte × dog/cat)     | Full     | Single-analyte templates. Packages (Perfil Básico, etc.) expand to these. |
| URINALYSIS    | URINALYSIS (1 test)                                                     | 1 template (ANY species)                   | Full     | 3 sections, all TEXT valueType (need LONG_TEXT for microscopy notes)      |
| PARASITOLOGY  | COPRO, COPRO_FLOT, COPRO_DIRECTO                                        | 3 templates (ANY species)                  | Full     | TEXT fields                                                               |
| SEROLOGY      | 4DX, FELV_FIV, PARVO, DISTEMPER, etc.                                   | ~15 templates                              | Full     | Mix of POSITIVE_NEGATIVE and TEXT                                         |
| ENDOCRINOLOGY | T4, TSH, CORTISOL_BASAL, CORTISOL_POST                                  | ~10 templates (dog/cat)                    | Full     | NUMERIC with reference ranges                                             |
| MICROBIOLOGY  | CULTURE, SENSITIVITY                                                    | ~3 templates                               | Partial  | TEXT-only. Future: structured sensitivity panel                           |
| OTHER         | HISTOPATH, CYTOLOGY, IHC panels                                         | ~5 templates                               | Partial  | TEXT fields need LONG_TEXT migration                                      |
| COAGULATION   | PT, PTT, FIBRINOGEN                                                     | ~4 templates                               | Full     | NUMERIC                                                                   |
| PCR           | Various PCR panels                                                      | ~8 templates                               | Full     | Mix of TEXT and POSITIVE_NEGATIVE                                         |

### 5.2 Gaps and Recommendations

| Gap                                                                             | Impact                                                              | Recommendation                                                    |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| No species-specific urinalysis (dog vs cat reference ranges differ for density) | Low — current template has no reference ranges for TEXT fields      | Create species-specific NUMERIC templates post-MVP                |
| Histopath/cytology use TEXT instead of LONG_TEXT                                | Low — functional but poor UX for multi-paragraph narratives         | Migrate to LONG_TEXT in Phase 2                                   |
| No template for some chemistry packages (e.g., "Perfil Renal Completo")         | None — packages expand to component tests which each have templates | Correct by design                                                 |
| No lab-specific templates exist yet                                             | Expected — LABORATORY scope is new                                  | Labs customize PLATFORM templates as needed after Phase 2         |
| Culture/sensitivity templates are minimal (TEXT-only)                           | Medium — structured antibiogram support would be valuable           | Defer structured sensitivity to future phase. TEXT works for MVP. |

### 5.3 Formula Inventory

Formulas exist in CBC templates only. All use `[CODE]` references to sibling analytes:

| Formula                | Used In | Expression                                          |
| ---------------------- | ------- | --------------------------------------------------- |
| MCV                    | CBC     | `([HCT]*10)/[RBC]`                                  |
| MCH                    | CBC     | `([HGB]*10)/[RBC]`                                  |
| MCHC                   | CBC     | `([HGB]*100)/[HCT]`                                 |
| Differential absolutes | CBC     | `([PCT]*[WBC])/100` (NEU, LYM, MON, EOS, BAS, BAND) |
| Osmolarity             | OSM     | `(2*([NA]+[K]))+([GLU]/18)+([BUN]/2.8)`             |
| UPC ratio              | UPC     | `[UPC_PROT]/[UPC_CREA]`                             |

Formula evaluation is immediate in the frontend for technician feedback, but the backend is authoritative. The same versioned formula engine must independently recalculate or validate calculated values when completing entry, submitting for review, and releasing. It rejects unknown references, cycles, non-numeric inputs, division by zero, non-finite results, and client/server mismatches. Stored calculated values include the formula snapshot and dependency values used.

---

## 6. Specimen-Requirement and Accessioning Model

### 6.1 LabTestSpecimenRequirement (Separated from LabTestConfiguration)

`LabTestSpecimenRequirement` is a separate table with a 1:N relationship to `LabTestConfiguration`. Requirements are divided into groups. Every required group must be satisfied, while one accepted option within a group satisfies that group. This allows:

- Multiple specimen requirements per test (e.g., crossmatch needs both patient and donor blood)
- Alternative specimen types (e.g., serum OR plasma for a chemistry test)
- Independent minimum volumes per specimen type

```
LabTestConfiguration (1) ──→ LabTestSpecimenRequirement (N)
  Example:
  ├── Group PATIENT: EDTA_BLOOD in EDTA_TUBE, 2mL
  └── Group DONOR: EDTA_BLOOD OR CITRATE_BLOOD (alternatives within DONOR)
```

Alternatives apply only within the same `requirementGroupKey`. A test is READY only when every required group has at least one accepted matching specimen. This supports tests that need multiple roles, such as patient and donor samples, without incorrectly treating all listed specimens as global alternatives.

### 6.2 Specimen Condition as Multiple Flags

Specimen condition is NOT an exclusive enum. A single specimen can be simultaneously hemolyzed AND lipemic. The model uses individual boolean flags:

```
Specimen:
  isHemolyzed: Boolean @default(false)
  isLipemic: Boolean @default(false)
  isIcteric: Boolean @default(false)
  isInsufficient: Boolean @default(false)
  isContaminated: Boolean @default(false)
  isWrongContainer: Boolean @default(false)
  isLeaking: Boolean @default(false)
```

**UI:** Checkbox group in the accessioning dialog, not a dropdown. Multiple conditions can be checked. A specimen with no conditions checked is considered in good condition (no separate "GOOD" flag — absence of negatives implies good).

**Condition vs rejection:** Having a condition does NOT automatically reject the specimen. A hemolyzed sample may still be acceptable for some tests (e.g., CBC but not bilirubin). The decision to accept or reject is made by the technician/receptionist per specimen. The conditions are informational flags that help the reviewer assess result validity.

### 6.3 Multiple Physical Tubes

A single order may require multiple tubes of the same specimen type (e.g., two EDTA tubes for a large panel). The `tubeIndex` field on `Specimen` distinguishes them:

```
Specimen:
  specimenType: "EDTA_BLOOD"
  containerType: "EDTA_TUBE"
  tubeIndex: 1     ← first EDTA tube
  ...

Specimen:
  specimenType: "EDTA_BLOOD"
  containerType: "EDTA_TUBE"
  tubeIndex: 2     ← second EDTA tube
  ...
```

Each tube gets its own accession number and can be independently accepted/rejected. The M:N `OrderedTestSpecimen` link allows tests to be associated with any tube of the correct type.

### 6.4 Specimen State Distinctions

| State      | Meaning                                                                                                                     | Who sets it                             | What happens                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPECTED` | The system has determined this specimen is needed (derived from LabTestSpecimenRequirement). It has not physically arrived. | System (during accessioning derivation) | Linked tests remain PENDING.                                                                                                                 |
| `MISSING`  | Reception explicitly confirms that an expected physical specimen did not arrive.                                            | Reception staff                         | Dependent tests become BLOCKED with MISSING_SPECIMEN. Records actor, timestamp and notes. Counts as accounted for when completing reception. |
| `RECEIVED` | The physical tube has arrived and been scanned/logged. Condition flags are being evaluated.                                 | Reception staff (during accessioning)   | Transitional — staff must accept or reject.                                                                                                  |
| `ACCEPTED` | Reception staff has inspected the specimen and confirmed it is usable.                                                      | Reception staff                         | Linked tests transition PENDING → READY.                                                                                                     |
| `REJECTED` | Reception staff has determined the specimen is unusable. Rejection reason is required.                                      | Reception staff                         | Linked tests transition to BLOCKED with reason REJECTED_SPECIMEN.                                                                            |

**Late-arriving specimens:** A MISSING expectation is retained for audit. When a physical specimen later arrives, a new RECEIVED specimen resolves/replaces that expectation; once accepted and all requirement groups are satisfied, linked tests transition BLOCKED → READY.

### 6.5 Expected Specimen Derivation

When an order is accessioned, the system derives expected specimens:

1. Load all OrderedTest rows for the order (already expanded from packages in Phase 1).
2. For each test, look up its `LabTestConfiguration` and associated `LabTestSpecimenRequirement` rows.
3. Group tests by their primary `(specimenType, containerType)` requirement.
4. Each unique `(specimenType, containerType)` group becomes one expected Specimen record.
5. Tests with no `LabTestConfiguration` are flagged as "Unknown specimen requirement" — the receptionist must manually specify the specimen type.
6. Requirements are grouped by `requirementGroupKey`; alternatives are displayed within their group, and every required group is shown separately.

**Example:**

- Albumin (SERUM/SST_TUBE), Glucose (SERUM/SST_TUBE), Creatinine (SERUM/SST_TUBE) → 1 expected Specimen
- CBC (EDTA_BLOOD/EDTA_TUBE) → 1 expected Specimen
- Urinalysis (URINE/URINE_CUP) → 1 expected Specimen
- Total: 3 expected Specimens for this order

### 6.6 Accessioning Dialog Flow

1. Staff clicks "Accession Samples" on `OrderWorkspacePage`.
2. System calls `GET /lab/orders/:id/expected-specimens` → returns derived expected specimens with their test groups.
3. Dialog displays one card per expected specimen:
   - Specimen type + container (pre-filled from config)
   - Accession number (auto-generated, editable for barcode scanning)
   - Condition checkboxes (hemolyzed, lipemic, etc.)
   - Accept / Reject toggle
   - If rejected: rejection reason (required text)
   - Notes field
4. "Quick accept all" shortcut: marks all specimens as ACCEPTED with no condition flags and auto-generated accession numbers.
5. Staff can add extra tubes ("Add another [EDTA tube]") or unexpected specimen types.
6. On confirm: `POST /lab/orders/:id/accession` with the specimen data.
7. Backend creates Specimen records, OrderedTestSpecimen links, transitions test statuses, creates ResultReport idempotently (only for tests linked to accepted specimens), runs `deriveOrderStatus()`.

**Idempotency:** Reopening the accessioning dialog shows existing specimens with their current states. Submitting again does not duplicate — it updates existing records and adds only new ones.

---

## 7. Package-Expansion and Safe-Migration Rules

### 7.1 Package Expansion at initOrderedTests()

Current behavior: `initOrderedTests()` creates one OrderedTest per `orderedItems` entry. If a PACKAGE was ordered, the OrderedTest points to the package CatalogItem, not its components.

New behavior: `initOrderedTests()` expands PACKAGE items into component TESTs and records origins via `OrderedTestSource`:

```
For each orderedItem:
  If kind == TEST:
    Create OrderedTest(catalogItemId = item.catalogItemId, ...)
    Create OrderedTestSource(
      orderedTestId = new test,
      originCatalogItemId = item.catalogItemId,
      originalOrderItemKey = item.lineKey,
      originalOrderItemIndex = item.index,
      quantity = item.quantity,
      sourceType = DIRECT,
      originCode = item.code,
      originName = item.name
    )

  If kind == PACKAGE:
    Look up CatalogItemComposition for this package
    For each component:
      If an OrderedTest for this component already exists (dedup):
        Add another OrderedTestSource(
          orderedTestId = existing test,
          originCatalogItemId = item.catalogItemId,  ← the package
          originalOrderItemKey = item.lineKey,
          originalOrderItemIndex = item.index,
          quantity = item.quantity,
          sourceType = PACKAGE,
          originCode = item.code,
          originName = item.name
        )
      Else:
        Create OrderedTest(catalogItemId = component.catalogItemId, ...)
        Create OrderedTestSource(
          orderedTestId = new test,
          originCatalogItemId = item.catalogItemId,  ← the package
          originalOrderItemKey = item.lineKey,
          originalOrderItemIndex = item.index,
          quantity = item.quantity,
          sourceType = PACKAGE,
          originCode = item.code,
          originName = item.name
        )
```

A component test that appears in multiple packages (or both directly and via a package) has multiple `OrderedTestSource` rows — one per origin. The test itself exists once.

### 7.2 Safe Migration Rules

**Critical constraint:** Package expansion changes the number of OrderedTest rows per order. Existing orders in various states must be handled carefully.

| Order Status                                 | Migration Action  | Rationale                                                                                                                                       |
| -------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `COMPLETED`                                  | **Do not touch.** | Results are released. Changing OrderedTest rows would break report integrity.                                                                   |
| `CANCELLED`                                  | **Do not touch.** | Terminal state. No further processing.                                                                                                          |
| `PROCESSING`                                 | **Do not touch.** | Tests may have in-progress results or claimed tasks. Re-expanding would disrupt active work.                                                    |
| `RECEIVED_BY_LAB`                            | **Re-expand.**    | Tests are received but not started. Delete package-level OrderedTests and create component-level ones, preserving `receivedAt` on the new rows. |
| `PENDING` / `READY_FOR_PICKUP` / `COLLECTED` | **Re-expand.**    | No processing has started. Safe to replace package-level OrderedTests with component-level ones.                                                |

**Migration steps:**

1. Create `ordered_test_sources` table.
2. Identify orders in re-expandable states (PENDING, READY_FOR_PICKUP, COLLECTED, RECEIVED_BY_LAB).
3. For each such order: identify OrderedTest rows where `catalogItem.kind == PACKAGE`.
4. For each package OrderedTest: look up its components via `CatalogItemComposition`.
5. Create component OrderedTests + `OrderedTestSource` rows (sourceType = PACKAGE), copying `receivedAt` if the original had it.
6. Delete the package-level OrderedTest.
7. All within a transaction per order.
8. For non-package standalone tests in these orders: create an `OrderedTestSource` (sourceType = DIRECT).
9. For COMPLETED/CANCELLED/PROCESSING orders: create `OrderedTestSource` rows from existing data without modifying OrderedTests (read-only backfill for historical reporting).

**Deduplication:** If a clinic ordered both a package AND one of its component tests, the migration must not create a duplicate OrderedTest. If a component already exists as a standalone OrderedTest, add an `OrderedTestSource` (sourceType = PACKAGE) to the existing test and an `OrderedTestSource` (sourceType = DIRECT) for the original standalone ordering. Do not duplicate the OrderedTest.

### 7.3 Frontend Display

The `OrderWorkspacePage` groups expanded component tests using `OrderedTestSource` data:

```
📦 Perfil Básico (package)
   ├── ALB — Albumin         [READY]
   ├── GLU — Glucose          [READY]
   ├── CREA — Creatinine      [IN_PROGRESS]  (also ordered directly)
   └── ALT — ALT/GPT          [READY]

🧪 CBC — Hemograma Completo  [RESULTS_ENTERED]

🧪 URINALYSIS — Urianálisis  [PENDING]
```

Tests with at least one PACKAGE source are grouped under the first package's originName. Tests with multiple package origins show "(also in: Package B)" note. Tests with only DIRECT sources appear as standalone items.

---

## 8. Processing/Worklist/Result-Entry Workflow

### 8.1 Revised End-to-End Flow

```
Clinic creates order
  → orderedItems JSON snapshot
  → initOrderedTests() expands packages → OrderedTests (all PENDING)
  → Pickup created if LAB_PICKUP

Courier collects (if applicable)
  → Pickup workflow (unchanged)

Lab reception: Accessioning
  → Derive expected specimens from LabTestConfiguration
  → Staff accepts/rejects each specimen
  → For each accepted test: resolve template (section 2.5)
     → Template found → create ResultReportTest + analyte slots → test PENDING → READY
     → No template found → test PENDING → BLOCKED (MISSING_RESULT_TEMPLATE)
  → Rejected specimens → linked tests PENDING → BLOCKED (REJECTED_SPECIMEN)
  → ResultReport created (DRAFT) with ResultReportTest entries for resolved tests
  → deriveOrderStatus() → RECEIVED_BY_LAB

Department worklist
  → Tests in READY status appear in their department's worklist
  → Technician claims a test (assignedUserId + claimedAt set)
  → Technician starts processing → test READY → IN_PROGRESS (startedAt set)
  → ProcessingMethod + analyzerId pre-populated from LabTestConfiguration

Result entry
  → Technician opens result entry form
  → Template-driven analyte fields rendered
  → Partial save (stays IN_PROGRESS) / Complete entry (→ RESULTS_ENTERED)
  → deriveOrderStatus() → PROCESSING

Review/release
  → When all tests RESULTS_ENTERED → "Submit for review" available
  → Tests → IN_REVIEW, Report → IN_REVIEW
  → Reviewer approves → Report → RELEASED, tests → COMPLETED
  → Or: Reviewer requests corrections → Report → DRAFT, tests → RESULTS_ENTERED
  → On release: H/L/N flags computed, reference ranges snapshotted
  → deriveOrderStatus() → COMPLETED
```

### 8.2 Template Readiness Blocking

**Trigger:** During accessioning (Phase 3), when creating `ResultReportTest` rows for accepted tests.

**Flow:**

```
For each accepted OrderedTest:
  1. Resolve template (section 2.5 selection logic)
  2. If a published template version is found:
     → Create ResultReportTest(reportId, orderedTestId, templateVersionId, templateDefinitionId)
     → Create ResultReportAnalyte slots from the version's analytes
     → Test status: READY (can proceed to worklist)
  3. If NO published template version is found:
     → Test status: BLOCKED
     → blockReason: MISSING_RESULT_TEMPLATE
     → blockReasonDetail: "No published template for {code} + {species}"
     → No ResultReportTest created for this test
     → TimelineEvent: TEST_BLOCKED with metadata
```

**Resolution path:**

1. Lab admin is notified (blocked test is visible in worklist with the reason).
2. Admin creates/publishes a LABORATORY template for the missing test, OR ensures a PLATFORM template with the matching code exists.
3. Admin or system triggers "Retry template resolution" for the blocked test:
   - `POST /lab/ordered-tests/:id/resolve-template`
   - Re-runs template selection. If found → creates ResultReportTest + analytes, transitions BLOCKED → READY.
   - If still not found → remains BLOCKED with updated timestamp.

**Catalog creation vs activation distinction:**

- A CatalogItem can be created and ordered without a template — clinics can order tests freely.
- Template readiness is checked at **accessioning time**, not at ordering time. This avoids blocking the clinic's workflow.
- Result entry is impossible for a BLOCKED (MISSING_RESULT_TEMPLATE) test — no ResultReportTest exists, so there are no analyte fields to fill.
- If a lab wants to prevent ordering tests without templates, they can deactivate the CatalogItem (`active = false`) until configuration is complete.

### 8.3 Department Worklists

New primary view for technicians (alongside existing OrdersQueuePage for supervisors):

- Navigation: "Worklists" section with sub-items per active department
- Each department page shows: READY, IN_PROGRESS, and RESULTS_ENTERED tests for that department
- Badge counts on nav items: number of READY (unclaimed) tests

**Worklist item displays:**

- Accession number + specimen info
- Patient name + species
- Test name (+ source package name if expanded)
- Priority (color-coded: STAT=red, URGENT=yellow, ROUTINE=default)
- Wait time since specimen acceptance
- Assigned technician or "Unassigned"
- Configured processing method + analyzer name
- Status badge

**Actions per worklist item:**

- Unassigned + READY → "Claim" button
- Claimed by me + READY → "Start" button
- Claimed by other → shows their name, "Request reassignment" (creates a notification, does not auto-reassign)
- IN_PROGRESS → "Enter results" link
- RESULTS_ENTERED → "View results" link

### 8.4 Claiming with Concurrency Protection

```
POST /lab/ordered-tests/:id/claim
  Body: { version: Int }  ← current version from client

Backend:
  1. Find OrderedTest where id AND version match (optimistic lock)
  2. If no match → 409 Conflict (someone else modified)
  3. If already assigned → 409 with current assignee name
  4. Set assignedUserId, claimedAt, increment version
  5. Return updated OrderedTest
```

Optimistic locking via `version` field on OrderedTest:

- Every mutation increments version
- Client sends the version it last read
- If versions don't match, the operation fails with a 409 Conflict
- Client refreshes and retries

### 8.5 Result Entry Form

Replaces the current `ResultEntryPage` (which only has status/method controls, no value inputs).

**Form structure:**

- Header: test name, processing method, analyzer (if applicable), specimen accession#, technician name
- Body: sections from the matched template, each with analyte fields:
  - `NUMERIC`: number input + unit label + reference range display (min–max) + out-of-range indicator (red border for H/L)
  - `TEXT`: single-line text input
  - `LONG_TEXT`: multi-line textarea (for pathology narratives)
  - `POSITIVE_NEGATIVE`: toggle (Positivo / Negativo)
  - `SELECT`: dropdown from template options
  - Header (`isHeader=true`): bold label, no input field
  - Formula: auto-computed read-only field. Evaluates `[CODE]` references in real-time as sibling values change.
- Footer: "Save draft" (partial save, status stays IN_PROGRESS) / "Complete entry" (validates all required fields → RESULTS_ENTERED)

**Validation:**

- Required fields: all non-header, non-formula analytes must have a value to "Complete entry" (not for "Save draft")
- Numeric bounds: warn (not block) if value is extremely out of range (e.g., 10x the reference max)
- Formula computation: recalculate whenever a referenced analyte value changes

**Processing context:**

- Default processing method + analyzer come from LabTestConfiguration
- "Change method" secondary action allows override with reason text (stored in a future field or timeline event)
- ResultEntrySource is set based on the context: `MANUAL_ENTRY` for form input (MVP), `FILE_IMPORT` for future analyzer imports

---

## 9. Review/Release Workflow

### 9.1 Submission for Review

When all OrderedTests for an order have reached RESULTS_ENTERED:

- "Submit for review" button becomes available
- Clicking it transitions all RESULTS_ENTERED tests → IN_REVIEW
- ResultReport status → IN_REVIEW
- `deriveOrderStatus()` keeps the order at PROCESSING (IN_REVIEW tests are still "in process")

### 9.2 Review Queue

New page or tab showing ResultReports in IN_REVIEW status for the lab.

**Review display per report:**

- Order info: requisition number, patient, clinic
- All analyte values organized by test → section → analyte
- Per analyte: value, flag (computed preview, not yet frozen), reference range, processing metadata
- Per test: processing method, entry source, analyzer, technician, specimen accession#
- Specimen conditions highlighted if any flags are set

### 9.3 Reviewer Authorization

Review and release require **elevated authorization:**

- The reviewer must be a `LabSigner` with `REVIEWER` in their `roles` array AND be an authenticated user with a `UserTenantMembership` for this lab tenant.
- OR the reviewer must have ADMIN or OWNER role in the lab tenant.
- The release endpoint checks BOTH conditions: valid JWT for a lab member + signer authorization.

**Classification:** Review/release is a **higher-risk action** because:

- Released reports are immutable and visible to clinics immediately
- Incorrect results can lead to misdiagnosis
- Regulatory requirements may mandate qualified reviewer sign-off

### 9.4 Review Actions

| Action                  | Effect                                                                                                                                                                  | Who                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **Approve and release** | Report → RELEASED, all tests → COMPLETED. H/L/N flags computed and frozen. Reference ranges snapshotted. Professional footer filled. `deriveOrderStatus()` → COMPLETED. | LabSigner (REVIEWER) or ADMIN/OWNER |
| **Request corrections** | Report → DRAFT, specified tests → RESULTS_ENTERED (back from IN_REVIEW). `correctionNotes` recorded on report. Review notes visible to technician.                      | LabSigner (REVIEWER) or ADMIN/OWNER |

**Correction flow:**

1. Reviewer selects tests needing corrections
2. Enters correction notes (per-test or per-report)
3. Submits → affected tests go back to RESULTS_ENTERED, report goes to DRAFT
4. Original technician (or any TECHNICIAN) can see correction notes and edit values
5. After corrections: re-submit for review → same flow

### 9.5 Release Immutability

Once RELEASED:

- No analyte values can be changed
- No status can be changed (except by a future "amended report" feature, out of scope)
- The report is visible to clinics
- AI interpretation can be generated

---

## 10. Backend Authorization and Audit Strategy

### 10.1 Guard Architecture

| Guard                   | Purpose                                                                 | Existing?                         |
| ----------------------- | ----------------------------------------------------------------------- | --------------------------------- |
| `LabTenantGuard`        | Verifies JWT user is a member of a LAB tenant. Extracts labTenantId.    | Yes                               |
| `TenantGuard`           | Verifies JWT user is a member of a CLINIC tenant.                       | Yes                               |
| `InternalApiKeyGuard`   | Verifies `x-internal-api-key` header. For platform-internal operations. | Yes                               |
| `@Roles(...)` decorator | Checks user's `TenantRole` in the lab membership.                       | **New**                           |
| Signer authorization    | Checks user is a LabSigner with required role.                          | **New** (inline check in service) |

### 10.2 InternalApiKeyGuard Preservation

**Critical requirement:** The `InternalApiKeyGuard` on result endpoints is preserved. It is NOT replaced by JWT auth.

Current internal-only endpoints (remain internal):

- `POST /results/templates` — template import (PLATFORM templates)
- `POST /results/reports` — report creation (called by internal systems or future automation)
- `PATCH /results/reports/:id/analytes` — analyte value save (internal)
- `POST /results/reports/:id/release` — release (internal)

**New lab-facing endpoints** (JWT + LabTenantGuard + @Roles):

- `POST /lab/reports` — create report (called during accessioning)
- `PATCH /lab/reports/:id/analytes` — save analyte values
- `POST /lab/reports/:id/submit-for-review`
- `POST /lab/reports/:id/approve`
- `POST /lab/reports/:id/request-corrections`
- `GET /lab/reports/:id` — read report

The lab-facing endpoints call the same service methods but through a different controller with different guards. The internal endpoints remain available for automation, seeding, and future integrations.

### 10.3 Role Enforcement Matrix

| Endpoint                                    | Guard                         | Required Roles                         |
| ------------------------------------------- | ----------------------------- | -------------------------------------- |
| `GET /lab/orders`                           | LabTenantGuard                | Any lab member                         |
| `GET /lab/orders/:id`                       | LabTenantGuard                | Any lab member                         |
| `POST /lab/orders/:id/accession`            | LabTenantGuard + @Roles       | RECEPTIONIST, TECHNICIAN, ADMIN, OWNER |
| `PATCH /lab/specimens/:id`                  | LabTenantGuard + @Roles       | TECHNICIAN, ADMIN, OWNER               |
| `GET /lab/worklist`                         | LabTenantGuard + @Roles       | TECHNICIAN, ADMIN, OWNER               |
| `POST /lab/ordered-tests/:id/claim`         | LabTenantGuard + @Roles       | TECHNICIAN, ADMIN, OWNER               |
| `POST /lab/ordered-tests/:id/start`         | LabTenantGuard + @Roles       | TECHNICIAN, ADMIN, OWNER               |
| `POST /lab/ordered-tests/:id/reassign`      | LabTenantGuard + @Roles       | ADMIN, OWNER                           |
| `PATCH /lab/reports/:id/analytes`           | LabTenantGuard + @Roles       | TECHNICIAN, ADMIN, OWNER               |
| `POST /lab/reports/:id/submit-for-review`   | LabTenantGuard + @Roles       | TECHNICIAN, ADMIN, OWNER               |
| `POST /lab/reports/:id/approve`             | LabTenantGuard + Signer check | LabSigner(REVIEWER) + ADMIN/OWNER      |
| `POST /lab/reports/:id/request-corrections` | LabTenantGuard + Signer check | LabSigner(REVIEWER) + ADMIN/OWNER      |
| `GET/POST/PATCH /lab/analyzers`             | LabTenantGuard + @Roles       | ADMIN, OWNER                           |
| `GET/POST/PATCH /lab/test-config`           | LabTenantGuard + @Roles       | ADMIN, OWNER                           |
| `GET/POST/PATCH /lab/templates`             | LabTenantGuard + @Roles       | See section 4.3                        |

### 10.4 Audit Trail (TimelineEvent Extensions)

New `TimelineEventType` values:

```
SAMPLE_ACCESSIONED      — specimens created/updated during accessioning
SAMPLE_ACCEPTED         — specimen accepted
SAMPLE_REJECTED         — specimen rejected (metadata: rejectionReason)
TEST_BLOCKED            — test blocked (metadata: blockReason, detail)
TEST_UNBLOCKED          — test unblocked (metadata: reason)
TEST_CLAIMED            — test claimed by technician
TEST_UNCLAIMED          — test unclaimed/reassigned
TEST_STARTED            — test processing started
RESULTS_ENTERED         — result entry completed for a test
SUBMITTED_FOR_REVIEW    — report submitted for review
REVIEW_APPROVED         — report approved and released
REVIEW_CORRECTIONS      — corrections requested (metadata: notes)
METHOD_OVERRIDDEN       — processing method changed from default (metadata: reason, from, to)
```

Each event records: `actorId`, `actorName`, timestamp, and event-specific `metadata` JSON.

### 10.5 Concurrency and Historical Integrity

**Optimistic locking:** `version` field on OrderedTest. Every mutation increments it. Clients send the version they read; mismatches return 409 Conflict.

**Idempotency:**

- Accessioning: checks for existing specimens before creation. Submitting the same accessioning data twice does not duplicate.
- Report creation: `ResultReport` has `@@unique(orderId)`. Second creation attempt returns the existing report.
- Claiming: checked in a single atomic update with version guard.

**Historical integrity:**

- Released reports are immutable (enforced at service level: any mutation on a RELEASED report throws).
- Template version snapshots on reports. Templates can be edited/archived without affecting released reports.
- OrderedTest status transitions are validated (only valid transitions allowed).
- All state changes produce TimelineEvent records for audit.

---

## 11. Final Phased Implementation Sequence

### Phase 1: Package Expansion + Role Enforcement + Optimistic Locking

**Goal:** Fix the core data model inconsistency and add the authorization foundation.

**Backend changes:**

- Modify `initOrderedTests()` to expand PACKAGE items into component TESTs via `CatalogItemComposition`
- **New `OrderedTestSource` model** (replaces `sourcePackageId`) — records every direct/package origin using immutable `originalOrderItemKey`, index and quantity so repeated identical lines are lossless
- Add `version` (Int, default 1) to OrderedTest for optimistic locking
- Create `@Roles()` decorator and `RolesGuard` for role-based authorization
- Add role checks to all existing lab controller endpoints per the matrix in section 10.3
- Run data migration for in-flight orders (see section 7.2)

**Database migration:**

- **New `ordered_test_sources` table**
- Add `version` column to `ordered_tests` (default 1)
- Data migration script: expand packages + create OrderedTestSource rows for all orders (section 7.2)

**Frontend changes:**

- Update `OrderWorkspacePage` to group tests using `OrderedTestSource` data
- Update `lab.types.ts` with `OrderedTestSource`, `OrderedTestSourceType`, `version` fields

**Tests:**

- Package expansion with deduplication (package + standalone component ordered)
- Idempotency of `initOrderedTests()`
- Role enforcement on every lab endpoint
- Version increment on OrderedTest mutations

**Risk:** Low-medium. The data migration for in-flight orders requires careful handling but only affects PENDING/RECEIVED_BY_LAB orders. COMPLETED/CANCELLED orders are untouched.

---

### Phase 2: Analyzer, LabTestConfiguration, Template Versioning, and Template Builder

**Goal:** Lab-specific configuration, template ownership/lifecycle, and the visual template editor.

**Backend changes (configuration):**

- New Prisma models: `Analyzer`, `LabTestConfiguration`, `LabTestSpecimenRequirement`
- New enums: `Department`, `ProcessingMethod`, `ResultEntrySource`
- New services: `analyzer.service.ts`, `lab-test-config.service.ts`
- New controller: `lab-config.controller.ts` with CRUD endpoints for analyzers, test config, specimen requirements
- Add backend `operationalReadiness` validation and expose missing configuration reasons; clinic catalog queries return only orderable-ready tests and packages
- All guarded: LabTenantGuard + @Roles(ADMIN, OWNER)

**Backend changes (templates):**

- **Drop old `ResultTemplate` table. Create `ResultTemplateDefinition` and `ResultTemplateVersion`.**
- `ResultTemplateDefinition`: catalogItemCode (String, not FK), species, ageMinWeeks/ageMaxWeeks (sentinels, not NULLs), scope, ownerKey, labTenantId, parentDefinitionId, activeVersionId
- `ResultTemplateVersion`: definitionId, version, title, status, content (sections+analytes), publishedAt. @@unique([definitionId, version])
- Move `ResultTemplateSection` and `ResultTemplateAnalyte` FKs from `templateId` to `versionId`
- Add `LONG_TEXT` to `AnalyteValueType` enum
- New service methods: `createDefinition()`, `createDraftVersion()`, `publishVersion()`, `archiveVersion()`, `cloneFromPlatform()`
- New lab-facing template endpoints: `GET /lab/templates`, `POST /lab/templates` (create LABORATORY definition + DRAFT), `PATCH /lab/template-versions/:id` (edit DRAFT), `POST /lab/template-versions/:id/publish`, `POST /lab/template-versions/:id/archive`
- Update `importTemplate()` to create/update `ResultTemplateDefinition` (scope=PLATFORM, ownerKey="platform") + `ResultTemplateVersion`
- Preserve existing `POST /results/templates` (InternalApiKeyGuard) for PLATFORM template import — endpoint contract unchanged externally
- Data migration: migrate existing `result_templates` → definitions (scope=PLATFORM) + versions (status=PUBLISHED, version=1), re-point sections/analytes, drop old table
- Data migration: migrate HISTOPATH/CYTOLOGY TEXT analytes to LONG_TEXT

**Frontend changes:**

- "Analyzers & Equipment" section on LaboratorySettingsPage (CRUD)
- "Test Configuration" page: table of all active catalog tests with department, specimen requirements, method, analyzer config
- "Template Management" page:
  - List PLATFORM templates (read-only) and LABORATORY templates
  - "Customize for our lab" action (clone PLATFORM → LABORATORY DRAFT)
  - Visual template builder form for DRAFT templates (section 4.1)
  - Publish / Archive actions
- Update `lab.types.ts` with all new types

**Tests:**

- Analyzer CRUD, LabTestConfiguration CRUD with specimen requirements
- Definition creation, DRAFT version editing, publishing (old PUBLISHED → ARCHIVED atomically), archiving
- Unique constraint enforcement (NULL-safe via ownerKey and age sentinels)
- Template selection priority (LABORATORY activeVersion > PLATFORM activeVersion, by code match)
- LONG_TEXT rendering
- `importTemplate()` migration to new schema (backward-compatible DTO)

**Risk:** Medium (up from Low in v3). The template schema migration touches a core table with 170 existing records. Requires careful data migration and verification that `importTemplate()` and template selection work against the new schema. Run migration on staging with full seed data before production.

---

### Phase 3: Specimen Model and Accessioning

**Goal:** Physical sample tracking with accessioning dialog.

**Backend changes:**

- New Prisma models: `Specimen`, `OrderedTestSpecimen`; specimen requirements use `requirementGroupKey` and alternatives within each group
- New enum: `SpecimenStatus`, including explicit MISSING; record `markedMissingAt`, `markedMissingById`, and notes
- Extend `OrderedTestStatus` enum: add READY, RESULTS_ENTERED, IN_REVIEW, BLOCKED
- Add to OrderedTest: `department`, `processingMethod`, `resultEntrySource`, `analyzerId`, `claimedAt`, `blockReason`, `blockReasonDetail`
- Retire `ResultEntryMethod` enum — replaced by `processingMethod` + `resultEntrySource`
- Remove `entryMethod` from OrderedTest (or keep as deprecated, null for new records)
- Create `specimen.service.ts`:
  - `deriveExpectedSpecimens(orderId)` — groups tests by LabTestSpecimenRequirement
  - `accessionOrder(orderId, specimens[])` — creates Specimens, links to OrderedTests, **resolves templates per test (section 8.2)**, transitions statuses (READY or BLOCKED with MISSING_RESULT_TEMPLATE), creates ResultReport + ResultReportTest entries idempotently
  - `addSpecimen(orderId, specimen)` — late-arriving specimens
  - `updateSpecimen(specimenId, data)` — update condition flags, accept/reject
- Add `MISSING_RESULT_TEMPLATE` to `BlockReason` enum
- New endpoint: `POST /lab/ordered-tests/:id/resolve-template` — retries template resolution for BLOCKED tests after admin publishes a template
- New `TimelineEventType`: `TEMPLATE_RESOLVED` — logged when a previously blocked test finds its template
- Implement `deriveOrderStatus()` (section 1.4) — called after every specimen/test status change
- Replace the manual order status transition in `receiveAllOrderedTests()` with `deriveOrderStatus()`
- Accession number generation (reuse Counter pattern: `SPEC-2026-000001`)
- New TimelineEvent types (section 10.4)
- New endpoints: `GET /lab/orders/:id/expected-specimens`, `POST /lab/orders/:id/accession`, `PATCH /lab/specimens/:id`, `POST /lab/orders/:id/specimens`

**Database migration:**

- New `specimens` table with boolean condition flags
- New `ordered_test_specimens` link table
- Add columns to `ordered_tests`: `department`, `processingMethod`, `resultEntrySource`, `analyzerId`, `claimedAt`, `blockReason`, `blockReasonDetail`
- Extend `OrderedTestStatus` enum
- New `SpecimenStatus` enum

**Frontend changes:**

- `AccessionDialog` component (modal/slide-over):
  - Calls expected-specimens endpoint
  - Renders one card per expected specimen with test groups
  - Condition flag checkboxes, accept/reject, rejection reason
  - "Quick accept all" shortcut
  - Add extra tubes button
- Replace "Mark as received" buttons with "Accession Samples" button on OrderWorkspacePage
- Update `lab.types.ts` with Specimen, condition flags, new enums
- Add `labApi.specimens.*` methods

**Backward compatibility:**

- Existing orders with `receivedAt` set on OrderedTests are considered accessioned
- `deriveOrderStatus()` handles orders without specimens (legacy path)
- Tests without LabTestConfiguration show "Unknown specimen requirement" — receptionist specifies manually

**Tests:**

- Expected specimen derivation from LabTestSpecimenRequirement
- Accessioning with accept/reject
- Condition flags (multiple set simultaneously)
- Rejection → test BLOCKED, later specimen → test READY
- **Template resolution during accessioning: found → READY, not found → BLOCKED (MISSING_RESULT_TEMPLATE)**
- **Resolve-template endpoint: publish template then retry → BLOCKED → READY**
- Idempotency of accessioning
- Multiple tubes of same type
- deriveOrderStatus() for all rule combinations
- Concurrent accessioning prevention

**Risk:** Medium. Core workflow change. Requires Phase 2 configuration to be populated for full functionality, but degrades gracefully without it.

---

### Phase 4: Department Worklists and Task Claiming

**Goal:** Route tests to departments. Claimable worklists with concurrency protection.

**Backend changes:**

- New `GET /lab/worklist` endpoint with filters: department, status, assignee, priority, date range
- New `POST /lab/ordered-tests/:id/claim` — optimistic lock via version field
- New `POST /lab/ordered-tests/:id/unclaim` — clears assignment (self or ADMIN)
- New `POST /lab/ordered-tests/:id/start` — READY → IN_PROGRESS (requires claimed first)
- New `POST /lab/ordered-tests/:id/reassign` — ADMIN/OWNER only

**Frontend changes:**

- `WorklistPage` component with department tabs
- `WorklistItem` card (tablet-optimized)
- Department nav items with badge counts
- Claim/Start/Unclaim actions
- `labApi.worklist.*` methods

**Tests:**

- Worklist filtering by department, status, assignee
- Optimistic locking race condition test (two claims for same test)
- Reassignment by ADMIN
- Badge count accuracy

**Risk:** Low. Additive — OrdersQueuePage continues alongside.

---

### Phase 5: Result Value Entry UI

**Goal:** Build the actual analyte value entry form and introduce `ResultReportTest` for per-test template provenance.

**Backend changes:**

- **New `ResultReportTest` model** — links each OrderedTest to the exact ResultTemplateVersion used and its analytes
- **Reparent `ResultReportAnalyte`:** replace `reportId` + `orderedTestId` with `reportTestId → ResultReportTest`
- Remove `templateId` from `ResultReport` (provenance is now per-test on ResultReportTest)
- Update report creation (called during Phase 3 accessioning):
  - For each OrderedTest with a resolved template: create `ResultReportTest(reportId, orderedTestId, templateVersionId, templateDefinitionId)` + child `ResultReportAnalyte` rows
- New lab-facing report endpoints (LabTenantGuard + @Roles):
  - `POST /lab/reports` (wraps `createReport()`)
  - `PATCH /lab/report-tests/:id/analytes` — save analyte values for a specific test's ResultReportTest
  - `POST /lab/ordered-tests/:id/complete-entry` — validates all required analytes filled, transitions → RESULTS_ENTERED
  - `GET /lab/reports/:id` — read report with nested `tests[].analytes[]`
- Keep internal endpoints (`/results/...`) with InternalApiKeyGuard — update them to use the new schema internally
- Ensure partial save works (save subset of analytes without completing)

**Database migration:**

- New `result_report_tests` table
- Migrate existing `ResultReportAnalyte` rows: group by `(reportId, orderedTestId)`, create `ResultReportTest` rows, re-point analytes via new `reportTestId`
- Drop `reportId` and `orderedTestId` columns from `result_report_analytes` after migration verified
- Remove `templateId` column from `result_reports`

**Frontend changes:**

- `ResultEntryForm` component — the core deliverable:
  - Load analytes via `reportTest.analytes` (not filtered by orderedTestId)
  - Render template-driven fields by type (NUMERIC, TEXT, LONG_TEXT, POSITIVE_NEGATIVE, SELECT, formula, header)
  - Formula parser: evaluates `[CODE]` references from sibling analyte values in real-time for UX
  - Processing context header (includes template version reference)
  - "Save draft" / "Complete entry" actions
  - Responsive layout (tablet + desktop)
- Replace current `ResultEntryPage` navigation
- Report display groups analytes by `ResultReportTest` (each section labeled with test name)

**Build incrementally:** NUMERIC fields first → TEXT/LONG_TEXT → SELECT → POSITIVE_NEGATIVE → formulas → validation.

**Tests:**

- ResultReportTest creation with correct templateVersionId linkage
- Form rendering for all value types
- Formula computation with dependency tracking
- Server-authoritative formula recomputation/validation on complete, submit-for-review and release, including cycle, unknown-code, divide-by-zero and mismatch tests
- Partial save (some fields filled, some empty)
- Complete entry with missing required fields (should fail)
- Concurrent saves (optimistic locking)
- Data migration: existing report analytes correctly reparented

**Risk:** **High** (up from Medium-high in v3). This phase includes a schema migration on `result_report_analytes` (reparenting under ResultReportTest) plus the largest single UI component. Consider splitting into 5a (ResultReportTest migration + backend) and 5b (Result Entry UI) if the migration proves complex. Existing released reports must be migrated without data loss.

---

### Phase 6: Technical Review and Release

**Goal:** Structured review workflow with elevated authorization.

**Classification: Higher risk.** Released reports are immutable and immediately visible to clinics. Incorrect results can impact clinical decisions. This phase warrants extra testing and careful rollout.

**Backend changes:**

- Add `IN_REVIEW` to `ResultReportStatus` enum
- Add to ResultReport: `reviewedById`, `reviewedAt`, `reviewNotes`, `correctionNotes`
- New endpoints:
  - `POST /lab/reports/:id/submit-for-review` — validates all tests RESULTS_ENTERED → IN_REVIEW
  - `POST /lab/reports/:id/approve` — validates signer authorization, releases report, computes flags
  - `POST /lab/reports/:id/request-corrections` — returns report to DRAFT with notes
- Release validation: require at least one `LabSigner` with REVIEWER role to be configured before allowing any release
- Double-check: signer must also be an active UserTenantMembership for this lab

**Database migration:**

- Extend `ResultReportStatus` enum with `IN_REVIEW`
- Add reviewer columns to `result_reports`

**Frontend changes:**

- Review Queue page/tab showing IN_REVIEW reports
- Extended ReviewReleasePage:
  - Per-analyte review display with all metadata
  - Approve / Request corrections actions
  - Correction notes field
  - Reviewer/signer selection from LabSigner list
  - Confirmation dialog for release ("This action cannot be undone")
- StatusBadge updates for IN_REVIEW, RESULTS_ENTERED

**Extra safeguards (higher risk classification):**

- Release confirmation requires explicit signer selection + confirmation
- Released report gets a tombstone: `releasedAt`, `releasedByUserId`, signer credentials frozen
- Log release as TimelineEvent with full actor + signer metadata
- Consider: "Preview release" mode showing exactly what the clinic will see before confirming

**Tests:**

- Submit for review with incomplete tests (should fail)
- Approval by authorized signer
- Approval by unauthorized user (should fail)
- Correction flow: reject → edit → re-submit → approve
- Flag computation on release (H/L/N for all numeric analytes)
- Immutability after release (no edits possible)
- Concurrent release attempts (only one succeeds)

**Risk:** Medium. The workflow extension is straightforward, but release immutability and signer authorization must be bulletproof. Extra test coverage required.

---

### Phase 7 (Future): File Import

Deferred until physical access to lab equipment (BioSystems A25, etc.) and actual exported file formats are available.

Architecture is prepared:

- `ResultEntrySource.FILE_IMPORT` exists
- `Analyzer` model tracks equipment
- `ResultReport.rawPayload` stores original analyzer data
- `LabTestConfiguration` associates tests with analyzers

Future entity: `AnalyzerCodeMapping` (analyzer test code → catalog item + template analyte mapping).

---

### Phase 8 (Future): Direct Analyzer/LIS Integration

Deferred until equipment inspection. Requires decisions on communication protocol (ASTM, HL7, serial, TCP, file watch), bidirectionality, and middleware architecture.

`ProcessingMethod.ANALYZER` + `ResultEntrySource.DIRECT_INTEGRATION` combination is ready. `ProcessingAttempt` and `AnalyzerRun` entities would be added at this phase.

---

## 12. Risks and Compatibility per Phase

| Phase                          | Risk                 | Compatibility Impact                                                                                                                                                                  | Mitigation                                                                                                                                                      |
| ------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1: Package Expansion**       | Low-medium           | Data migration for in-flight orders. New `ordered_test_sources` table. COMPLETED/CANCELLED untouched (backfill only).                                                                 | Transaction-per-order migration. Dedup check for package+component overlap. Dry-run migration on staging first.                                                 |
| **2: Config + Templates**      | Medium               | Old `result_templates` table replaced by `result_template_definitions` + `result_template_versions`. All existing templates migrated to PLATFORM definitions with PUBLISHED versions. | Template selection falls back to PLATFORM if no LABORATORY template exists. Verify `importTemplate()` works against new schema on staging.                      |
| **3: Specimen + Accessioning** | Medium               | Replaces "Mark as received" with accessioning dialog. Tests without published templates are BLOCKED (MISSING_RESULT_TEMPLATE).                                                        | `deriveOrderStatus()` handles legacy (no specimens) and new (with specimens) orders. `resolve-template` endpoint unblocks tests after admin publishes template. |
| **4: Worklists**               | Low                  | Additive. OrdersQueuePage remains.                                                                                                                                                    | No migration needed.                                                                                                                                            |
| **5: Result Entry UI**         | **High**             | New `result_report_tests` table. `result_report_analytes` reparented (reportId+orderedTestId → reportTestId). `templateId` removed from `result_reports`.                             | Consider splitting into 5a (schema migration) and 5b (UI). Migrate existing analytes carefully. Verify released reports survive reparenting.                    |
| **6: Review/Release**          | Medium (higher risk) | Adds IN_REVIEW state. DRAFT→RELEASED becomes DRAFT→IN_REVIEW→RELEASED.                                                                                                                | Existing RELEASED reports unaffected. Consider feature flag for gradual rollout.                                                                                |
| **7-8: Future**                | Deferred             | N/A                                                                                                                                                                                   | N/A                                                                                                                                                             |

### Cross-Phase Compatibility Notes

- Each phase is deployable independently. Phase N does not require Phase N+1 to be useful.
- Phases 3-6 depend on Phase 2 (LabTestConfiguration) for full functionality but degrade gracefully without it.
- Phase 5 (result entry) can work without Phase 3 (specimens) — the form renders without specimen context.
- Phase 6 (review) can work without Phase 4 (worklists) — tests can be reviewed regardless of how they were claimed.

---

## 13. Recommended First Phase and Why

**Recommended: Phase 1 (Package Expansion + Role Enforcement + Optimistic Locking)**

**Why:**

1. **Fixes the fundamental data model inconsistency.** The disconnect between `initOrderedTests()` (no expansion) and `createReport()` (expansion) is the root cause of many downstream issues. Until this is fixed, every subsequent phase would need to work around it.
2. **Low risk with high value.** The migration only affects non-terminal orders. COMPLETED and CANCELLED orders are untouched. The expansion logic already exists in `createReport()` — it needs to be moved earlier in the pipeline.
3. **Enables all subsequent phases.** Phase 3 (specimens) needs expanded tests to derive specimen requirements. Phase 4 (worklists) needs individual component tests for department routing. Phase 5 (result entry) needs per-test analyte association.
4. **Role enforcement is a prerequisite.** Without it, any lab member can perform any action. Adding roles now means every subsequent phase's endpoints are protected from day one.
5. **Optimistic locking foundation.** The `version` field on OrderedTest is used by Phase 4 (claiming) and Phase 5 (result entry). Adding it now avoids a second migration later.

**Estimated scope:** ~2-3 days of implementation. One Prisma migration, modifications to one service file (`lab.service.ts`), one data migration script, frontend updates to one page, shared types update.

---

## 14. Remaining Product Decisions

These decisions are not req
uired before starting Phase 1 but should be resolved before their respective phases:

| #   | Decision                                                                                                                                                        | Affects Phase | Options                                                                                                                                           | Recommendation                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Accession number format** — should accession numbers be globally unique or unique per lab?                                                                    | 3             | (a) Global: `SPEC-2026-000001` (b) Per-lab: `{labCode}-2026-000001`                                                                               | Per-lab, using a Counter per labTenantId                                                                                                      |
| 2   | **Barcode format** — should accession numbers be scannable barcodes? What format?                                                                               | 3             | (a) Code128 (b) QR code (c) Both (d) Defer                                                                                                        | Defer — accession numbers are human-readable strings for now. Barcode rendering is a frontend concern added later.                            |
| 3   | **Default LabTestConfiguration** — should platform-level defaults exist for common tests, or does every lab start from scratch?                                 | 2             | (a) Platform seed with common defaults (b) Blank slate per lab                                                                                    | Platform seed — generate initial configs from existing template metadata (department inferred from category, specimen type from conventions). |
| 4   | **Concurrent result entry** — can two technicians enter results for different tests on the same order simultaneously?                                           | 5             | (a) Yes — each technician works on their own OrderedTest's analytes (b) No — lock the entire report during entry                                  | Yes — the report is shared but analytes are partitioned by orderedTestId. No cross-test conflicts.                                            |
| 5   | **Partial release** — can a report be partially released (some tests released, others still in progress)?                                                       | 6             | (a) No — all-or-nothing release (b) Yes — per-test release with partial report visibility                                                         | No for MVP — all-or-nothing. Per-test release adds significant complexity. Revisit if labs request it.                                        |
| 6   | **Review requirement toggle** — should labs be able to skip the review step for routine tests?                                                                  | 6             | (a) Always require review (b) Configurable per test in LabTestConfiguration                                                                       | Always require for MVP. Configurability later. Patient safety over convenience.                                                               |
| 7   | **Template import validation** — when importing PLATFORM templates, should the system validate formula references (all `[CODE]` targets exist in the template)? | 2             | (a) Validate on import and reject invalid formulas (b) Store as-is, validate at report creation (c) Store as-is, validate at frontend render time | (a) Validate on import — catch errors early.                                                                                                  |
| 8   | **Correction audit trail** — when a reviewer requests corrections and the technician re-submits, should the system keep a history of correction rounds?         | 6             | (a) Just correctionNotes on the report (current plan) (b) Separate CorrectionRound entity with per-round notes and timestamps                     | (a) for MVP. The TimelineEvent trail provides the audit history.                                                                              |

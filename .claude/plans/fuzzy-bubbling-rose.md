# Batch Result Entry for Panels/Packages

## Context

Chemistry panels like "Perfil Bioquímico Completo" (15 analytes across multiple component tests) currently appear as **15 separate worklist rows** and require the tech to enter results **one test at a time** — navigating to a separate page for each, saving, going back, finding the next one. In reality this is one physical lab task: one sample, one analyzer run, all results arrive together.

This change groups package-member tests into a single worklist row and provides a batch entry form where all analytes from all component tests appear on one page.

---

## Scope

**Frontend only (apps/lab).** The existing backend APIs already support everything we need — each test's `saveAnalytes` and `submitResults` endpoints work independently, and `OrderedTestSource` already tracks package membership. We'll call the existing per-test APIs in sequence from the frontend — no new backend endpoints needed.

---

## Part 1 — Worklist Grouping

### Goal
Tests that share the same package origin **within the same order** appear as one card in the worklist instead of N separate cards.

### Approach

**1a. Add a `groupBy` query param to the worklist API call** — but actually, the backend already returns flat `WorklistItem[]` and the grouping logic already exists in `OrderWorkspacePage.tsx` (`buildTestGroups`). We'll apply the same pattern client-side in `WorklistPage`.

**1b. Extend `WorklistItem` with source info** — the backend worklist endpoint currently doesn't return `sources`. We need to add `sources` (or at minimum `packageOriginId` + `packageOriginName`) to the worklist response so the frontend can group.

Actually, looking more carefully: the worklist API returns a flat list with no source info. We have two options:
- **Option A**: Add `packageOriginId`/`packageOriginName` fields to the worklist API response (small backend change)
- **Option B**: Fetch source info separately on the frontend

**We'll go with Option A** — it's a small addition to the Prisma select in `worklist.service.ts` and avoids extra round-trips.

### Changes

**Backend** (`apps/api/src/lab/worklist.service.ts`):
- Add `sources` to the Prisma `select` in `getWorklist()` — include `OrderedTestSource` fields: `originCatalogItemId`, `originName`, `sourceType`
- Map these to the response DTO as `packageOriginId: string | null` and `packageOriginName: string | null` (first PACKAGE source, or null for standalone tests)

**Backend** (`apps/api/src/lab/lab.controller.ts`):
- No route changes needed — same endpoint, just richer response

**Frontend types** (`apps/lab/src/app/types/lab.types.ts`):
- Add `packageOriginId: string | null` and `packageOriginName: string | null` to `WorklistItem`

**Frontend** (`apps/lab/src/app/pages/worklist/WorklistPage.tsx`):
- After receiving `items` from the API, group them using a `buildWorklistGroups()` function (similar to `buildTestGroups` in OrderWorkspacePage)
- Group type: `WorklistGroup = { kind: 'standalone', item: WorklistItem } | { kind: 'package', packageName: string, items: WorklistItem[] }`
- Render `WorklistGroupCard` for packages, `WorklistCard` for standalone tests

**Frontend** — new component `apps/lab/src/app/pages/worklist/WorklistGroupCard.tsx`:
- Shows the **package name** as the primary label (e.g., "Perfil Bioquímico Completo")
- Shows count of component tests (e.g., "5 tests")
- Shows aggregated status: if all READY → "Ready", if any IN_PROGRESS → "In Progress", mixed → show counts
- Same priority badge, patient info, accession, clinic as current cards
- **Claim/Start/Enter Results actions operate on all tests in the group at once** — calls `claim`/`start` for each test sequentially
- "Enter Results" links to the new batch entry route: `/orders/:orderId/batch-results?packageOriginId=:id`

### Worklist counts
- The worklist counts endpoint (`/worklist/counts`) currently counts individual tests. After grouping, the displayed count should still reflect actual tests (not groups), since the counts are about work volume. The `total` shown in the header stays the same.

---

## Part 2 — Batch Result Entry Page

### Goal
A single page where the tech enters results for **all component tests of a package** at once, with one submit action.

### Route
`/orders/:orderId/batch-results?packageOriginId=:packageOriginId`

### New file: `apps/lab/src/app/pages/orders/BatchResultEntryPage.tsx`

### Data loading
1. Fetch the order detail (`labApi.orders.get(orderId)`) to get the list of `OrderedTest[]` with their `sources`
2. Filter tests where `sources` include the matching `packageOriginId`
3. For each matching test, fetch its result session: `labApi.resultEntry.getSession(testId)` — all fetched in parallel via `Promise.all` (or `useQueries`)
4. Combine all sessions into a unified form

### UI Layout
```
┌─────────────────────────────────────────────────┐
│ ← Back                                          │
│                                                  │
│ Perfil Bioquímico Completo          [Save] [Submit] │
│ REQ-2026-000123 · Max (Canino)                   │
│                                                  │
│ ┌─ Glucosa (GLUCOSE) ─────────────────────────┐ │
│ │ Glucosa         [____120____] mg/dL  70-110  │ │
│ │ ...                                          │ │
│ │ Observations    [__________________]         │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ ┌─ Perfil Renal (RENAL) ──────────────────────┐ │
│ │ BUN             [______28___] mg/dL  7-27    │ │
│ │ Creatinina      [_____1.2___] mg/dL  0.5-1.8│ │
│ │ ...                                          │ │
│ │ Observations    [__________________]         │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ ... more tests ...                               │
└─────────────────────────────────────────────────┘
```

Each test is a collapsible section with:
- Test name + code as the section header
- All analyte inputs from its template (reusing the same rendering logic from `ResultEntryPage`)
- Per-test observations textarea
- Status indicator (filled / empty / partial)

### Form state
- One `Values` map per test: `Record<testId, Values>` where `Values = Record<analyteId, {numericValue, textValue, ...}>`
- One `observations` per test: `Record<testId, string>`
- Formula evaluation runs per-test (each test has its own formula context)
- Dirty tracking: compare current state vs saved state per test

### Saving & submitting
- **Save draft**: calls `labApi.resultEntry.saveAnalytes(testId, analytes, observations)` for each test sequentially (or in parallel — they're independent)
- **Submit all**: for each test, calls `saveAnalytes` then `submitResults` — wraps all in `Promise.all`. If any fails, shows error toast with which test failed, but doesn't roll back successful ones
- After submit, navigates back to `/orders/:orderId`
- Invalidates cache for all test sessions, the order, and worklist counts

### Shared logic extraction
Extract `renderAnalyteInput` from `ResultEntryPage.tsx` into a shared utility (`apps/lab/src/app/shared/components/AnalyteInput.tsx`) so both the single-test and batch pages use the same input rendering. This includes:
- The input type switch (NUMERIC, TEXT, LONG_TEXT, SELECT, POSITIVE_NEGATIVE)
- Reference range display with H/L flags
- Formula read-only display
- Combobox integration

---

## Part 3 — Route & Navigation

### Router (`apps/lab/src/app/app.tsx`)
Add route: `/orders/:orderId/batch-results` → `BatchResultEntryPage`

### Navigation flow
- **From WorklistGroupCard**: "Enter Results" → `/orders/:orderId/batch-results?packageOriginId=:id`
- **From OrderWorkspacePage**: Package group header gets an "Enter All Results" button → same route
- **From BatchResultEntryPage back button**: → navigates to previous page (worklist or order workspace)

### Standalone tests unchanged
Individual tests (not from a package) continue using the existing `ResultEntryPage` at `/orders/:orderId/tests/:testId/results`. No changes needed.

---

## Part 4 — i18n

Add translation keys to both `en.json` and `es.json` in `apps/lab/src/assets/i18n/`:

```
batch_result_entry.title
batch_result_entry.subtitle (e.g., "5 tests in this panel")
batch_result_entry.save_draft
batch_result_entry.submit_all
batch_result_entry.updated
batch_result_entry.submitted
batch_result_entry.section_empty
batch_result_entry.section_complete
batch_result_entry.section_partial
batch_result_entry.back
worklist.card.package_tests (e.g., "{{count}} tests")
worklist.card.package_status_all_ready
worklist.card.package_status_mixed
worklist.actions.enter_all_results
worklist.actions.claim_all
worklist.actions.start_all
```

---

## Implementation Order

1. **Backend**: Add `packageOriginId`/`packageOriginName` to worklist response
2. **Types**: Update `WorklistItem` in `lab.types.ts`
3. **Shared component**: Extract `AnalyteInput` from `ResultEntryPage`
4. **Refactor `ResultEntryPage`**: Use extracted `AnalyteInput`
5. **WorklistGroupCard**: New component for package groups in worklist
6. **WorklistPage**: Add grouping logic, render groups
7. **BatchResultEntryPage**: New page with multi-test form
8. **Router**: Add batch route
9. **i18n**: Add all translation keys
10. **OrderWorkspacePage**: Add "Enter All Results" button on package groups

---

## Files to create
- `apps/lab/src/app/shared/components/AnalyteInput.tsx`
- `apps/lab/src/app/pages/worklist/WorklistGroupCard.tsx`
- `apps/lab/src/app/pages/orders/BatchResultEntryPage.tsx`

## Files to modify
- `apps/api/src/lab/worklist.service.ts` — add sources to select
- `apps/lab/src/app/types/lab.types.ts` — add fields to WorklistItem
- `apps/lab/src/app/pages/orders/ResultEntryPage.tsx` — extract AnalyteInput
- `apps/lab/src/app/pages/worklist/WorklistPage.tsx` — add grouping logic
- `apps/lab/src/app/pages/worklist/WorklistCard.tsx` — no changes needed (still used for standalone)
- `apps/lab/src/app/pages/orders/OrderWorkspacePage.tsx` — add batch entry button
- `apps/lab/src/app/app.tsx` — add route
- `apps/lab/src/assets/i18n/en.json` — new keys
- `apps/lab/src/assets/i18n/es.json` — new keys

---

## Verification

1. **Build check**: `npx nx build lab` — no type errors
2. **Lint check**: `npx nx lint lab` + `npx nx lint api`
3. **Manual testing** (dev server):
   - Create an order with a package (e.g., "Perfil Bioquímico Completo")
   - Verify worklist shows one grouped card instead of N individual cards
   - Claim and start the group — all component tests transition together
   - Click "Enter Results" → batch page loads with all tests
   - Enter values for multiple tests, save draft, verify persistence
   - Submit all → all tests transition to RESULTS_ENTERED
   - Verify standalone tests still work with the existing single-test flow
4. **API check**: `npx nx test api` — existing tests pass

# Vet AI — Claude Instructions (Nx Monorepo)

## Monorepo Structure

```
vet-ai/
  apps/
    frontend/          ← Angular 21 PWA (clinic-facing: vets create cases, order tests, view results)
    lab/               ← React 19 + Vite (lab-staff-facing: orders queue, result entry/release, settings)
    api/               ← NestJS REST API + MCP server (shared backend for both frontends)
  libs/
    shared-types/      ← shared DTOs and interfaces (@vet-ai/shared-types) — used by frontend + api, NOT lab (lab keeps its own local types, see below)
```

## Tech Stack

- **Frontend**: Angular 21 (standalone components), Tailwind CSS, `@ngx-translate/core` v17, Angular Signals, RxJS, PWA
- **Lab portal**: React 19 + Vite, `react-router-dom`, Tailwind CSS, `react-i18next` — no state library (local `useState`/`useEffect` + one `AuthContext`)
- **API**: NestJS 11, TypeScript, Prisma + PostgreSQL (with pgvector), MCP server (`@modelcontextprotocol/sdk`) at `/api/mcp`
- **Shared**: `@vet-ai/shared-types` — all models/DTOs live here, imported by `frontend` and `api` (not `lab`)
- **Database**: PostgreSQL + Prisma — live, see `apps/api/prisma/schema.prisma`
- **Auth**: Supabase (JWT verified against Supabase's live JWKS endpoint, ES256) — live. Login happens client-side against Supabase in both `frontend` and `lab`; this API has no login endpoint, only JWT verification
- **RAG**: OpenAI embeddings + pgvector similarity search over a knowledge base (`apps/api/src/rag/`) — live
- **Queue** (TODO): Redis + BullMQ — not implemented yet
- **Tests**: Vitest (`frontend`, `lab`), Jest (`api`)

## Shared Types

All models and DTOs are in `libs/shared-types/src/lib/`. Import them as:

```typescript
import { CaseModel, PatientModel } from '@vet-ai/shared-types';
```

Angular's `apps/frontend/src/app/core/models/index.ts` re-exports from `@vet-ai/shared-types` — relative imports within the frontend still work.

**When adding a new model**: add it in `libs/shared-types/src/lib/`, export it from `libs/shared-types/src/lib/index.ts`.

## Frontend (apps/frontend)

### Component Structure

Every new component **must** use separate files — never inline templates or styles:

```
my-feature/
  my-feature.component.ts
  my-feature.component.html
  my-feature.component.scss
  my-feature.component.spec.ts
```

### Angular Conventions

- Use **signals** (`signal()`, `computed()`, `effect()`) for all component state — no `BehaviorSubject` or raw class properties for UI state
- Use `@if` / `@for` control flow syntax — never `*ngIf` / `*ngFor`
- Components are always **standalone** — add imports directly in `@Component({ imports: [] })`
- Inject services via `inject()` function — consistent throughout the project
- Use `input()` and `output()` signals for component I/O where possible (Angular 17+)
- **Always unsubscribe from observables** to prevent memory leaks:
  - For one-shot HTTP calls (API requests): use `.pipe(take(1))` before `.subscribe()`
  - For long-lived streams (valueChanges, intervals, etc.): use `.pipe(takeUntilDestroyed(this.destroyRef))` — inject `DestroyRef` via `inject(DestroyRef)`
  - Never call `.subscribe()` without one of these patterns

### Styling

- Use **Tailwind utility classes** only — no custom CSS unless absolutely necessary
- Component SCSS files should be near-empty unless you need host-level styles (`:host {}`)
- Custom colors defined in `apps/frontend/tailwind.config.js`: `cyan` (#06D6A0), `purple` (#9D4EDD)

### i18n

- All user-facing strings must use translation keys — **no hardcoded English strings** in templates
- Add every new string to both `apps/frontend/src/assets/i18n/en.json` and `es.json`
- Use `TranslatePipe` imported directly in the component (not `TranslateModule`)
- Pass translation keys as `@Input()` values to shared components (input, select, toggle) — they translate internally

### Shared Components

Reusable UI lives in `apps/frontend/src/app/shared/components/`. Before creating a new component, check if one already exists:

- `app-button` — variants: `primary`, `secondary`, `gradient`
- `app-input` — ControlValueAccessor, accepts translation keys for `label` and `placeholder`
- `app-select` — ControlValueAccessor, accepts translation keys for `label`, `placeholder`, `options[].label`
- `app-toggle` — ControlValueAccessor, toggle button group
- `app-language-toggle` — EN/ES switcher, use `LanguageService` to change language globally
- `app-branding-footer` — "Powered by Biomet VetAI" footer

### Frontend Services

- Services go in `apps/frontend/src/app/core/services/`
- All API calls are currently mocked with `of()` + delay — marked with `// TODO: Replace with actual API call`
- Use `LanguageService` (not `TranslateService` directly) to switch languages

## Lab Portal (apps/lab)

React 19 + Vite app for lab staff (not documented here until 2026-07-18 — verify
against the actual code if something below seems off, this section is newer than
the rest of the file).

### Conventions

- Domain types live in **one file**, `apps/lab/src/app/types/lab.types.ts` — no
  inline type definitions in components (explicit rule in that file's header comment)
- Components are function components in a single `.tsx` file each (no separate
  template/style files, no co-located `.spec.tsx` convention established yet) —
  `PascalCase.tsx`, e.g. `apps/lab/src/app/shared/components/StatusBadge.tsx`
- Pages live in `apps/lab/src/app/pages/<feature>/`, shared/reusable components in
  `apps/lab/src/app/shared/components/`
- No state management library — local `useState`/`useEffect` per component, plus one
  global `AuthContext` (`apps/lab/src/app/auth/AuthContext.tsx`) for the authenticated
  user/tenant
- API calls go through `apps/lab/src/app/shared/api/labApi.ts` — a small
  `get`/`patch`/`post`/`del` fetch wrapper that attaches the Supabase JWT
  (`Authorization: Bearer <token>`) on every request. Add new backend calls as new
  methods on the `labApi` object, grouped by feature (e.g. `labApi.assistant.*`),
  not as ad-hoc `fetch()` calls in components
- Styling: Tailwind utility classes only, dark theme (`bg-gray-950/900`,
  `border-gray-800`), same `cyan`/`purple` accent colors as `apps/frontend`
- i18n: `react-i18next`, keys in `apps/lab/src/assets/i18n/en.json` and `es.json` —
  same "no hardcoded strings" rule as the Angular frontend
- Dev server runs on `http://localhost:4201` (Vite proxies `/api` to the NestJS API
  on `http://localhost:3000`)

## API (apps/api)

### NestJS Conventions

- One module per feature: `auth`, `cases`, `onboarding`, `tenants`
- Controllers handle routing only — business logic goes in services
- Prefix unused parameters with `_` (e.g., `_body`) to satisfy linting
- `// TODO` comments mark where Prisma/Auth/external integrations go

### API File Naming

- `feature.module.ts`, `feature.controller.ts`, `feature.service.ts`
- Tests: `feature.controller.spec.ts`, `feature.service.spec.ts`

## Testing

For `frontend` (Angular) and `api` (NestJS): every component, service, controller
must have a `.spec.ts`. Minimum coverage:

- Creates without error
- Key public methods return expected shapes
- Spies verify service calls with correct arguments

For `lab` (React): no per-component test convention is established yet (only a
single app-level smoke test exists as of 2026-07-18) — don't assume the same
one-spec-per-component rule applies there unless asked to add it.

## File Naming

- Angular components: `kebab-case.component.{ts,html,scss,spec.ts}`
- React components (`apps/lab`): `PascalCase.tsx`, single file per component
- NestJS files: `kebab-case.{module,controller,service}.ts`
- Models: `kebab-case.model.ts` in `libs/shared-types/src/lib/`

## Workflow Approach

- Always understand the flow of the code and ask questions before implementing
- Do not execute build commands unless explicitly requested by the user

## Commands

```bash
# Frontend
npx nx serve frontend        # dev server (http://localhost:4200)
npx nx test frontend         # unit tests
npx nx build frontend        # production build
npx nx lint frontend         # ESLint

# Lab portal
npx nx serve lab             # dev server (http://localhost:4201)
npx nx test lab              # unit tests
npx nx build lab             # production build
npx nx lint lab              # ESLint

# API
npx nx serve api             # dev server (http://localhost:3000)
npx nx test api              # unit tests
npx nx build api             # production build

# Run all tests
npx nx run-many -t test

# Run all linting
npx nx run-many -t lint
```

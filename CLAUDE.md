# Vet AI — Claude Instructions (Nx Monorepo)

## Monorepo Structure
```
vet-ai/
  apps/
    frontend/          ← Angular 21 PWA
    api/               ← NestJS REST API
  libs/
    shared-types/      ← shared DTOs and interfaces (@vet-ai/shared-types)
```

## Tech Stack
- **Frontend**: Angular 21 (standalone components), Tailwind CSS, `@ngx-translate/core` v17, Angular Signals, RxJS, PWA
- **API**: NestJS 11, TypeScript
- **Shared**: `@vet-ai/shared-types` — all models/DTOs live here, imported by both apps
- **Database** (TODO): PostgreSQL + Prisma
- **Auth** (TODO): Supabase or Auth0, JWT
- **Queue** (TODO): Redis + BullMQ
- **Tests**: Vitest (frontend), Jest (api)

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
Every component, service, controller must have a `.spec.ts`. Minimum coverage:
- Creates without error
- Key public methods return expected shapes
- Spies verify service calls with correct arguments

## File Naming
- Angular components: `kebab-case.component.{ts,html,scss,spec.ts}`
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

# API
npx nx serve api             # dev server (http://localhost:3000)
npx nx test api              # unit tests
npx nx build api             # production build

# Run all tests
npx nx run-many -t test

# Run all linting
npx nx run-many -t lint
```
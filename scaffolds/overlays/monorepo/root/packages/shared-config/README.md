# `@{{PROJECT_NAME}}/shared-config`

Single source of truth for runtime constants and configuration values consumed by both `apps/api` and `apps/web`.

## Why this package exists

Some values are intrinsically the same on both sides of the wire: feature flags, public route paths, public API base segments, validation thresholds, supported locales, etc. Hardcoding them in two places is a recipe for silent drift; this package is where they live once.

## What goes here

- Public route segments and URL conventions
- Feature flag default values (toggle-able at runtime via env where relevant)
- Supported locales / currencies / timezones list
- Validation thresholds shared by frontend hint + backend rule (e.g. max upload size)
- Magic numbers that the app would reuse in 3+ places

## What does NOT go here

- Secrets, API keys, env values → `.env` files in each app
- Pure types → `@{{PROJECT_NAME}}/shared-types`
- Validation schemas → `@{{PROJECT_NAME}}/shared-validation`
- App-specific UI constants → keep in the consuming app

## Mono-only — no vendored mirror

Unlike `shared-types` / `shared-validation` (which have byte-equal vendored copies under each app's `src/shared-*`), `shared-config` exists **only in the monorepo workspace**. Multirepo apps inline the same literal values per side — see e.g. `apps/api/src/modules/organizations/controllers/organization.controller.ts` which carries the storage MIME / size literals directly when installed in multirepo. A drift-guard test (`src/__tests__/integration/...storage-installer-multirepo*.spec.ts`) makes sure the multirepo path keeps the inlined values and does not accidentally start importing from a `@{{PROJECT_NAME}}/shared-config` that isn't there.

## Module installers may auto-deposit constants here

When a module that ships shared runtime constants is installed via `sf new` or `sf update`, the installer **deposits a file into `src/` and rewires the consumer to import from `@{{PROJECT_NAME}}/shared-config`** — but only on monorepo. Current deposits:

- **Storage module** — writes `src/storage.ts` (`STORAGE_LOGO_MAX_BYTES`, `STORAGE_LOGO_ALLOWED_MIMES`) and rewires `apps/api/.../organization.controller.ts` to consume them. Activation gate: the storage module's `// TODO storage-service-active:` markers must already be uncommented (i.e. the module is fully installed). On multirepo the same controller keeps inlined literals.

These auto-managed files are idempotent — re-running `sf update` won't duplicate them — and you can edit them like any other shared file once they exist (the installer only writes the initial canonical values).

## How to add a new shared constant

1. Create or extend a file under `src/` named after the domain (e.g. `src/locales.ts`).
2. Export the constant from `src/index.ts` so consumers can `import { Foo } from '@{{PROJECT_NAME}}/shared-config'`.
3. Use a strict `as const` literal whenever possible to keep narrow types.
4. Update `apps/api` and/or `apps/web` to consume the constant via the package import.
5. **If multirepo parity matters**, also update the inlined literal in the relevant app file under `scaffolds/blueprints/{api,web}` (or the multirepo overlay) — there is no automatic mirror for `shared-config`.

## Consumption example

```ts
import { SHARED_CONFIG_PLACEHOLDER } from '@{{PROJECT_NAME}}/shared-config'

console.log(`Hello from ${SHARED_CONFIG_PLACEHOLDER}`)
```

Module resolution is handled by npm workspaces — the package is symlinked into the root `node_modules/@{{PROJECT_NAME}}/shared-config` and consumed via its `main`/`types` entries (`dist/index.js` + `dist/index.d.ts`). No tsconfig path alias is required in the consuming apps.

Because consumers read from `dist/`, any edit to this package's source must be followed by a build step before the apps pick it up. `npm run build` at the repo root (which calls `turbo run build`) handles the dependency order automatically.

# `@{{PROJECT_NAME}}/shared-config`

Single source of truth for runtime constants and configuration values consumed by both `apps/api` and `apps/web`.

## Why this package exists

Some values are intrinsically the same on both sides of the wire: feature flags, public route paths, public API base segments, validation thresholds, supported locales, etc. Hardcoding them in two
places is a recipe for silent drift; this package is where they live once.

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

Unlike `shared-types` / `shared-validation` (which have byte-equal vendored copies under each app's `src/shared-*`), `shared-config` exists **only in the monorepo workspace**. Multirepo apps inline
the same literal values per side — see e.g. `apps/api/src/modules/organizations/controllers/organization.controller.ts` which carries the storage MIME / size literals directly when installed in
multirepo. A drift-guard test (`src/__tests__/integration/...storage-installer-multirepo*.spec.ts`) makes sure the multirepo path keeps the inlined values and does not accidentally start importing
from a `@{{PROJECT_NAME}}/shared-config` that isn't there.

## Module installers may auto-deposit constants here

When a module that ships shared runtime constants is installed via `sf new` or `sf update` on a monorepo, its installer **deposits a file into `src/` and rewires the consumer to import it from this
package**. Current deposits:

- **Storage module** — writes `src/storage.ts` (`STORAGE_LOGO_MAX_BYTES`, `STORAGE_LOGO_ALLOWED_MIMES`) and rewires `apps/api/.../organization.controller.ts` to consume them. Activation gate: the
  storage module's `// TODO storage-service-active:` markers must already be uncommented (i.e. the module is fully installed). On multirepo the same controller keeps inlined literals.

These auto-managed files are idempotent — re-running `sf update` won't duplicate them — and you can edit them like any other shared file once they exist (the installer only writes the initial
canonical values).

## How to add a new shared constant

1. Create or extend a file under `src/` named after the domain (e.g. `src/locales.ts`).
2. Export the constant from `src/index.ts` so consumers can `import { Foo } from '@{{PROJECT_NAME}}/shared-config'`.
3. Use a strict `as const` literal whenever possible to keep narrow types.
4. Update `apps/api` and/or `apps/web` to consume the constant via the package import.
5. **If multirepo parity matters**, also update the inlined literal in the relevant app file under `scaffolds/blueprints/{api,web}` (or the multirepo overlay) — there is no automatic mirror for
   `shared-config`.

## Consumption example

```ts
import { SHARED_CONFIG_PLACEHOLDER } from '@{{PROJECT_NAME}}/shared-config'

console.log(`Hello from ${SHARED_CONFIG_PLACEHOLDER}`)
```

Module resolution is handled by npm workspaces: the apps import the package through its symlink in the root `node_modules`, and the `exports` map of `package.json` decides which file each consumer
reads. No tsconfig path alias is required in the consuming apps.

| Consumer                                         | Entry     | File read         | Why                                                                               |
| ------------------------------------------------ | --------- | ----------------- | --------------------------------------------------------------------------------- |
| `apps/web`: Vite dev server and `vite build`     | `browser` | `src/index.ts`    | Vite reads the TypeScript source: named imports work and an edit shows up at once |
| `apps/web` type-check                            | `types`   | `dist/index.d.ts` | The declarations come from the build                                              |
| `apps/api`: NestJS, Jest and any other Node code | `default` | `dist/index.js`   | The API is compiled to CommonJS, and Node never sets the `browser` condition      |

`main` and `types` stay as top-level fields for the resolvers that do not read `exports`, such as the API's `moduleResolution: node`.

**Why `browser` points to the source.** The package is compiled to CommonJS (`module: commonjs`) because the API requires it. Vite serves a linked workspace package as source instead of bundling it,
so without that entry the web dev server hands the browser a CommonJS file (`exports.X = …`, `__exportStar(require('./storage'), exports)`) and the first named import fails with
`The requested module '…/dist/index.js' does not provide an export named '…'`. Pre-bundling the package (`optimizeDeps.include`) avoids the error, but Vite then keeps a copy of the constants until the
dev server restarts with `--force`.

Keep `types` first (TypeScript takes the first condition that matches) and `default` last. Do not add an `import` entry that points to `src/`: Node ESM would load a `.ts` file. Deep imports such as
`@{{PROJECT_NAME}}/shared-config/dist/storage` are not exported: import from the package root.

The type-checker and the API read `dist/`, so an edit to this package's source needs a build before they see it. The web dev server does not. `npm run build` at the repo root (which calls
`turbo run build`) handles the dependency order automatically.

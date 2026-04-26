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

## How to add a new shared constant

1. Create or extend a file under `src/` named after the domain (e.g. `src/locales.ts`).
2. Export the constant from `src/index.ts` so consumers can `import { Foo } from '@{{PROJECT_NAME}}/shared-config'`.
3. Use a strict `as const` literal whenever possible to keep narrow types.
4. Update `apps/api` and/or `apps/web` to consume the constant via the path alias.

## Consumption example

```ts
import { SHARED_CONFIG_PLACEHOLDER } from '@{{PROJECT_NAME}}/shared-config'

console.log(`Hello from ${SHARED_CONFIG_PLACEHOLDER}`)
```

Module resolution is handled by npm workspaces — the package is symlinked into the root `node_modules/@{{PROJECT_NAME}}/shared-config` and consumed via its `main`/`types` entries (`dist/index.js` + `dist/index.d.ts`). No tsconfig path alias is required in the consuming apps.

Because consumers read from `dist/`, any edit to this package's source must be followed by a build step before the apps pick it up. `npm run build` at the repo root (which calls `turbo run build`) handles the dependency order automatically.

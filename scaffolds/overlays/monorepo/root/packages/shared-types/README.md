# `@{{PROJECT_NAME}}/shared-types`

Single source of truth for TypeScript interfaces, type aliases, and enums shared between `apps/api` and `apps/web`.

## Why this package exists

In a monorepo, the same domain shapes (User, Account, Organization, RBAC permissions, etc.) are used on both sides of the wire. Defining them once here removes drift, reduces duplication, and lets `z.infer<typeof schema>` derive types that match the runtime contract.

## What goes here

- Domain interfaces (`User`, `Organization`, `Entity`, `Account`, `Role`, …)
- RBAC types (permission strings, scopes, role enums)
- Cross-cutting type aliases (e.g. `UUID`, `Timestamp`)
- Enums that both backend and frontend need

## What does NOT go here

- Runtime values, constants → `@{{PROJECT_NAME}}/shared-config`
- Validation schemas → `@{{PROJECT_NAME}}/shared-validation`
- React-only or NestJS-only types — keep them in their respective app

## How to add a new shared type

1. Create or extend a file under `src/` named after the domain (e.g. `src/user.ts`).
2. Export the type from `src/index.ts` so consumers can `import { Foo } from '@{{PROJECT_NAME}}/shared-types'`.
3. Update `apps/api` or `apps/web` to consume the new type via the path alias.
4. Run `npm run type-check` from the repo root to verify both apps still compile.

## Consumption example

```ts
import type { SharedTypesPlaceholder } from '@{{PROJECT_NAME}}/shared-types'

function describe(item: SharedTypesPlaceholder): string {
  return `Item ${item.id}`
}
```

The path alias resolution is wired in:

- `apps/api/tsconfig.json` → `paths`
- `apps/web/tsconfig.json` + `tsconfig.app.json` → `paths`

Hot reload works automatically — editing this package's source triggers a recompile in `apps/api` (Nest watch) and HMR in `apps/web` (Vite).

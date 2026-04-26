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

## How types are physically distributed

This package is the **canonical source** for shared TypeScript types. To stay topology-agnostic
(monorepo and multirepo scaffolds emit the same `apps/api` and `apps/web` blueprints), each app
ships a **vendored mirror** of these files under `src/shared-types/` and imports them via the
TS path alias `@shared-types/*`. The CLI's drift-guard test
(`src/__tests__/integration/skill/shared-types-drift.spec.ts`) enforces byte-equality between:

- `scaffolds/overlays/monorepo/root/packages/shared-types/src/` (this directory — canonical)
- `scaffolds/blueprints/api/src/shared-types/` (vendored into every API)
- `scaffolds/blueprints/web/src/shared-types/` (vendored into every Web)

So in a generated **monorepo** the package exists for two reasons:
1. It documents the canonical contract (one place to read/review).
2. It is a real npm workspace so future shared **runtime** code (helpers, constants) can live next
   to the types without re-introducing the topology split.

## How to add a new shared type

1. Create or extend a file under `src/` named after the domain (e.g. `src/user.ts`).
2. Export it from `src/index.ts`.
3. Mirror the changes into both `scaffolds/blueprints/api/src/shared-types/` and
   `scaffolds/blueprints/web/src/shared-types/` (or run the drift test — it will tell you what's
   out of sync).
4. Consumers import via `import type { Foo } from '@shared-types/index'` (the alias is wired in
   each app's `tsconfig.json` / `tsconfig.app.json` / `vite.config.ts`).

## Consumption example

```ts
import type { Organization } from '@shared-types/index'

function describe(org: Organization): string {
  return `${org.name} (${org.type})`
}
```

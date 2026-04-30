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

## Two distribution tracks

There are two ways shared types reach the apps:

1. **Vendored mirror (default for hand-written domain types)** — types ship in
   each app's `src/shared-types/` and are consumed via the TS alias
   `@shared-types/*`. The drift-guard test enforces byte-equality across the
   canonical and the two blueprint copies. This is what the seven domain files
   (`account.ts`, `auth.ts`, `common.ts`, `entity.ts`, `invitation.ts`,
   `organization.ts`) use.

2. **Module-deposited (mono-only)** — when an installer adds a module that
   carries a cross-cutting type, it writes a new file directly into this
   workspace and rewires the consumer to import from
   `@{{PROJECT_NAME}}/shared-types`. No vendored copy exists; multirepo apps
   keep an inlined `interface` per side. Current deposit:

   - **Email module** — writes `src/email.ts` (`EmailOptions`) and rewires
     `apps/api/.../mailersend.service.ts` to import the type. Activation gate:
     the email module's `mailersend.service.ts` must already be installed. On
     multirepo, `mailersend.service.ts` keeps the inlined `export interface
     EmailOptions { ... }`. The drift-guard / multirepo parity assertions in
     `tests/docker/assertions.ts` enforce both behaviors.

   These auto-managed files are idempotent (`sf update` won't duplicate them).

## How to add a new shared type

1. Create or extend a file under `src/` named after the domain (e.g. `src/user.ts`).
2. Export it from `src/index.ts`.
3. **Vendored track**: mirror the changes into both `scaffolds/blueprints/api/src/shared-types/` and
   `scaffolds/blueprints/web/src/shared-types/` (or run the drift test — it will tell you what's
   out of sync). Consumers then import via `@shared-types/index`.
4. **Module-deposit track**: extend the module's installer (`src/installers/<module>.installer.ts`)
   with a deposit function gated on the module's activation marker. The consumer should keep an
   inlined fallback for multirepo, and the installer rewires it to the package import on monorepo.

## Consumption example

```ts
import type { Organization } from '@shared-types/index'

function describe(org: Organization): string {
  return `${org.name} (${org.type})`
}
```

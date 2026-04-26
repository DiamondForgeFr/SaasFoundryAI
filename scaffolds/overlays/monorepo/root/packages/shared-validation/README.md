# `@{{PROJECT_NAME}}/shared-validation`

Single source of truth for Zod schemas consumed by both NestJS DTOs (`apps/api`) and React Hook Form (`apps/web`).

## Why this package exists

In a monorepo, the same input shapes (signup, signin, organization create/update, …) must be validated identically on both sides. Defining the schema once here means the backend pipe and the frontend form share the exact same rules — no drift, no double-source-of-truth, and `z.infer` derives matching types via `@{{PROJECT_NAME}}/shared-types`.

## What goes here

- Business validation schemas (signup, signin, reset-password, organization CRUD, entity CRUD, invitations, …)
- Refinements and transforms shared between both sides
- Custom Zod helpers (e.g. password complexity rule)

## What does NOT go here

- Backend-only validation (admin endpoints with no frontend form) → `apps/api/src/modules/**/dto/`
- Frontend-only widget validation → `apps/web/src/<feature>/`
- Pure types → `@{{PROJECT_NAME}}/shared-types`

## How to add a new shared schema

1. Create or extend a file under `src/` named after the domain (e.g. `src/signup.ts`).
2. Export both the schema and `z.infer` type from `src/index.ts`.
3. On the backend, wrap with the chosen Nest adapter (e.g. `nestjs-zod`'s `createZodDto`) — pattern documented in `architecture-modules.md`.
4. On the frontend, plug into React Hook Form via `zodResolver(schema)`.

## Consumption examples

### NestJS DTO

```ts
import { sharedValidationPlaceholderSchema } from '@{{PROJECT_NAME}}/shared-validation'
// adapter pattern depends on the chosen Zod-Nest bridge — see architecture-modules.md
```

### React Hook Form

```tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { sharedValidationPlaceholderSchema } from '@{{PROJECT_NAME}}/shared-validation'

const form = useForm({ resolver: zodResolver(sharedValidationPlaceholderSchema) })
```

Module resolution is handled by npm workspaces — the package is symlinked into the root `node_modules/@{{PROJECT_NAME}}/shared-validation` and consumed via its `main`/`types` entries (`dist/index.js` + `dist/index.d.ts`). No tsconfig path alias is required in the consuming apps.

Because consumers read from `dist/`, any edit to this package's source must be followed by a build step before the apps pick it up. `npm run build` at the repo root (which calls `turbo run build`) handles the dependency order automatically.

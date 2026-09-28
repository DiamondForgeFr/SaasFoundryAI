# `@{{PROJECT_NAME}}/shared-validation`

Single source of truth for Zod schemas consumed by both NestJS DTOs (`apps/api`) and React Hook Form (`apps/web`).

## Why this package exists

In a monorepo, the same input shapes (signup, signin, organization create/update, …) must be validated identically on both sides. Defining the schema once here means the backend pipe and the frontend form share the exact same rules — no drift, no double-source-of-truth, and `z.infer` derives matching types via `@{{PROJECT_NAME}}/shared-types`.

## What goes here

- Business **request** validation schemas (signup, signin, reset-password, organization CRUD, entity create, invitations, …)
- Refinements and transforms shared between both sides
- Custom Zod helpers (e.g. password complexity rule, locale pattern)

## What does NOT go here

- API **response** schemas — kept in `apps/web` since the backend doesn't validate its own responses (contract is covered by `@{{PROJECT_NAME}}/shared-types`)
- Backend-only validation (admin endpoints with no frontend form) → `apps/api/src/modules/**/dto/`
- Frontend-only widget validation → `apps/web/src/<feature>/`
- Pure types → `@{{PROJECT_NAME}}/shared-types`

## How types are physically distributed

Like `shared-types`, this package is the **canonical source** but the actual files are also vendored
into each app under `src/shared-validation/` and consumed via the TS path alias
`@shared-validation/*`. The CLI's drift-guard test
(`src/__tests__/integration/skill/shared-validation-drift.spec.ts`) enforces byte-equality between:

- `scaffolds/overlays/monorepo/root/packages/shared-validation/src/` (this directory — canonical)
- `scaffolds/blueprints/api/src/shared-validation/` (vendored into every API)
- `scaffolds/blueprints/web/src/shared-validation/` (vendored into every Web)

## The factory pattern (i18n-friendly)

Each schema is exported as a **factory function** that takes an optional `messages` object so each
side plugs in its own copy. Defaults are English; the web app overrides with `i18next`-translated
strings; the API uses the defaults.

```ts
export const buildSignupPayloadSchema = (messages: SignupPayloadMessages = {}) =>
  z.object({
    email: z.string().email({ message: messages.emailInvalid ?? 'Invalid email format' }),
    password: z
      .string()
      .min(8, { message: messages.passwordMinLength ?? 'Password must be at least 8 characters long' })
      .regex(PASSWORD_REGEX, { message: messages.passwordComplexity ?? '…' })
  })

export type SignupPayload = z.infer<ReturnType<typeof buildSignupPayloadSchema>>
```

Type inference is identical on both sides because the schema **shape** is identical — only error
messages differ.

## How to add a new shared schema

1. Create or extend a file under `src/` named after the domain (e.g. `src/auth.ts`).
2. Export the factory function and the inferred payload type from `src/index.ts`.
3. Mirror the changes into both `scaffolds/blueprints/api/src/shared-validation/` and
   `scaffolds/blueprints/web/src/shared-validation/` (or run the drift test — it will tell you
   what's out of sync).
4. NestJS DTO: see the consumption example below.
5. React Hook Form: see the consumption example below.

## Consumption examples

### NestJS DTO (via `nestjs-zod`)

```ts
import { createZodDto } from 'nestjs-zod'
import { buildSignupPayloadSchema } from '@shared-validation/auth'

export class SignUpDto extends createZodDto(buildSignupPayloadSchema()) {}
```

`ZodValidationPipe` is already wired globally in `apps/api/src/main.ts`, so the controller just
takes `@Body() dto: SignUpDto` — validation runs automatically and `dto` is fully typed via
`z.infer`.

### React Hook Form

```tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { buildSignupPayloadSchema, type SignupPayload } from '@shared-validation/auth'

export function SignupForm() {
  const { t } = useTranslation('auth')
  const schema = buildSignupPayloadSchema({
    emailInvalid: t('fields.tk_emailError_'),
    passwordMinLength: t('fields.tk_passwordMinLength_'),
    passwordComplexity: t('fields.tk_passwordComplexityError_')
  })

  const form = useForm<SignupPayload>({ resolver: zodResolver(schema) })
  return <form onSubmit={form.handleSubmit(console.log)}>{/* … */}</form>
}
```

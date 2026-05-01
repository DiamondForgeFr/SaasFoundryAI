# Frontend integration grammar (apps/web)

> **Status: stub.** Filled by Story #308 (S3 — frontend grammar guides). Until that story lands, fall back to mirroring the structure of `apps/web/src/pages/private/dashboard/` (the most complete
> reference page) and use the section anchors below as a checklist for what S3 will eventually expand.

## Pages & routing (anchor)

- Private (auth-gated) pages → `src/pages/private/<feature>/`
- Public pages → `src/pages/public/<feature>/`
- Route declaration: `src/router/routes.tsx`
- Lazy-load: `src/router/lazy-pages.tsx` — every page lazy by default
- Route protection: `src/router/guard.tsx`

## API hooks (anchor)

- **Monorepo**: typed React Query hooks come from `@<project>/api-client/generated/api/<tag>/<tag>` — call `useXxx()` directly. Hand-written wrappers under `src/hooks/api/` only for cross-cutting
  logic (cache key conventions, optimistic updates).
- **Multirepo**: hand-written hooks under `src/hooks/api/<feature>/` — see `src/hooks/api/auth/mutations/useSignIn.ts` for the canonical shape.

## Forms (anchor)

- React Hook Form + `zodResolver` + factory schema from `@shared-validation/<domain>`
- i18n-ready: pass translated `messages` to the schema factory
- Submit handler typed via `z.infer<ReturnType<typeof buildXxxSchema>>`

## UI primitives & theme (anchor)

- **Monorepo**: import from `@<project>/ui-primitives/<name>` (Button, Dialog, Form, …). Theme tokens via `@import "@<project>/ui-primitives/theme.css"` in `src/index.css`.
- **Multirepo**: import from `src/components/ui/shadcn/<name>` (vendored from the same canonical source — drift-guarded by the CLI).
- App-specific compositions (logos, page-loaders, business widgets) → `src/components/`.

## i18n (anchor)

- Translations: YAML under `src/locales/<lang>/<namespace>.yml`
- Hook: `useTranslation('<namespace>')` then `t('key.path')`
- Add a new namespace: create matching files under `src/locales/en/` and `src/locales/fr/`

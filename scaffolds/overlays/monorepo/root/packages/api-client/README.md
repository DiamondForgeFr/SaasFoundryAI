# `@{{PROJECT_NAME}}/api-client`

Auto-generated, fully typed React Query client emitted from the **`apps/api`** OpenAPI specification by [orval](https://orval.dev).

> Adding a new endpoint to NestJS produces a typed hook here after one codegen run. **Never edit files under `src/generated/`** — they are overwritten on every run.

## What's in the package

| Path                               | Owner     | Description                                                                                          |
| ---------------------------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `orval.config.ts`                  | hand      | Codegen configuration. Reads `apps/api/docs/openapi.json`, emits per-tag bundles + shared models.    |
| `src/http-client.ts`               | hand      | Orval mutator — wraps native `fetch` with cookie auth, query-string serialization, and 401 handling. |
| `src/index.ts`                     | hand      | Public re-exports (mutator + helpers). Generated hooks are imported from sub-paths.                  |
| `src/generated/api/<tag>/<tag>.ts` | generated | One file per OpenAPI tag (e.g. `auth`, `users`). Contains `useXxx` React Query hooks.                |
| `src/generated/api/model/*.ts`     | generated | Request/response types deduped across endpoints.                                                     |

## Regenerating the client

The OpenAPI snapshot lives at `apps/api/docs/openapi.json` and is refreshed by booting `apps/api` once (the `ApiDocsService` writes it on startup).

```bash
# from monorepo root
npm run codegen          # turbo task — regenerates packages/api-client/src/generated
```

To regenerate after a controller / DTO change:

1. `npm run dev:api` (boot once so the snapshot updates) — or run the API in a terminal.
2. `npm run codegen`
3. Commit both `apps/api/docs/openapi.json` AND `packages/api-client/src/generated/**` together.

## Using a generated hook in `apps/web`

```tsx
import { useSignIn } from '@{{PROJECT_NAME}}/api-client/generated/api/auth/auth'

function SignInButton() {
  const { mutate, isPending } = useSignIn()
  return <button disabled={isPending} onClick={() => mutate({ data: { email, password, locale: 'EN' } })}>Sign in</button>
}
```

The hook is fully typed: `mutate` payload matches the NestJS DTO, the resolved value matches the response DTO, and the error type carries the `{ status, body }` shape from `http-client.ts`.

## Customizing the base URL or 401 behavior

```ts
import { setApiBaseUrl, setUnauthorizedHandler } from '@{{PROJECT_NAME}}/api-client'

setApiBaseUrl('/api') // default; override for tests, SSR, separate API host
setUnauthorizedHandler(() => {
  // e.g. invalidate authMe, redirect to /login
})
```

Wire these once at app bootstrap (e.g. in `apps/web/src/main.tsx`).

## Why orval (and not openapi-typescript-codegen / tsoa)

- **First-class React Query adapter** — emits `useQuery` / `useMutation` hooks directly, not just typed fetchers we'd have to wrap.
- **Per-tag splitting** keeps bundles small and PR diffs readable.
- **Mutator hook** lets us reuse the existing fetch + cookie auth contract without forking it.
- **Mature, actively maintained**, supports OpenAPI 3.0 / 3.1, has a Zod adapter we may toggle later.

Decision and rationale are also recorded in `.claude/docs/architecture-modules.md`.

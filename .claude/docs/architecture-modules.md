## Module Architecture (CRITICAL — Read when modifying SaaSFoundry)

SaaSFoundry uses a **module system** that allows features to be added during initial project generation (`sf new`) OR later via `sf update`. Understanding this architecture is essential when adding
new modules or modifying existing ones.

### How Modules Work

Each module follows the same pattern:

1. **Blueprint code** contains TODO markers (commented-out code) in `scaffolds/blueprints/`
2. **Overlay files** provide the module's source code in `scaffolds/overlays/modules/`
3. **Installers** (`src/installers/`) contain the logic to activate a module (copy overlays, uncomment markers, update env vars)
4. **Builders** (`src/builders/`) call installers during `sf new`
5. **Update command** (`src/commands/update.ts`) calls the same installers during `sf update`

### TODO Marker Pattern

Blueprint files use TODO markers to hold module-specific code in a disabled state:

```typescript
// In blueprint source files:
// TODO mailer-service-active: import { EmailService } from './email.service'
// TODO storage-service-active: import { StorageModule } from '@modules/storage/storage.module'
// TODO monitoring-active: import { initAnalytics } from '@/lib/analytics/analytics'
```

When a module is installed, the installer removes the `// TODO <marker>: ` prefix, activating the code:

```typescript
// After installation:
import { EmailService } from './email.service'
```

**Marker naming convention**: `// TODO <module-name>-active: `

### Current Modules

| Module               | Installer                               | Marker                   | Overlay Path                  | Affects   |
| -------------------- | --------------------------------------- | ------------------------ | ----------------------------- | --------- |
| **MailerSend Email** | `src/installers/email.installer.ts`     | `mailer-service-active`  | `overlays/modules/email/`     | API only  |
| **S3 Storage**       | `src/installers/storage.installer.ts`   | `storage-service-active` | `overlays/modules/storage/`   | API + Web |
| **Umami Analytics**  | `src/installers/analytics.installer.ts` | `monitoring-active`      | `overlays/modules/analytics/` | Web only  |

### Module Installer Responsibilities

Each installer in `src/installers/` is **fully self-contained** and handles:

1. **Copy overlay files** — Copy module source code from `scaffolds/overlays/modules/` to the target app
2. **Uncomment TODO markers** — Remove `// TODO <marker>: ` prefixes in blueprint files
3. **Update imports/providers** — Register the module in NestJS modules, update imports
4. **Add dependencies** — Modify `package.json` to add required npm packages
5. **Update .env files** — Uncomment and set environment variables in `.env` and `.env.test`
6. **Update CI/CD** — Modify GitHub Actions deployment files if needed

### Manifest (.saasfoundry.json)

Generated projects carry a `.saasfoundry.json` manifest at the project root:

```json
{
  "version": "1.0.0-beta",
  "generatedAt": "2026-03-22T...",
  "structure": "monorepo",
  "projectName": "my-project",
  "modules": {
    "emailService": "none",
    "s3Setup": "manual",
    "dbSetup": "docker",
    "includeAnalytics": false
  },
  "fileHashes": {
    "apps/api/package.json": "abc123...",
    "apps/api/src/main.ts": "def456...",
    "apps/web/src/main.tsx": "ghi789..."
  }
}
```

- **version**: SaaSFoundry CLI version used to generate the project
- **structure**: `monorepo` or `multirepo`
- **modules**: Records which modules are installed and their configuration
- **fileHashes**: SHA-256 hashes of all generated files (for three-way merge during updates)
- **No secrets are stored** — only module choices (none/mailersend, manual/docker/credentials, true/false)

The manifest is:

- Created during `sf new` (in `src/commands/new.ts`) with file hashes computed via `computeFileHashes()`
- Read and updated during `sf update` (in `src/commands/update.ts`)
- Defined by `SaaSFoundryManifest` interface in `src/types.ts`

### Template Update System (Three-Way Merge)

When a user runs `sf update` and their project version differs from the CLI version, the update command performs a **three-way file comparison**:

1. **Regenerate** the project in a temp directory using the current CLI with the same options from the manifest (side effects like npm install and git init are disabled)
2. **Compare** three versions of each file:
   - **Base**: Hash stored in manifest (what was originally generated)
   - **Current**: Hash of the user's current file
   - **Target**: Hash from the regenerated project (what the new CLI produces)
3. **Apply** changes based on the comparison:

| Base vs Current           | Base vs Target               | Action                                                      |
| ------------------------- | ---------------------------- | ----------------------------------------------------------- |
| Same (untouched)          | Different (template changed) | **Auto-update** — safe to replace                           |
| Different (user modified) | Same (template unchanged)    | **Skip** — user's changes are preserved                     |
| Different                 | Different                    | **Conflict** — save as `.saasfoundry.new` for manual review |
| Same                      | Same                         | **Skip** — nothing changed                                  |

**Files excluded from hash tracking** (in `src/utils.ts` → `HASH_IGNORE_PATTERNS`):

- `node_modules/`, `.git/`, `dist/`, `build/`, `.turbo/`, `coverage/`
- `.env`, `.env.test` (contain secrets)
- `package-lock.json`, `.saasfoundry.json`, `.DS_Store`

**Key implementation files:**

- `src/utils.ts` → `computeFileHashes()`, `hashFileContent()`
- `src/commands/update.ts` → `regenerateInTempDir()`, `computeFileUpdates()`, `applyFileUpdates()`

### Files Affected by Each Module

#### Email Module (MailerSend)

| File (in API app)                                             | Change                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------ |
| `src/modules/email/services/mailersend.service.ts`            | **Copied** from overlay                                |
| `src/modules/auth/services/auth.service.ts`                   | TODO markers uncommented                               |
| `src/modules/invitation/services/invitation.service.ts`       | TODO markers uncommented                               |
| `src/configs/env/services/env.service.ts`                     | TODO markers uncommented                               |
| `src/modules/email/services/email.service.ts`                 | All comments uncommented, console.logs removed         |
| `src/modules/email/email.module.ts`                           | MailerSendService import + provider added              |
| `src/modules/email/tests/unit/email.service.disabled-spec.ts` | Renamed to `.spec.ts`                                  |
| `.env`                                                        | `MAILERSEND_*` vars uncommented + set                  |
| `.env.test`                                                   | `MAILERSEND_*` vars uncommented + set with test values |
| `.github/workflows/deployment.yml`                            | `MAILERSEND_*` env vars added                          |

#### Storage Module (S3)

| File (in API app)                                                  | Change                                         |
| ------------------------------------------------------------------ | ---------------------------------------------- |
| `src/modules/storage/`                                             | **Copied** from overlay (entire directory)     |
| `src/configs/env/services/env.service.ts`                          | TODO markers uncommented                       |
| `src/app.module.ts`                                                | TODO markers uncommented                       |
| `src/modules/organizations/organizations.module.ts`                | TODO markers uncommented                       |
| `src/modules/organizations/controllers/organization.controller.ts` | TODO markers uncommented                       |
| `src/modules/organizations/services/organization.service.ts`       | TODO markers uncommented                       |
| `package.json`                                                     | `@aws-sdk/client-s3` + `@types/multer` added   |
| `.env`                                                             | `S3_*` vars uncommented + set                  |
| `.env.test`                                                        | `S3_*` vars uncommented + set with test values |

| File (in Web app) | Change                                 |
| ----------------- | -------------------------------------- |
| `.env`            | `VITE_STORAGE_ENABLED` set to `"true"` |

#### Analytics Module (Umami)

| File (in Web app)    | Change                                                         |
| -------------------- | -------------------------------------------------------------- |
| `src/lib/analytics/` | **Copied** from overlay                                        |
| `src/main.tsx`       | TODO markers uncommented (import + initAnalytics call)         |
| `.env`               | `VITE_ANALYTICS_URL` + `VITE_ANALYTICS_WEBSITE_ID` uncommented |

### Shared Packages (Monorepo Only)

In a monorepo scaffold, the workspace ships three first-class shared packages alongside `apps/api` and `apps/web`. They are NOT optional modules — they are part of the monorepo skeleton and exist
unconditionally. Their purpose is to give every monorepo project a canonical, drift-free home for code that must remain identical on both sides of the wire.

| Package                            | Owns                                          | Consumed by                                                 |
| ---------------------------------- | --------------------------------------------- | ----------------------------------------------------------- |
| `@<projectName>/shared-types`      | Pure TypeScript types and `z.infer` outputs   | `apps/api` (DTO types) + `apps/web` (props, hook responses) |
| `@<projectName>/shared-validation` | Zod schemas (signup, signin, org CRUD, …)     | NestJS DTO adapter + React Hook Form `zodResolver`          |
| `@<projectName>/shared-config`     | Runtime constants (routes, flags, locales, …) | Both `apps/api` and `apps/web`                              |

**Source layout** — `scaffolds/overlays/monorepo/root/packages/shared-{types,validation,config}/`:

- `package.json` declares a private workspace package with scoped name `@{{PROJECT_NAME}}/shared-*` and points `main`/`types` at the compiled `./dist/index.js` + `./dist/index.d.ts`. Consumers read
  the built artefacts.
- `tsconfig.json` emits `./dist` declarations via `tsc` (the package's `build` script).
- `src/index.ts` carries one placeholder export so the type-check pipeline exercises the package even before consumers wire schemas in.
- `README.md` documents the rules: what goes in, what does not, how to add an entry.

**App wiring** — `scaffolds/overlays/monorepo/{api,web}/`:

- `package.json` declares the three packages as workspace deps (`"@<projectName>/shared-*": "*"`). npm workspaces symlinks them into the root `node_modules/@<projectName>/shared-*`, so standard module
  resolution finds the compiled `dist/` entries from both apps. No tsconfig path alias is needed.
- `src/shared-wiring.ts` imports a value, a type and a schema from each package and re-exports a constant. This file is the compile-time proof that the resolution chain is healthy — if any package
  drifts, `tsc -b` fails immediately.
- Build order is handled by Turborepo: the `build` task uses `dependsOn: ["^build"]`, so `apps/api` and `apps/web` only compile after every `packages/shared-*` workspace has produced its `dist/`.

**Placeholder substitution** — the scoped `@{{PROJECT_NAME}}/shared-*` literal is rewritten to the real project name during scaffold via `substitutePlaceholdersInFiles` (`src/utils.ts`). The
substitution pass runs from:

- `src/builders/monorepo.builder.ts` — patches the package files (`package.json`, `README.md`)
- `src/builders/api.builder.ts` — patches `apps/api/{package.json, src/shared-wiring.ts}`
- `src/builders/web.builder.ts` — patches `apps/web/{package.json, src/shared-wiring.ts}`

**Dev-mode caveat** — because consumers read from `dist/`, edits to a shared package's source require a rebuild before `apps/api` (Nest watch) or `apps/web` (Vite HMR) sees the change. `npm run build`
at the root (which calls `turbo run build`) handles the dependency order. A future iteration may wire each package's `tsc --watch` into the root `dev` task.

**Why scoped names** — they avoid collisions with public npm packages and make grep + import autocomplete unambiguous. The convention mirrors how a real organisation would publish internal packages,
even though we keep them `private: true`.

**Multirepo note** — none of this exists in the multirepo topology. Cross-repo sharing is left to the consumer (npm publish, git submodule, …); SaaSFoundry does not assume an opinion there.

### Generated API Client (Monorepo Only)

Alongside the three `shared-*` packages, the monorepo ships a fourth first-class workspace: `@<projectName>/api-client`. Unlike `shared-*` (hand-written contracts), `api-client` is **emitted from the
OpenAPI snapshot** that `apps/api` writes on every Nest boot.

| Path inside `packages/api-client/` | Owner     | Notes                                                                                                                                       |
| ---------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `orval.config.ts`                  | hand      | Codegen configuration. Reads `apps/api/docs/openapi.json`, emits per-tag bundles + a deduped models barrel.                                 |
| `src/http-client.ts`               | hand      | Orval mutator. Wraps `fetch` with cookie auth, query-string serialization, 401 handler. Exposes `setApiBaseUrl` / `setUnauthorizedHandler`. |
| `src/index.ts`                     | hand      | Public re-exports (mutator + helpers).                                                                                                      |
| `src/generated/api/<tag>/<tag>.ts` | generated | One file per OpenAPI tag — `useXxx` React Query hooks. **Never edit; overwritten on every codegen run.**                                    |
| `src/generated/api/model/*.ts`     | generated | Request/response TS types deduped across endpoints.                                                                                         |

**Tool decision — orval (7.x)** chosen during the spike under #342, after evaluating `openapi-typescript-codegen` and `tsoa`:

- First-class React Query adapter — emits typed `useQuery` / `useMutation` hooks directly, no wrapper layer.
- `tags-split` mode keeps PR diffs readable (one file per controller).
- Mutator hook lets us reuse the existing fetch + cookie-auth contract without forking it.
- Mature, actively maintained, supports OpenAPI 3.0 / 3.1, ships a Zod adapter we may toggle later.

**Codegen flow** — `apps/api`'s `ApiDocsService` rewrites `apps/api/docs/openapi.json` on Nest boot. From the monorepo root:

```bash
npm run dev:api          # boots Nest once → snapshot refreshes
npm run codegen          # turbo task → orval emits packages/api-client/src/generated
git add apps/api/docs/openapi.json packages/api-client/src/generated
```

Both the snapshot and the generated tree are committed — the rule is "the OpenAPI snapshot is the contract; the generated client is its reified form."

**Drift detection (pre-commit)** — `npm run codegen:check` runs `scripts/check-codegen-drift.sh`, which:

1. Skips when `apps/api/docs/openapi.json` is missing or when `packages/api-client/src/generated/` already has unstaged changes (don't clobber WIP).
2. Otherwise runs orval against the committed snapshot and `git diff --exit-code` on the generated tree.
3. Fails the commit when the regen output differs — meaning the committed client is stale relative to the OpenAPI snapshot.

The `pre-commit` hook in `.husky/pre-commit` calls `npm run codegen:check` before `npm run test:full`, so a stale client never lands in `develop`.

**Multirepo trade-off** — `api-client` lives only in the monorepo overlay. In multirepo, the OpenAPI snapshot crosses a repo boundary and needs to be published (npm package, GitHub release artefact,
…) before the web repo can consume it. SaaSFoundry's multirepo topology does not ship this wiring out of the box — it's tracked under #304 and may land as an optional module later. For now, multirepo
consumers either keep hand-written hooks or roll their own publish-and-pin flow.

## Shared UI Primitives — `@<projectName>/ui-primitives`

The fifth first-class workspace in a monorepo scaffold is `@<projectName>/ui-primitives` — the shared design-system layer. It hosts ShadCN/Radix headless primitives (`button`, `dialog`, `select`, …),
the Tailwind v4 theme tokens, the `cn()` className helper, and shared UI hooks (`useIsMobile`). Any future second frontend (mobile-web, admin panel) consumes the same primitives without copy-paste.

| Package                        | Contents                                          | Consumed by                                    |
| ------------------------------ | ------------------------------------------------- | ---------------------------------------------- |
| `@<projectName>/ui-primitives` | 27 ShadCN primitives + `theme.css` + `cn` + hooks | `apps/web` (and any future frontend workspace) |

**Source layout** — `scaffolds/overlays/monorepo/root/packages/ui-primitives/`:

- `package.json` — source-only workspace (no `dist/`, no build step), mirroring the `api-client` pattern. `main`/`types` point at `./src/index.ts`. The `exports` field exposes per-primitive subpaths
  (`./button`, `./dialog`, …) so consumers can cherry-pick for tree-shaking, plus `./theme.css` for the Tailwind theme import. Radix, lucide-react, cva, cmdk, clsx, tailwind-merge, and tw-animate-css
  live as `dependencies` here so they no longer pollute `apps/web/package.json`. React + react-hook-form are `peerDependencies`.
- `src/<primitive>.tsx` — the 27 shadcn primitives. Inter-primitive imports use relative paths (`./button` instead of `@/components/ui/shadcn/button`) so the package is self-contained.
- `src/lib/utils.ts` — the `cn()` helper. apps/web no longer ships its own copy.
- `src/hooks/use-is-mobile.ts` — shared hook used by `sidebar.tsx`.
- `src/theme.css` — the Tailwind v4 `@theme` blocks, light/dark CSS variables, and shared keyframes. Apps import this once at their root stylesheet.
- `src/index.ts` — barrel for the utility/hook surface plus a `export *` of each primitive (rarely used; cherry-picking is preferred).

**App wiring** — `scaffolds/overlays/monorepo/web/`:

- `package.json` declares the workspace dep (`"@<projectName>/ui-primitives": "*"`) and no longer carries Radix/lucide/cva/cmdk/clsx/tailwind-merge/tw-animate-css.
- `src/index.css` is reduced to a two-liner: `@import "@<projectName>/ui-primitives/theme.css"` + `@source "../../../node_modules/@<projectName>/ui-primitives/src"`. The `@source` directive tells
  Tailwind v4 to scan the package source so utility classes used inside primitives end up in the final CSS bundle.

**Build-time rewrites** — `src/builders/web.builder.ts` (mono branch only):

1. Substitutes `{{PROJECT_NAME}}` in `apps/web/{package.json, src/index.css, src/shared-wiring.ts}` plus the api-client hook tree.
2. **Deletes** `apps/web/src/components/ui/shadcn/`, `apps/web/src/utils/ui.ts`, and `apps/web/src/hooks/ui/useIsMobile.ts` — these now live in the package.
3. **Rewrites imports** across `apps/web/src/**/*.{ts,tsx}`:
   - `@/components/ui/shadcn/<x>` → `@<projectName>/ui-primitives/<x>`
   - `@/utils/ui` → `@<projectName>/ui-primitives` (the `cn` barrel export)
   - `@/hooks/ui/useIsMobile` → `@<projectName>/ui-primitives`

**Multirepo behavior — strictly untouched** — multirepo apps keep the blueprint copy of `apps/<x>-web/src/components/ui/shadcn/` plus `src/utils/ui.ts` and `src/hooks/ui/useIsMobile.ts`. The
`monorepo.builder.ts` deletions and import rewrites only run when `isMonorepo === true`. A drift-guard test (`src/__tests__/integration/skill/ui-primitives-drift.spec.ts`) enforces byte-equality
between the canonical package copy and the blueprint copy after normalizing the import-path differences, so multirepo never silently lags behind a primitive update made on the package side.

**Placeholder substitution** — the scoped `@{{PROJECT_NAME}}/ui-primitives` literal is rewritten to the real project name in three places by `substitutePlaceholdersInFiles`:

- `src/builders/monorepo.builder.ts` — patches `packages/ui-primitives/{package.json, README.md, src/index.ts, src/theme.css}`
- `src/builders/web.builder.ts` — patches `apps/web/{package.json, src/index.css, src/shared-wiring.ts}` (mono only)

The `assertMonorepoUiPrimitives` Docker assertion (in `tests/docker/assertions.ts`) verifies every step end-to-end on real generated projects, and `assertMultirepoUiPrimitivesUntouched` verifies the
inverse for multirepo.

### Adding a New Module — Checklist

When adding a new optional module to SaaSFoundry, follow these steps:

1. **Create overlay files** in `scaffolds/overlays/modules/<module-name>/`

   - These are the module's source files that get copied to the target app

2. **Add TODO markers** in blueprint files (`scaffolds/blueprints/api/` or `web/`)

   - Use pattern: `// TODO <module-name>-active: <code>`
   - Add markers for imports, function calls, module registrations

3. **Add env vars** (commented out) in blueprint `.env` and `.env.test` files

   - Pattern: `# VAR_NAME="default_value"`

4. **Create installer** in `src/installers/<module-name>.installer.ts`

   - Export a single `install<ModuleName>Module(params)` function
   - Handle: copy overlays, uncomment markers, update env files, add dependencies
   - Must be fully self-contained (callable from both `sf new` and `sf update`)

5. **Update types** in `src/types.ts`

   - Add module option to `Answers` interface
   - Add module option to relevant `Create*Params` interface
   - Add module field to `SaaSFoundryManifest.modules`

6. **Update prompts** in `src/prompts/project.prompts.ts`

   - Add prompt for the new module during `sf new`

7. **Call installer from builder** in `src/builders/api.builder.ts` or `web.builder.ts`

   - Conditionally call the installer based on user's choice

8. **Update `sf new` command** in `src/commands/new.ts`

   - Pass the new option to the builder
   - Include in manifest generation

9. **Update `sf update` support**

   - Add module detection in `src/prompts/update.prompts.ts` → `getAvailableModules()`
   - Add credential prompt function if the module needs configuration
   - Add installation block in `src/commands/update.ts`

10. **Update this CLAUDE.md**
    - Add module to "Current Modules" table
    - Add "Files Affected" section for the new module

## Naming Convention — Tool-Agnostic Capabilities

Some SaaSFoundry capabilities are **tool-agnostic by design**: the capability is the contract, and the tool behind it is swappable (Notion vs. Confluence, GitHub Projects vs. Linear, MailerSend vs.
Resend, …). When you add one, follow this pattern so every capability looks the same from the outside.

**Three layers, one name per layer:**

| Layer               | Shape                                                         | Example (SRS capability, Notion tool)                   |
| ------------------- | ------------------------------------------------------------- | ------------------------------------------------------- |
| Config key          | `tools.<capability>.backend: "<tool>"` in `.saasfoundry.json` | `tools.srs.backend: "notion"`                           |
| TypeScript contract | `<Capability>Adapter` interface                               | `SrsAdapter` in `src/builders/srs/types.ts`             |
| Implementation      | `<Tool><Capability>Adapter` class                             | `NotionSrsAdapter` in `src/tools/notion/srs.adapter.ts` |

**Why the `Adapter` suffix**: the pattern is literally the Adapter pattern — we expose a tool-agnostic contract (`SrsAdapter`) and plug concrete tool bindings (`NotionSrsAdapter`,
`ConfluenceSrsAdapter`, …) behind it. The name should tell the reader that immediately.

**File layout**: contracts live under `src/builders/<capability>/`; tool bindings live under `src/tools/<tool>/<capability>.adapter.ts`. This mirrors the skill architecture
(`.claude/skills/sf-tool-<tool>/` ↔ `src/tools/<tool>/`) so every "how to talk to tool X" concern stays in one folder. Swapping backends = adding a new folder under `src/tools/`, never touching
`src/builders/<capability>/`.

**Anticipated capabilities** (apply the same naming when they land):

- **Ticketing**: `tools.ticketing.backend: "github-projects"` → `TicketingAdapter` / `GithubProjectsTicketingAdapter`
- **Email**: `tools.email.backend: "mailersend"` → `EmailAdapter` / `MailersendEmailAdapter`
- **Analytics**: `tools.analytics.backend: "umami"` → `AnalyticsAdapter` / `UmamiAnalyticsAdapter`

**Skill pairing**: each tool-agnostic capability has an agnostic skill (e.g. `sf-srs`) that orchestrates the flow and dispatches tool-specific work to a tool skill (`sf-tool-notion`). Keep the split —
the agnostic skill never knows which backend it's talking to.

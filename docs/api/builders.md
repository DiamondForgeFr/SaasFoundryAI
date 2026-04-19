# Builders

**Builders** scaffold a single piece of the generated project — the API app, the Web app, a standalone DB service, a standalone S3 service, the monorepo root, or the unified dev-services Docker Compose file. Each one takes a narrow parameter object (see [Types](/api/types)) and copies the relevant blueprint + overlay onto disk.

Every builder is called from `src/commands/new.ts`. The ones that need infra (`DB`, `S3`, `dev-services`) are also reachable independently when the user chooses a stand-alone layout.

## `createApiApp`

```typescript
async function createApiApp(params: CreateApiAppParams): Promise<boolean>
```

Scaffolds the NestJS backend. Copies `blueprints/api/` into the target directory (`apps/{projectName}-api` in multirepo, `apps/api` in monorepo), applies the matching overlay under `overlays/{monorepo|multirepo}/api/`, and customises the scaffolded files.

**What it does:**

- Copies the blueprint + topology overlay (the overlay flips ESLint paths, imports, and Docker references to match mono vs multi)
- Generates five unique JWT secrets and writes them into `.env`
- Substitutes the project name into `package.json`, the database URL, and the email locale files
- Delegates optional module install to [`installEmailModule`](/api/installers#installemailmodule), [`installStorageModule`](/api/installers#installstoragemodule), [`installWorkflowSkill`](/api/installers#installworkflowskill), [`installToolSkill`](/api/installers#installtoolskill)
- Initialises a fresh Git repo in the API directory (multirepo only — monorepo waits for `createMonorepoRoot`)

**Called by:** `new.ts`, first in the sequence after the target directory exists.

## `createWebApp`

```typescript
async function createWebApp(params: CreateWebAppParams): Promise<boolean>
```

Scaffolds the React + Vite frontend. Mirrors the API builder's shape: `blueprints/web/` + topology overlay into `apps/{projectName}-web` (multirepo) or `apps/web` (monorepo).

**What it does:**

- Copies blueprint + overlay
- Flips `VITE_STORAGE_ENABLED=true` in `.env` when the project's S3 setup is non-manual
- Optionally installs the analytics overlay via [`installAnalyticsModule`](/api/installers#installanalyticsmodule)
- Drops `.github/workflows/` in monorepo mode (CI lives at the root in that topology)
- Initialises a fresh Git repo in the Web directory (multirepo only)

**Called by:** `new.ts`, after `createApiApp` and `createDevServicesCompose` (if any).

## `createDbApp`

```typescript
async function createDbApp(params: CreateDbAppParams): Promise<boolean>
```

Scaffolds a **stand-alone** PostgreSQL service backed by Docker Compose. Only used when the user picks a DB-only workspace (rare); the normal flow produces a unified dev-services file instead — see `createDevServicesCompose`.

**What it does:**

- Copies `blueprints/db/` to `apps/{projectName}-db` (multirepo) or `apps/db` (monorepo)
- Substitutes `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, the container name, the health-check query, and the external network into `docker-compose.db.yml`
- Defaults to `db_dev_user / db_dev_password / db_dev` if no credentials are passed

**Called by:** rarely directly; most projects get their DB via `createDevServicesCompose`.

## `createS3App`

```typescript
async function createS3App(params: CreateS3AppParams): Promise<boolean>
```

Same pattern as `createDbApp`, for a MinIO S3 service.

**What it does:**

- Copies `blueprints/s3/` to the target
- Substitutes access key, secret key, bucket name, container name, and network into `docker-compose.s3.yml` (and the `mc admin` init commands)
- Defaults to `minioadmin / minioadmin / {projectName}-uploads` if no credentials are passed

**Called by:** rarely directly; prefer `createDevServicesCompose` for the normal DB + S3 path.

## `createDevServicesCompose`

```typescript
async function createDevServicesCompose(params: CreateDevServicesParams): Promise<boolean>
```

Assembles a single `docker-compose.dev-services.yml` at `params.apiPath` containing **only** the services the user asked for. This is the builder that replaces the DB-only / S3-only builders for the common "I want both DB and S3 in one file" flow.

**What it does:**

- Reads `blueprints/db/docker-compose.db.yml` and `blueprints/s3/docker-compose.s3.yml` directly (no recursive builder call) and extracts the service blocks
- Applies the same substitutions the stand-alone builders would apply (credentials, names, external network)
- Writes one file at `apiPath/docker-compose.dev-services.yml`
- Skipped entirely if both `dbSetup` and `s3Setup` are not `'docker'`

**Called by:** `new.ts` between `createApiApp` and `createWebApp`, conditionally.

## `createMonorepoRoot`

```typescript
async function createMonorepoRoot(params: CreateMonorepoRootParams): Promise<boolean>
```

Only runs when `isMonorepo === true`. Scaffolds the Turborepo root around the already-generated `apps/api` and `apps/web`.

**What it does:**

- Copies `overlays/monorepo/root/` to the project root
- Customises root `package.json` (name, description, repo URL, `packageManager` injection)
- Installs the root workspace once (`npm install` — hoists all app dependencies) and runs `prisma generate` from `apps/api`
- Installs workflow and tool skills at the root (not per-app, since the monorepo shares them)
- Initialises one Git repo at the root with an initial commit

**Called by:** `new.ts`, last of the builders when `isMonorepo === true`.

## Call order

The full builder sequence for a typical `sf new` run:

```text
createApiApp
  └─ (if docker DB or S3) createDevServicesCompose
createWebApp
  └─ (if isMonorepo) createMonorepoRoot
```

DB and S3 builders (`createDbApp`, `createS3App`) are **not** called from `new.ts` — they exist for workspaces that scaffold only an infrastructure service.

## Shared conventions

Patterns every builder honours — match them if you add a new one:

- **Path derivation**: `resolve(blueprintsPath, '<app>')` for templates; `resolve(overlaysPath, '<topology>/<app>')` for overlays. Never join paths by hand.
- **Copy then customise**: use `fs-extra.copy()` for the bulk copy, then `fs/promises` read/write for per-file substitutions. No templating engine — plain `String.prototype.replace` with well-known placeholder tokens.
- **Name validation**: every builder begins with `validateProjectName(params.projectName)` — the same regex that `new.ts` uses.
- **Shell execution**: `shelljs.exec()` wrapped with `getNvmPrefix()` for `nvm`-installed Node hosts. Avoid raw `child_process` so the `nvm` handling stays centralised.
- **No try/catch**: builders let errors propagate. `new.ts` catches them, stops the spinner, and prints a clean message. Don't swallow errors inside a builder.
- **Delegate modules**: optional modules (email, storage, analytics, skills) are installed via dedicated installers — not inline. This keeps builders focused on topology.
- **Return `Promise<boolean>`**: `true` on success, thrown error on failure. The boolean return is historical; callers mostly use the thrown error path.

## Next steps

- [Installers](/api/installers) — the optional module wiring that builders delegate to.
- [Runners](/api/runners) — the post-build orchestration (Docker up, dev servers, terminal windows).
- [Types](/api/types) — the parameter shapes every builder accepts.

# Runners

**Runners** are the post-scaffold orchestration layer. Where [builders](/api/builders) produce files and [installers](/api/installers) patch files, runners **spawn external processes** — Docker
containers, `npm run dev`, a new terminal window, a health-check poll.

They live in `src/runners/` and are called from `src/commands/new.ts` and `src/commands/update.ts` after all files are in place.

## Database runner

### `initAndStartDb`

```typescript
async function initAndStartDb(projectName: string, dbSetup: 'docker' | 'credentials' | 'manual', isMonorepo: boolean, spinner?: Ora): Promise<boolean>
```

Starts PostgreSQL (in Docker) and initialises the schema.

**What it does:**

- Creates the external Docker network (`<projectName>-network`) if it is missing
- Starts the `db-dev` service from `docker-compose.dev-services.yml`
- Runs `npm run db:update:dev -- init_data_base_config --wf --wt --wds` to apply the initial migration + seed workflow data + seed tenant fixtures

Only runs when `dbSetup === 'docker'`. For `'credentials'` or `'manual'`, the CLI prints guidance and exits the runner.

## S3 runner

### `initAndStartS3`

```typescript
async function initAndStartS3(projectName: string, isMonorepo: boolean, spinner?: Ora): Promise<boolean>
```

Starts MinIO + runs the bucket initialiser.

**What it does:**

- Creates the external Docker network if missing
- Starts `s3-dev` and `s3-init` services from `docker-compose.dev-services.yml`
- Suppresses stdout to keep the spinner clean; returns a boolean for the caller to branch on

Only runs when `s3Setup === 'docker'`.

## Server runner

A small family of functions for launching the generated dev servers. `startBackend` / `startFrontend` handle single apps; `startMonorepoApps` fans out via Turborepo.

### `startMonorepoApps`

```typescript
async function startMonorepoApps(choice: 'all' | 'backend' | 'frontend'): Promise<void>
```

Monorepo entry point. Maps `choice` to a Turborepo script:

- `'all'` → `npm run dev`
- `'backend'` → `npm run dev:api`
- `'frontend'` → `npm run dev:web`

Opens one terminal window with the chosen command via [`openTerminal`](#openterminal).

### `startBackend`

```typescript
async function startBackend(projectName: string, isMonorepo: boolean, newTerminal: boolean): Promise<void>
```

Starts the API app.

- `newTerminal: false` → runs `npm run dev` in the current shell via `shelljs.exec`
- `newTerminal: true` → opens a new terminal tab, runs [`getHuskySetupCommand`](#gethuskysetupcommand), then `npm run dev`

Multirepo flow: this is the function `new.ts` calls when the user picks "start apps now".

### `startFrontend`

```typescript
async function startFrontend(projectName: string, isMonorepo: boolean, newTerminal: boolean): Promise<void>
```

Same shape as `startBackend`, for the Web app.

## Terminal runner

Cross-platform terminal-opening + health-check helpers that the other runners delegate to.

### `openTerminal`

```typescript
async function openTerminal(directory: string, options: { command?: string }): Promise<boolean>
```

Opens a new terminal tab (or window) in `directory` with an optional command.

**Detection order:**

- **macOS**: `cmux` → iTerm → Terminal.app (via AppleScript)
- **Windows**: Windows Terminal → cmd.exe
- **Linux / WSL**: `gnome-terminal` → `konsole` → `xterm`

Returns `true` when the spawn succeeds, `false` when every fallback failed. On failure the runner prints the command the user should paste manually — the CLI never silently eats an error here.

### `waitForServer`

```typescript
async function waitForServer(url: string, timeout?: number): Promise<void>
```

Polls `url` every second until the response is `ok` or `timeout` (default 30 000 ms) elapses. Connection errors during polling are silently retried; a timeout throws a descriptive error so the caller
can surface the right guidance ("check Docker is running", etc.).

Primary use: `waitForServer('http://localhost:3000/api/health')` before the CLI prints "Your backend is up".

### `getHuskySetupCommand`

```typescript
function getHuskySetupCommand(extraCommand?: string): string
```

Returns the setup one-liner the `startBackend` / `startFrontend` functions prepend to their dev commands:

```bash
npx husky install; chmod -R +x .husky; chmod -R +x ./scripts/*.sh; <extraCommand>
```

Uses `;` instead of `&&` for AppleScript compatibility (some osascript chains drop `&&`). Chmod failures are tolerated (`|| true`) because they only matter if Husky hooks exist; the dev command always
runs last.

---

## Runners vs installers

| Category      | Changes files? | Spawns processes? | Example                |
| ------------- | -------------- | ----------------- | ---------------------- |
| **Builder**   | Yes            | No                | Copy `blueprints/api/` |
| **Installer** | Yes            | No (mostly)       | Uncomment markers      |
| **Runner**    | No             | Yes               | `docker compose up -d` |

Installers sometimes shell out (e.g. `npm install` for storage) but they do so to finish modifying the project state. Runners shell out to **start** something that stays running (a container, a dev
server, an interactive terminal).

Keep the boundary clean when you add new code. A one-off `gh auth status` probe belongs in a runner. A `sed`-like file rewrite belongs in an installer.

## Next steps

- [Builders](/api/builders) — where scaffolding starts.
- [Installers](/api/installers) — module wiring.
- [Types](/api/types) — the parameter shapes runners receive.

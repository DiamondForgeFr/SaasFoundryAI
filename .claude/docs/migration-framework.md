# Migration framework

> Where: `src/migrations/`. Owner: anyone shipping a breaking change. Status: ships in v2.0.0 (Epic #310). Closes release objective C4.

SaaSFoundryAI runs `sf update` against projects that may be many CLI versions behind. Two things have to migrate together:

1. **Manifest shape** — the `.saasfoundry.json` schema (e.g. renaming a field, restructuring a sub-block).
2. **Module on-disk shape** — files inside the user's project that an installer originally laid down (e.g. renaming a service file, adding a new env var).

Both run through the same registry pattern: a contiguous chain of numbered, single-step migrations the dispatcher walks until it reaches the current target.

---

## Manifest migrations

**Where**: `src/migrations/manifest/NNN-<kebab-name>.ts`.

**Contract** (`src/migrations/manifest/types.ts`):

```ts
export interface ManifestMigration {
  from: number
  to: number
  name: string
  up(manifest: SaaSFoundryManifest): SaaSFoundryManifest
}
```

- `from` and `to` are monotonic; `to === from + 1`.
- `up` is **pure** and **idempotent** — running it twice on its own output must be a no-op. The dispatcher relies on this so a half-applied chain can be re-run safely.
- `up` MUST set `manifestVersion = to` on the returned manifest.

### How to add one

1. Find the next number: `ls src/migrations/manifest/` — the last shipped migration's `to` is your new `from`.
2. Create `NNN-<name>.ts`. Export a `migrationNNN: ManifestMigration`. Keep it small — one schema concern per migration.
3. Register it in `src/migrations/manifest/index.ts` by appending to the `manifestMigrations` array. Order matters: the registry is contiguity- checked at boot.
4. Bump the JSON Schema in `schemas/saasfoundry-manifest.schema.json` so IDE validation matches the new shape.
5. Add a golden fixture pair under `src/__tests__/unit/migrations/fixtures/NNN-<name>/`:
   - `before.json` — a manifest at the `from` shape
   - `after.json` — the same manifest after `up()` runs The harness in `src/__tests__/unit/migrations/golden-fixtures.spec.ts` picks them up automatically.
6. Run `npm run test:pre-commit` to validate the chain end-to-end.
7. Run `npm run test:docker -- --scenario migration-v0-to-current` to exercise the full dispatcher inside a generated project.

### Worked example — renaming a manifest field

`modules.emailService` (flat enum) → `modules.email = { provider, version }` (versioned object). Lifting a flat enum into a versioned object also gives future module migrations a per-module `version`
key to dispatch on.

See:

- Migration: `src/migrations/manifest/002-restructure-email.ts`
- Fixtures: `src/__tests__/unit/migrations/fixtures/002-restructure-email/`
- Schema delta: `email` block added to `schemas/saasfoundry-manifest.schema.json`, `emailService` removed from `required`
- Read sites updated in lockstep: `src/commands/{new,update,modules}.ts`, `scaffolds/skills-templates/tool-saasfoundry/scripts/read-project.js` (latter ships in generated projects — must read both
  shapes for backward compat with un-migrated projects)

The dispatcher logs `Manifest migrated: vX → vY` per run, with one line per applied migration. Idempotent — a second `sf update` is a no-op.

---

## Module migrations

**Where**: declared on the installer via the `migrations: ModuleMigration[]` array exported from each `<name>.installer.ts` (currently empty in v2.0.0 — the framework is what ships).

**Contract** (`src/migrations/module/types.ts`):

```ts
export interface ModuleMigration {
  from: number
  to: number
  name: string
  up(projectDir: string, manifest: SaaSFoundryManifest): Promise<void>
}

export interface ModuleInstaller {
  name: string
  currentVersion: number
  migrations: ModuleMigration[]
}
```

- Same `from`/`to`/`name` discipline as manifest migrations, but per module.
- `up` mutates files in `projectDir`. The dispatcher (not the migration) bumps `manifest.modules.<name>.version` on success.
- Use `writeMigratedFile` from `src/migrations/module/conflict.ts` instead of `fs.writeFile` so user-edited files fall back to a `.saasfoundry.new` sidecar — same UX as the 3-way template merge.

### How to add one

1. Find the next number for the module: `installer.migrations.at(-1)?.to ?? 0` is your new `from`.
2. Add the migration to the installer file's `migrations` array (or pull into a sibling file and re-export — a `migrations/NNN-<name>.ts` folder per installer is fine once the chain grows).
3. Bump the installer's `currentVersion` to match the new `to`.
4. Register a synthetic-fixture integration test in `src/__tests__/integration/commands/update.module-migrations.spec.ts` if the migration touches files (the harness mocks the installer registry so
   you can drop in a single-migration installer for the test).
5. Run `npm run test:pre-commit`.

### Worked example — splitting a service file across two files

You ship `MailerSendService` originally as one file (`mailersend.service.ts`) and decide to split it into a thin entrypoint + helper module (`mailersend.service.ts` + `mailersend.helpers.ts`).

```ts
// src/installers/email.installer.ts
export const emailInstallerMeta: ModuleInstaller = {
  name: 'email',
  currentVersion: 2, // bumped from 1
  migrations: [
    {
      from: 1,
      to: 2,
      name: 'split-mailersend-helpers',
      up: async (projectDir, manifest) => {
        const apiPath = manifest.structure === 'monorepo' ? 'apps/api' : '.'
        const servicePath = `${apiPath}/src/modules/email/services/mailersend.service.ts`
        const helpersPath = `${apiPath}/src/modules/email/services/mailersend.helpers.ts`

        const current = await fs.readFile(`${projectDir}/${servicePath}`, 'utf8')
        const { trimmedService, helpers } = splitOutHelpers(current)

        await writeMigratedFile(projectDir, servicePath, trimmedService, manifest)
        await writeMigratedFile(projectDir, helpersPath, helpers, manifest)
      }
    }
  ]
}
```

If the user has hand-edited `mailersend.service.ts`, both writes land as `.saasfoundry.new` sidecars and the user reconciles manually. If untouched, the migration runs in-place and
`modules.email.version` jumps to 2.

---

## Harness refresh vs module migrations (#451)

Harness deposits (`.claude/skills/sf-*`, `.claude/docs`) follow the CLI version through **FLOW 1b of `sf update`** — a three-way merge (baseline = `manifest.fileHashes` harness subset, current = disk,
target = fresh deposit) scoped to the tracked paths. Routine template improvements (rewording a SKILL.md, adding a doc) ship through this refresh automatically: **no migration needed**.

Reserve `ModuleMigration`s on `harnessInstallerMeta` for **structural** changes to the deposits: renaming a skill directory, splitting a script, removing a file (the refresh never auto-deletes —
`remove` actions are intentionally dropped). Those migrations use `writeMigratedFile` like any module and bump `modules.harness.version`.

Boundaries to respect:

- The `sf-` prefix under `.claude/skills/` is reserved for deposits — user-authored skills outside it are never tracked nor touched.
- `CLAUDE.md` and `.claude/settings.json` are user-owned: managed through targeted merges (workflow-section re-injection, hook merging), never the file sweep.
- Scaffolded projects refresh their harness through FLOW 1 (full template regen) — FLOW 1b only runs on non-scaffold manifests (`isScaffoldManifest()` is the gate; the marker is `modules.email`, never
  the mere presence of the `modules` block).

## When NOT to add a migration

- **Adding a new optional field to the manifest with a sensible default** — the JSON schema keeps validating older manifests; no migration needed.
- **Pure refactor that doesn't change on-disk shape** — fixing a typo in a comment, renaming a variable inside an installer that doesn't reach files in the user's project.
- **Changes only to `sf new`** — migration framework only matters for users upgrading from an older CLI version. New projects start at the latest shape by definition.

If unsure, ask: "Will a project scaffolded one CLI version ago see a correctness regression after `sf update`?" If yes, you need a migration.

---

## Reference: registry layout

```
src/migrations/
├── manifest/
│   ├── 001-add-schema-url.ts
│   ├── 002-restructure-email.ts
│   ├── index.ts            # exports `manifestMigrations` array
│   ├── registry.ts         # `runManifestMigrations`, `targetManifestVersion`
│   └── types.ts            # `ManifestMigration`
└── module/
    ├── conflict.ts         # `writeMigratedFile` (sidecar-aware writer)
    ├── registry.ts         # `runModuleMigrations`
    └── types.ts            # `ModuleMigration`, `ModuleInstaller`

src/installers/
├── registry.ts             # `moduleInstallers` (single source of truth)
└── <name>.installer.ts     # each exports `<name>InstallerMeta`
```

The two dispatchers run in order inside `src/commands/update.ts`: manifest first (so module migrations see the upgraded shape), modules second (so any subsequent template regeneration sees the
post-migration versions).

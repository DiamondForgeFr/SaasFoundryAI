import type { SaaSFoundryManifest } from '../../types'

/**
 * A module migration upgrades an installed module's on-disk shape from one
 * version to the next inside an existing project (e.g. renaming a service file,
 * adding a new env var to `.env`, restructuring a Prisma model).
 *
 * Contract — same shape as `ManifestMigration` but operates on the project
 * directory instead of an in-memory manifest:
 * - `from` and `to` are monotonic integers per module; `to === from + 1`.
 * - `up` runs against the project root and the (already manifest-migrated)
 *   manifest. It MUST be idempotent so a half-applied migration can be re-run
 *   safely on the next `sf update`.
 * - `up` is responsible for any file system changes the new version needs.
 *   Bumping `modules.<name>.version` is owned by the dispatcher (#386), not the
 *   migration itself — keeps the contract symmetric with manifest migrations
 *   where the dispatcher records `appliedMigrations`.
 */
export interface ModuleMigration {
  from: number
  to: number
  name: string
  up(projectDir: string, manifest: SaaSFoundryManifest): Promise<void>
  /**
   * Read-only: what `up` would change, listed by `sf update --dry-run` (#938). It reads the
   * current tree, so a migration that depends on an earlier one in the same chain previews the
   * files before that earlier one runs. A migration without it is listed with `preview: null`.
   */
  preview?(projectDir: string, manifest: SaaSFoundryManifest): Promise<ModuleMigrationPreview[]>
}

/** One change a module migration would make, for the dry-run report. */
export interface ModuleMigrationPreview {
  action: string
  /** Project-relative path, `<path>#<heading>` for a section of a file. */
  source: string
  target?: string
  reason: string
}

/**
 * Metadata each module installer ships alongside its install function so the
 * dispatcher (#386) can wire `currentVersion` into freshly installed modules
 * and replay `migrations` against modules already installed at an older
 * version.
 *
 * `name` matches the key used under `manifest.modules` (e.g. `email`,
 * `storage`). `currentVersion` is what a fresh install stamps on
 * `modules.<name>.version`. `migrations` is ordered: index n must have
 * `from === n` and `to === n + 1`, contiguity-checked the same way as the
 * manifest registry.
 */
export interface ModuleInstaller {
  name: string
  currentVersion: number
  migrations: ModuleMigration[]
}

import { moduleInstallers } from '../../installers/registry'
import type { SaaSFoundryManifest } from '../../types'
import type { ModuleInstaller, ModuleMigration } from './types'

export interface AppliedModuleMigrations {
  module: string
  fromVersion: number
  toVersion: number
  migrations: string[]
}

export interface ModuleMigrationResult {
  applied: AppliedModuleMigrations[]
  manifest: SaaSFoundryManifest
}

/**
 * Walks every entry in `manifest.modules`, looks up the matching installer,
 * filters its migrations to those `from >= installed-version`, and runs them
 * in order. Each migration receives `(projectDir, manifest)` and may mutate
 * files via `writeMigratedFile` (or any other side effect). On success, the
 * dispatcher bumps `manifest.modules.<name>.version` to the migration's `to`
 * — module migrations don't touch the manifest themselves, mirroring how
 * the manifest dispatcher owns `manifestVersion`.
 *
 * Returns the (possibly mutated) manifest and an `applied` summary the caller
 * can log + persist. Modules without an entry in the installer registry are
 * skipped silently — they may be legacy modules removed from the catalogue,
 * and the dispatcher should not crash on them.
 *
 * Idempotent at the chain level: running it twice on a fully-up-to-date
 * project returns `applied: []` and the manifest unchanged.
 */
export async function runModuleMigrations(manifest: SaaSFoundryManifest, projectDir: string): Promise<ModuleMigrationResult> {
  if (!manifest.modules) return { applied: [], manifest }

  const applied: AppliedModuleMigrations[] = []
  // Shallow-clone modules so we don't mutate the input — the new object is
  // re-assigned below only if at least one migration ran.
  const nextModules: Record<string, unknown> = { ...(manifest.modules as Record<string, unknown>) }
  let manifestChanged = false

  for (const [moduleName, moduleEntry] of Object.entries(nextModules)) {
    if (!isVersionedModuleEntry(moduleEntry)) continue

    const installer = moduleInstallers.find((i) => i.name === moduleName)
    if (!installer) continue

    const migrationsToRun = pendingMigrations(installer, moduleEntry.version)
    if (migrationsToRun.length === 0) continue

    const fromVersion = moduleEntry.version
    let runningVersion = fromVersion
    const ranNames: string[] = []

    for (const migration of migrationsToRun) {
      await migration.up(projectDir, manifest)
      runningVersion = migration.to
      ranNames.push(migration.name)
    }

    nextModules[moduleName] = { ...moduleEntry, version: runningVersion }
    manifestChanged = true
    applied.push({ module: moduleName, fromVersion, toVersion: runningVersion, migrations: ranNames })
  }

  const nextManifest = manifestChanged ? { ...manifest, modules: nextModules as SaaSFoundryManifest['modules'] } : manifest

  return { applied, manifest: nextManifest }
}

/**
 * Module entries with no `version` field (e.g. legacy boolean flags or string
 * enums) have no migration chain — only versioned entries participate. This
 * keeps the dispatcher backward-compatible with manifests where some modules
 * haven't yet adopted the `{ provider, version }` envelope.
 */
function isVersionedModuleEntry(entry: unknown): entry is { version: number; [key: string]: unknown } {
  return typeof entry === 'object' && entry !== null && typeof (entry as { version?: unknown }).version === 'number'
}

function pendingMigrations(installer: ModuleInstaller, currentVersion: number): ModuleMigration[] {
  return installer.migrations.filter((m) => m.from >= currentVersion).sort((a, b) => a.from - b.from)
}

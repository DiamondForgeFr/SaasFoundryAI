import type { SaaSFoundryManifest } from '../../types'
import { manifestMigrations } from './index'
import type { ManifestMigration } from './types'

export interface ManifestMigrationRunResult {
  manifest: SaaSFoundryManifest
  appliedMigrations: ManifestMigration[]
  fromVersion: number
  toVersion: number
}

/**
 * Returns the highest `to` value across the registry — i.e. the schema-shape
 * version any newly-generated manifest should claim. Returns 0 when no
 * migrations are registered (defensive — should never happen in production).
 */
export function targetManifestVersion(registry: ManifestMigration[] = manifestMigrations): number {
  if (registry.length === 0) return 0
  return registry[registry.length - 1].to
}

/**
 * Validates that the registry is a contiguous chain starting at 0.
 *
 * Throws if any migration has `to !== from + 1`, if there is a gap between
 * two consecutive migrations, or if the chain does not start at `from = 0`.
 * Called eagerly by `runManifestMigrations` so a malformed registry fails
 * fast at the boundary, before mutating any user manifest.
 */
export function assertContiguousRegistry(registry: ManifestMigration[]): void {
  if (registry.length === 0) return
  let expected = 0
  for (const m of registry) {
    if (m.to !== m.from + 1) {
      throw new Error(`Manifest migration "${m.name}" must have to === from + 1 (got from=${m.from}, to=${m.to}).`)
    }
    if (m.from !== expected) {
      throw new Error(`Manifest migration registry has a gap at version ${expected}: next migration is "${m.name}" (from=${m.from}).`)
    }
    expected = m.to
  }
}

/**
 * Runs every registered migration whose `from` is at or above the manifest's
 * current `manifestVersion` (treating absence as 0). Idempotent at the chain
 * level — a manifest already at the target version is returned unchanged with
 * an empty `appliedMigrations` list.
 *
 * Each migration's `up` is expected to be pure; this function does not catch
 * exceptions — a thrown migration aborts the chain so the caller can persist
 * the partial result up to (but excluding) the failing step if it chooses.
 */
export function runManifestMigrations(manifest: SaaSFoundryManifest, registry: ManifestMigration[] = manifestMigrations): ManifestMigrationRunResult {
  assertContiguousRegistry(registry)

  const fromVersion = manifest.manifestVersion ?? 0
  const target = targetManifestVersion(registry)

  if (fromVersion >= target) {
    return { manifest, appliedMigrations: [], fromVersion, toVersion: fromVersion }
  }

  let current = manifest
  const applied: ManifestMigration[] = []
  for (const m of registry) {
    if (m.from < fromVersion) continue
    current = m.up(current)
    applied.push(m)
  }

  return { manifest: current, appliedMigrations: applied, fromVersion, toVersion: target }
}

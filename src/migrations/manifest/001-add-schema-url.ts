import { manifestSchemaUrl, type SaaSFoundryManifest } from '../../types'
import type { ManifestMigration } from './types'

/**
 * Migration 001: stamp `$schema` URL on legacy manifests.
 *
 * Manifests generated before PR #290 lack the `$schema` pointer, which prevents
 * IDE live validation. This migration adds it (preserving any user override) and
 * sets `manifestVersion = 1` so the dispatcher knows the manifest is up to this
 * shape revision.
 *
 * Replaces the inline `$schema` stamp previously embedded in `sf update` once
 * the dispatcher is wired (see Epic #310 — sub S1.C).
 */
export const migration001: ManifestMigration = {
  from: 0,
  to: 1,
  name: 'add-schema-url',
  up(manifest) {
    const next: SaaSFoundryManifest = manifest.$schema ? { ...manifest } : { $schema: manifestSchemaUrl, ...manifest }
    next.manifestVersion = 1
    return next
  }
}

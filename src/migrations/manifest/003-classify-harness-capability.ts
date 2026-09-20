import { hasManagedHarnessEvidence } from '../../project-capabilities'
import type { SaaSFoundryManifest } from '../../types'
import type { ManifestMigration } from './types'

/**
 * Distinguish common/core deposits from the complete collaboration harness.
 * Ambiguous legacy manifests remain unknown until an explicit user action.
 */
export const migration003: ManifestMigration = {
  from: 2,
  to: 3,
  name: 'classify-harness-capability',
  up(manifest) {
    const next: SaaSFoundryManifest = { ...manifest, manifestVersion: 3 }
    const harness = manifest.modules?.harness
    if (harness?.managed === undefined && hasManagedHarnessEvidence(manifest)) {
      next.modules = {
        ...manifest.modules,
        harness: { ...(harness ?? { version: 0 }), managed: true }
      }
    }
    return next
  }
}

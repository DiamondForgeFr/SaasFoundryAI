import type { SaaSFoundryManifest } from '../../types'

/**
 * A manifest migration upgrades a manifest from one schema-shape version to the next.
 *
 * Contract:
 * - `from` and `to` are monotonic integers; `to === from + 1`.
 * - `up` MUST be pure and idempotent: running it twice on the same input yields
 *   the same output as running it once. The dispatcher relies on this so a half-
 *   applied migration can be re-run safely.
 * - `up` MUST set `manifestVersion = to` on the returned manifest.
 */
export interface ManifestMigration {
  from: number
  to: number
  name: string
  up(manifest: SaaSFoundryManifest): SaaSFoundryManifest
}

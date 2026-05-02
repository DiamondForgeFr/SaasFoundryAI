import type { SaaSFoundryManifest } from '../../types'
import type { ManifestMigration } from './types'

/**
 * Migration 002: restructure `modules.emailService` (flat enum) into the
 * versioned `modules.email = { provider, version }` shape introduced in
 * manifestVersion 2.
 *
 * Why: per-module migrations (Epic #310 — S3.B/S3.C) need a place to record
 * the installed module version. Lifting the email setting from a bare enum
 * into an object is the smallest change that lets future module migrations
 * dispatch off `email.version` without another schema bump.
 *
 * The legacy `emailService` field is removed — the JSON schema rejects
 * unknown properties at the modules level, so leaving it would fail
 * post-migration validation.
 */
export const migration002: ManifestMigration = {
  from: 1,
  to: 2,
  name: 'restructure-email',
  up(manifest) {
    const next: SaaSFoundryManifest = { ...manifest, manifestVersion: 2 }

    if (manifest.modules) {
      // The pre-migration shape has `emailService` (flat) but the post-migration
      // type does not — read it through a defensive cast that does not assume
      // either shape, so the migration is safe to run on partially-migrated
      // input (e.g. hand-edited manifests).
      const legacyModules = manifest.modules as typeof manifest.modules & { emailService?: 'none' | 'mailersend' }
      const provider = legacyModules.email?.provider ?? legacyModules.emailService ?? 'none'

      const { emailService: _drop, ...rest } = legacyModules
      void _drop
      next.modules = {
        ...rest,
        email: { provider, version: 1 }
      }
    }

    return next
  }
}

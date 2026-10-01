import type { SaaSFoundryManifest } from '../../types'
import type { ManifestMigration } from './types'

/** Placeholders the workflow guards accept as the ticket number in a branch pattern. */
const TICKET_PLACEHOLDER = /\{(?:N|ticket|number|issue-number)\}/

/**
 * `feature/{name}` → `feature/{N}-{description}`. A pattern that already names the ticket,
 * or carries neither `{name}` nor `{description}`, is left as written.
 */
function ticketScoped(pattern: string | undefined): string | undefined {
  if (typeof pattern !== 'string' || TICKET_PLACEHOLDER.test(pattern)) return pattern
  if (pattern.includes('{name}')) return pattern.replace('{name}', '{N}-{description}')
  if (pattern.includes('{description}')) return pattern.replace('{description}', '{N}-{description}')
  return pattern
}

/**
 * The workflow guards find a ticket's pull request from `workflow.branchNaming` and discard
 * every pattern without a ticket placeholder. #480 moved new projects to
 * `feature/{N}-{description}`, but manifests written before it kept `feature/{name}` and
 * `fix/{name}`, so no pull request ever matched and `update-status` refused In Review and
 * Done on every migrated project (#864).
 */
export const migration004: ManifestMigration = {
  from: 3,
  to: 4,
  name: 'ticket-scoped-branch-naming',
  up(manifest) {
    const next: SaaSFoundryManifest = { ...manifest, manifestVersion: 4 }
    const branchNaming = manifest.workflow?.branchNaming
    if (manifest.workflow && branchNaming) {
      const migrated = { ...branchNaming }
      for (const kind of ['feature', 'fix'] as const) {
        if (branchNaming[kind] !== undefined) migrated[kind] = ticketScoped(branchNaming[kind])
      }
      next.workflow = { ...manifest.workflow, branchNaming: migrated }
    }
    return next
  }
}

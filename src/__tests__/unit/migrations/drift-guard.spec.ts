import { readFileSync } from 'fs'
import { join } from 'path'

import { targetManifestVersion } from '../../../migrations/manifest/registry'

/**
 * Drift-guard for the migration framework (Sub #388 stretch goal).
 *
 * Snapshots the top-level keys of `SaaSFoundryManifest` paired with the
 * current `targetManifestVersion()`. Any structural edit to the interface
 * forces the contributor to either revert the change or ship a numbered
 * manifest migration (which bumps the target). Both arms of the snapshot
 * must move together — that is the invariant the migration framework
 * relies on (`.claude/docs/migration-framework.md`).
 */

function extractTopLevelKeys(): string[] {
  const source = readFileSync(join(__dirname, '../../../types.ts'), 'utf8')
  const match = source.match(/export interface SaaSFoundryManifest \{([\s\S]*?)\n\}/)
  if (!match) throw new Error('Could not locate SaaSFoundryManifest interface in src/types.ts')
  const body = match[1]
  const keys: string[] = []
  let depth = 0
  for (const rawLine of body.split('\n')) {
    const line = rawLine.replace(/\/\/.*$/, '').trim()
    if (!line) continue
    if (depth === 0) {
      const keyMatch = line.match(/^(\$?\w+)\??\s*:/)
      if (keyMatch) keys.push(keyMatch[1])
    }
    for (const ch of line) {
      if (ch === '{') depth++
      else if (ch === '}') depth--
    }
  }
  return keys
}

describe('SaaSFoundryManifest drift-guard', () => {
  it('top-level shape and targetManifestVersion stay in lock-step', () => {
    const snapshot = {
      targetVersion: targetManifestVersion(),
      keys: extractTopLevelKeys()
    }
    expect(snapshot).toEqual({
      targetVersion: 2,
      // mainBranch and language added without a version bump: new OPTIONAL fields with
      // read-site fallbacks — the "no migration needed" case of migration-framework.md.
      // For `language`, an absent block resolves exactly like one pinning "en"
      // (`resolveOutputLanguages`), so no project can regress by not having it.
      // `ports` (#584) is the same case: an absent block reads back as DEFAULT_PORTS,
      // which is the only set of ports a project scaffolded before it could have used.
      keys: [
        '$schema',
        'manifestVersion',
        'version',
        'generatedAt',
        'structure',
        'projectName',
        'mainBranch',
        'ports',
        'modules',
        'language',
        'skillsAccounts',
        'fileHashes',
        'workflow',
        'aiRules',
        'tools'
      ]
    })
  })
})

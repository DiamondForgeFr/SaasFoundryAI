import { readFile } from 'fs/promises'
import { join, resolve } from 'path'

import { planCodexInstructionLimit, recordsReferenceOnlyBridge, withGeneratedInstructions } from './agent-instructions'
import { planClaudeMdMigration } from './claude-md-migration'
import type { SaaSFoundryManifest } from '../types'

/** One `.codex/config.toml` the real `sf update` would raise `project_doc_max_bytes` in (#1154). */
export interface CodexInstructionLimitPreview {
  /** The config file, relative to the project root. */
  path: string
  /** The value it holds today, if any. */
  from?: number
  /** The value the update writes. */
  to: number
  /** The directory whose AGENTS.md chain is the longest, relative to its checkout. */
  directory: string
  /** Bytes Codex would load there once the update has run. */
  bytes: number
}

/**
 * What `sf update --dry-run` announces about Codex's instruction limit. The real update raises it while
 * refreshing the agent instructions, after its module migrations ran; the preview measures the AGENTS.md
 * files as they will be by then: the CLAUDE.md → AGENTS.md move when it is pending (`migrationPending`),
 * and the generated region refreshed. Read-only.
 */
export async function previewCodexInstructionLimits(projectDir: string, manifest: SaaSFoundryManifest, migrationPending: boolean): Promise<CodexInstructionLimitPreview[]> {
  if (!manifest.modules?.harness?.agents?.includes('codex') || recordsReferenceOnlyBridge(manifest.fileHashes)) return []
  const root = resolve(projectDir)
  const pending = new Map<string, Buffer>()
  if (migrationPending) {
    const plan = await planClaudeMdMigration(root, manifest)
    for (const dir of plan.dirs) {
      if (dir.outcome === 'migrate' && dir.agentsContent !== undefined) pending.set(join(root, dir.dir, 'AGENTS.md'), Buffer.from(dir.agentsContent))
    }
  }
  // The same checkouts the update refreshes: each multirepo app is its own root.
  const targets = manifest.structure === 'multirepo' ? [`apps/${manifest.projectName}-api`, `apps/${manifest.projectName}-web`] : ['.']
  const previews: CodexInstructionLimitPreview[] = []
  for (const target of targets) {
    const agentsPath = join(root, target, 'AGENTS.md')
    const current = pending.get(agentsPath) ?? (await readFile(agentsPath).catch(() => undefined))
    const refreshed = current && withGeneratedInstructions(current.toString('utf8'))
    if (refreshed !== undefined) pending.set(agentsPath, Buffer.from(refreshed))
    const targetManifest = target === '.' ? manifest : { structure: 'cli' }
    const { change } = await planCodexInstructionLimit(join(root, target), targetManifest, pending)
    if (change) previews.push({ ...change, path: target === '.' ? change.path : `${target}/${change.path}` })
  }
  return previews
}

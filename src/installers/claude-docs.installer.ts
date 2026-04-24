import { copy } from 'fs-extra'
import { mkdir } from 'fs/promises'
import { join } from 'path'

import { scaffoldsDocsPath } from '../types'

interface InstallClaudeDocsParams {
  targetPath: string
}

/**
 * Install the shared skill docs referenced by scaffolded SKILL.md files.
 *
 * Skills reference cross-cutting docs via `../../docs/<file>.md` (relative) or
 * `.claude/docs/<file>.md` (absolute). Without this installer those links 404
 * in generated projects.
 */
export async function installClaudeDocs({ targetPath }: InstallClaudeDocsParams) {
  const targetDocsPath = join(targetPath, '.claude', 'docs')
  await mkdir(targetDocsPath, { recursive: true })
  await copy(scaffoldsDocsPath, targetDocsPath)
}

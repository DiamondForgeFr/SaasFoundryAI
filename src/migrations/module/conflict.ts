import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'

import type { SaaSFoundryManifest } from '../../types'
import { hashFileContent } from '../../utils'

export type WriteOutcome = 'inplace' | 'sidecar' | 'created'

/**
 * Conflict-aware writer module migrations should use instead of `fs.writeFile`
 * when mutating files in the user's project. Mirrors the 3-way merge UX from
 * `sf update`'s template-update flow:
 *
 * 1. New file (no entry in `manifest.fileHashes`)             → write in-place,
 *    return `'created'`.
 * 2. Tracked file matching its recorded hash (no user edits)  → write in-place,
 *    return `'inplace'`.
 * 3. Tracked file whose current hash diverges from the recorded one (user
 *    edited it)                                                → write to
 *    `<path>.saasfoundry.new`, return `'sidecar'`. The user reconciles the
 *    sidecar manually, same as for template updates.
 *
 * Migrations stay pure with respect to user intent: we never silently overwrite
 * customised code.
 */
export async function writeMigratedFile(projectDir: string, relPath: string, newContent: string, manifest: SaaSFoundryManifest): Promise<WriteOutcome> {
  const fullPath = join(projectDir, relPath)
  const tracked = manifest.fileHashes?.[relPath]

  if (tracked && existsSync(fullPath)) {
    const current = await readFile(fullPath, 'utf8')
    if (hashFileContent(current) !== tracked) {
      await mkdir(dirname(fullPath), { recursive: true })
      await writeFile(`${fullPath}.saasfoundry.new`, newContent)
      return 'sidecar'
    }
    await writeFile(fullPath, newContent)
    return 'inplace'
  }

  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, newContent)
  return tracked ? 'inplace' : 'created'
}

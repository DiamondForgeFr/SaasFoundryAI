import chalk from 'chalk'
import { existsSync } from 'fs'
import { readdir, readFile, rmdir, unlink } from 'fs/promises'
import { join } from 'path'

import type { ModuleMigration } from '../migrations/module/types'
import { hasTechnicalStack } from '../project-capabilities'
import { hashFileContent } from '../utils'
import { STACK_SKILLS } from './core-skills.installer'

/** Where a deposited skill lives: the Claude copy first, then the shared-agent mirror projected from it. */
const SKILL_ROOTS = ['.claude/skills', '.agents/skills'] as const

/**
 * harness v1 → v2 (#831). Harness v1 deposited `sf-integration-rules` on every
 * project, and on a codebase without the generated stack it triggers on generic
 * requests ("add a module") with conventions that do not apply. The refresh
 * never deletes a file, so this migration removes what the harness deposited:
 *
 * - only files tracked in `fileHashes` whose content still matches — an edited
 *   copy, or a file the harness never deposited, is kept and reported;
 * - a mirror under `.agents/skills` only once its `.claude` source is gone,
 *   since the mirror is re-projected from it on every update;
 * - never on a project with a technical stack, where the skill belongs.
 *
 * The removed files leave `fileHashes` with them. Idempotent: a second run
 * finds no tracked entry left.
 */
export const dropStackSkillsWithoutStack: ModuleMigration = {
  from: 1,
  to: 2,
  name: 'drop-stack-skills-without-stack',
  up: async (projectDir, manifest) => {
    if (hasTechnicalStack(manifest) || !manifest.fileHashes) return
    const hashes = manifest.fileHashes
    const kept: string[] = []
    const removed: string[] = []

    for (const skill of STACK_SKILLS) {
      for (const root of SKILL_ROOTS) {
        const skillDir = `${root}/${skill}`
        for (const relPath of Object.keys(hashes).filter((path) => path.startsWith(`${skillDir}/`))) {
          const fullPath = join(projectDir, relPath)
          if (!existsSync(fullPath)) {
            delete hashes[relPath]
            continue
          }
          // A mirror whose source was kept is projected again from it: it stays, and the source is what is reported
          if (root === '.agents/skills' && existsSync(join(projectDir, '.claude/skills', relPath.slice('.agents/skills/'.length)))) continue
          if (hashFileContent(await readFile(fullPath)) !== hashes[relPath]) {
            kept.push(relPath)
            continue
          }
          await unlink(fullPath)
          delete hashes[relPath]
          removed.push(relPath)
        }
        if (root === '.claude/skills') kept.push(...(await untrackedFiles(projectDir, skillDir, hashes)))
        await removeEmptyDirs(join(projectDir, skillDir))
      }
    }

    if (removed.length > 0) console.log(chalk.gray(`  Removed ${removed.length} file(s) of ${STACK_SKILLS.join(', ')}: it describes the generated SaaS stack, which this project does not have.`))
    if (kept.length > 0) {
      console.log(chalk.yellow(`  Kept ${STACK_SKILLS.join(', ')} files you edited or added — delete them if this project has no generated SaaS stack:`))
      for (const path of [...new Set(kept)].sort()) console.log(chalk.yellow(`    • ${path}`))
    }
  }
}

export const harnessMigrations: ModuleMigration[] = [dropStackSkillsWithoutStack]

/** Files under `dir` with no `fileHashes` entry: not deposited by the harness, so never removed. */
async function untrackedFiles(projectDir: string, dir: string, hashes: Record<string, string>): Promise<string[]> {
  const found: string[] = []
  const walk = async (relDir: string): Promise<void> => {
    const entries = await readdir(join(projectDir, relDir), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const relPath = `${relDir}/${entry.name}`
      if (entry.isDirectory()) await walk(relPath)
      else if (!(relPath in hashes)) found.push(relPath)
    }
  }
  await walk(dir)
  return found
}

/** Remove `dir` and its subdirectories bottom-up, stopping at the first one that still holds a file. */
async function removeEmptyDirs(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null)
  if (!entries) return
  for (const entry of entries) if (entry.isDirectory()) await removeEmptyDirs(join(dir, entry.name))
  if ((await readdir(dir)).length === 0) await rmdir(dir)
}

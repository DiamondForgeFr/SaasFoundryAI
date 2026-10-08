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

/**
 * Every version of the per-app `.claude/` files the api and web blueprints ever
 * shipped, by sha256. A monorepo copied them into `apps/{api,web}/.claude/` until
 * #425; a file still matching one of these was never edited.
 */
const SHIPPED_PER_APP_CLAUDE: Record<string, string[]> = {
  'settings.json': ['09b82b52a1ef0a4f38ca0e9a191bdf59494ae85414e9415e1db010194cce9d94', '5b70f3a0ba1389474f0cf4a5344f2b67e3d8b5b565fa3bf726fed761a08fd79e'],
  'README.md': [
    '3de8b4ba4238fe575cdf1035216388f3f9ba90b03916fbd125fbc73a8f65e6e0',
    '6131510f86d99976e9b00c895d9bac26041da4e6638c8321a7e09b3e091b09fe',
    '6682d728953167633a4c96afa691d8fd1bec3909e117f4185d05b65685233b1b',
    '6f22c3772ff25248c4ec7ac75ea3b550f7184a8df3291fcfe0126fc0848b36de',
    '8a2d0055a6fce90a15c9c267a57bfa42b77d73766b48b85e4a60b7a6f1d90f7b',
    '9d38ab654d15539321a49746626a30faadb3597d5381b4ab00d088dfaeef62b6',
    'ae271c504ecdf7b2a624e19b1e851c5ad06e1ae08c6253ac71d693e2ad99a14f',
    'bffdfadd6ba1a085586c030b553de44f8063a5f3eeef1f4f28159554c8e1967c',
    'c9c55af2de399d523b73dda65098c30321232ec1f8b85377cd60a58d47166e66'
  ]
}

/**
 * harness v2 → v3 (#425). A monorepo has a single `.claude/`, at its root, but
 * the api and web blueprints used to leave a copy in each app: a second
 * `SessionStart` hook and a README listing skills the app does not hold.
 *
 * Only files identical to a shipped version are removed; anything edited or
 * added is kept and reported. Multirepo projects are untouched: each repository
 * is a root. Idempotent: a second run finds nothing to remove.
 */
export const dropPerAppClaudeInMonorepo: ModuleMigration = {
  from: 2,
  to: 3,
  name: 'drop-per-app-claude-in-monorepo',
  up: async (projectDir, manifest) => {
    if (manifest.structure !== 'monorepo') return
    const removed: string[] = []
    const kept: string[] = []
    for (const app of ['apps/api', 'apps/web']) {
      const claudeDir = `${app}/.claude`
      if (!existsSync(join(projectDir, claudeDir))) continue
      for (const [name, hashes] of Object.entries(SHIPPED_PER_APP_CLAUDE)) {
        const relPath = `${claudeDir}/${name}`
        const fullPath = join(projectDir, relPath)
        if (!existsSync(fullPath)) continue
        if (hashes.includes(hashFileContent(await readFile(fullPath)))) {
          await unlink(fullPath)
          removed.push(relPath)
        }
      }
      kept.push(...(await untrackedFiles(projectDir, claudeDir, {})))
      await removeEmptyDirs(join(projectDir, claudeDir))
    }

    if (removed.length > 0) console.log(chalk.gray(`  Removed ${removed.length} per-app .claude file(s): a monorepo keeps its Claude configuration at the root.`))
    if (kept.length > 0) {
      console.log(chalk.yellow('  Kept per-app .claude files you edited or added — move what you need to the root .claude/, then delete them:'))
      for (const path of kept.sort()) console.log(chalk.yellow(`    • ${path}`))
    }
  }
}

export const harnessMigrations: ModuleMigration[] = [dropStackSkillsWithoutStack, dropPerAppClaudeInMonorepo]

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

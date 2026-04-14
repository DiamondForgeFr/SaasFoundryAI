import { copy } from 'fs-extra'
import { mkdir } from 'fs/promises'
import { join } from 'path'

import { skillsTemplatesPath } from '../types'

interface InstallCoreSkillsParams {
  targetPath: string
}

/**
 * Install core skills from centralized template.
 *
 * Core skills are ALWAYS installed (not optional).
 * These are the 6 essential skills:
 * - sf-git-commit
 * - sf-git-create-pr
 * - sf-git-fix-pr-comments
 * - sf-git-merge
 * - sf-utils-fix-errors
 * - sf-utils-fix-grammar
 *
 * For monorepo: Installed once at root/.claude/skills/
 * For multirepo: Installed separately in api/.claude/skills/ and web/.claude/skills/
 *
 * This is a COPY operation - skills are copied to the target project
 * (unlike tool skills which may be installed dynamically)
 */
export async function installCoreSkills({ targetPath }: InstallCoreSkillsParams) {
  const coreTemplatesPath = join(skillsTemplatesPath, 'core')
  const targetSkillsPath = join(targetPath, '.claude', 'skills')

  // Ensure skills directory exists
  await mkdir(targetSkillsPath, { recursive: true })

  // List of core skills to install (must match scaffolds/skills-templates/core/)
  const coreSkills = ['sf-git-commit', 'sf-git-create-pr', 'sf-git-fix-pr-comments', 'sf-git-merge', 'sf-utils-fix-errors', 'sf-utils-fix-grammar']

  // Copy each core skill
  for (const skill of coreSkills) {
    const skillTemplatePath = join(coreTemplatesPath, skill)
    const skillTargetPath = join(targetSkillsPath, skill)
    await copy(skillTemplatePath, skillTargetPath)
  }
}

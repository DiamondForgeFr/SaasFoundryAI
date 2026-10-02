import { copy } from 'fs-extra'
import { mkdir } from 'fs/promises'
import { join } from 'path'

import type { ModuleInstaller } from '../migrations/module/types'
import { skillsTemplatesPath } from '../types'

export const coreSkillsInstallerMeta: ModuleInstaller = {
  name: 'core-skills',
  currentVersion: 1,
  migrations: []
}

/**
 * Core skills that describe the generated NestJS/React/Prisma stack. On a
 * codebase without that stack they trigger on generic requests ("add a
 * module") and push conventions that do not apply (#831).
 */
export const STACK_SKILLS = ['sf-integration-rules']

interface InstallCoreSkillsParams {
  targetPath: string
  /** False on a project without a generated technical stack: the stack skills are left out. */
  includeStackSkills?: boolean
}

/**
 * Install core skills from centralized template.
 *
 * Core skills are ALWAYS installed (not optional), except the STACK_SKILLS on
 * a project without a generated technical stack. These are the 7 essential skills:
 * - sf-git-commit
 * - sf-git-create-pr
 * - sf-git-fix-pr-comments
 * - sf-git-merge
 * - sf-utils-fix-errors
 * - sf-utils-fix-grammar
 * - sf-integration-rules
 *
 * For monorepo: Installed once at root/.claude/skills/
 * For multirepo: Installed separately in api/.claude/skills/ and web/.claude/skills/
 *
 * This is a COPY operation - skills are copied to the target project
 * (unlike tool skills which may be installed dynamically)
 */
export async function installCoreSkills({ targetPath, includeStackSkills = true }: InstallCoreSkillsParams) {
  const coreTemplatesPath = join(skillsTemplatesPath, 'core')
  const targetSkillsPath = join(targetPath, '.claude', 'skills')

  // Ensure skills directory exists
  await mkdir(targetSkillsPath, { recursive: true })

  // List of core skills to install (must match scaffolds/skills-templates/core/)
  const coreSkills = ['sf-git-commit', 'sf-git-create-pr', 'sf-git-fix-pr-comments', 'sf-git-merge', 'sf-utils-fix-errors', 'sf-utils-fix-grammar', 'sf-integration-rules']

  // Copy each core skill
  for (const skill of coreSkills.filter((name) => includeStackSkills || !STACK_SKILLS.includes(name))) {
    const skillTemplatePath = join(coreTemplatesPath, skill)
    const skillTargetPath = join(targetSkillsPath, skill)
    await copy(skillTemplatePath, skillTargetPath)
  }
}

import { copy } from 'fs-extra'
import { mkdir } from 'fs/promises'
import { join } from 'path'

import { skillsTemplatesPath } from '../types'

interface InstallOptionalSkillsParams {
  targetPath: string
  selectedSkills: string[]
}

/**
 * Install optional advanced skills from centralized template.
 *
 * This function:
 * 1. Copies selected optional skills from scaffolds/skills-templates/optional/
 * 2. Installs them in .claude/skills/ (same as core skills for Claude Code recognition)
 *
 * Optional skills are advanced integrations that enhance workflow:
 * - sf-tool-context7 - Library documentation (free)
 * - sf-tool-atlassian - Jira/Confluence integration
 * - sf-tool-notion - Notion workspace integration
 * - sf-tool-figma - Figma design system integration
 *
 * For monorepo: Installed once at root/.claude/skills/
 * For multirepo: Installed separately in each app's .claude/skills/
 *
 * These skills are installed AFTER core skills.
 * They appear in the generated project's CLAUDE.md as optional enhancements.
 *
 * IMPORTANT: Skills MUST be in .claude/skills/ to be recognized by Claude Code.
 */
export async function installOptionalSkills({ targetPath, selectedSkills }: InstallOptionalSkillsParams) {
  if (selectedSkills.length === 0) {
    return // No optional skills selected
  }

  const optionalTemplatesPath = join(skillsTemplatesPath, 'optional')
  const targetSkillsPath = join(targetPath, '.claude', 'skills')

  // Ensure skills directory exists
  await mkdir(targetSkillsPath, { recursive: true })

  // Copy each selected skill
  for (const skill of selectedSkills) {
    // Map skill names to folder names (all optional skills are prefixed with sf-tool-)
    const skillFolderName = `sf-tool-${skill}`
    const skillTemplatePath = join(optionalTemplatesPath, skillFolderName)
    const skillTargetPath = join(targetSkillsPath, skillFolderName)
    await copy(skillTemplatePath, skillTargetPath)
  }
}

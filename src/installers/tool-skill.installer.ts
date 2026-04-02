import { copy } from 'fs-extra'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

import { skillsTemplatesPath } from '../types'

interface InstallToolSkillParams {
  targetPath: string
  tool: 'github-projects' | 'jira' | 'notion' | 'linear'
  credentials?: Record<string, string>
}

/**
 * Install tool-specific skill from centralized template.
 *
 * This function:
 * 1. Copies tool skill template from scaffolds/skills-templates/tools/{tool}/
 * 2. Creates .env file with credentials (if provided)
 * 3. Makes scripts executable
 *
 * Tool skills are OPTIONAL and installed based on user choice.
 * Supported tools:
 * - github-projects
 * - jira (requires credentials)
 * - notion (requires credentials)
 * - linear (requires credentials)
 *
 * Credentials are stored in the skill's .env file during initial setup,
 * but users can later switch accounts via `sf tools use <tool> <account>`.
 *
 * For monorepo: Installed once at root/.claude/skills/sf-tool-{tool}/
 * For multirepo: Installed separately in each app's .claude/skills/
 */
export async function installToolSkill({ targetPath, tool, credentials }: InstallToolSkillParams) {
  const toolTemplatePath = join(skillsTemplatesPath, 'tools', tool)
  const targetSkillsPath = join(targetPath, '.claude', 'skills')
  const targetToolPath = join(targetSkillsPath, `sf-tool-${tool}`)

  // Ensure skills directory exists
  await mkdir(targetSkillsPath, { recursive: true })

  // Copy tool skill template
  await copy(toolTemplatePath, targetToolPath)

  // If credentials provided, create .env file
  if (credentials && Object.keys(credentials).length > 0) {
    const envContent = Object.entries(credentials)
      .map(([key, value]) => `${key}="${value}"`)
      .join('\n')

    const envPath = join(targetToolPath, '.env')
    await writeFile(envPath, envContent)
  }
}

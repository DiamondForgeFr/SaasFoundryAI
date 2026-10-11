import { readFile, writeFile } from 'fs/promises'
import { isAbsolute, join } from 'node:path'

import { installClaudeDocs } from './claude-docs.installer'
import { installCoreSkills } from './core-skills.installer'
import { installOptionalSkills } from './optional-skills.installer'
import type { ModuleInstaller } from '../migrations/module/types'
import { fileExists } from '../utils'

export const skillsInstallerMeta: ModuleInstaller = {
  name: 'skills',
  currentVersion: 1,
  migrations: []
}

interface InstallSkillsParams {
  /** Explicit generated-project root. Defaults to cwd-compatible `.` for existing callers. */
  targetDir?: string
  isMonorepo: boolean
  apiPath: string
  webPath: string
  projectName: string
  version: string
  mainBranch?: string
  advancedSkills?: string[]
  context7ApiKey?: string
  atlassianEmail?: string
  atlassianApiToken?: string
  atlassianSite?: string
  atlassianCloudId?: string
  notionApiToken?: string
  notionApiVersion?: string
  figmaApiToken?: string
}

/**
 * Install Claude Code skills using the new centralized architecture.
 *
 * This function delegates to the new installers:
 * - installCoreSkills() - Installs core skills from skills-templates/core/
 * - installOptionalSkills() - Installs optional skills from skills-templates/optional/
 *
 * Architecture:
 * - Monorepo: Skills installed at root (.claude/) - centralized, no duplication
 * - Multirepo: Skills installed in each app (api/.claude/ and web/.claude/)
 *
 * Used by both `sf new` (during initial project generation) and `sf update` (when adding skills later).
 */
export async function installSkills({ targetDir = '.', isMonorepo, apiPath, webPath, projectName, version, mainBranch = 'main', advancedSkills = [] }: InstallSkillsParams) {
  const at = (path: string) => (isAbsolute(path) ? path : join(targetDir, path))
  const apiTarget = at(apiPath)
  const webTarget = at(webPath)

  if (isMonorepo) {
    // Monorepo: Install skills at root (centralized)
    await installCoreSkills({ targetPath: targetDir })
    await installClaudeDocs({ targetPath: targetDir })

    if (advancedSkills.length > 0) {
      await installOptionalSkills({
        targetPath: targetDir,
        selectedSkills: advancedSkills
      })
    }

    // Update AGENTS.md placeholders at root + per-app (blueprints copy AGENTS.md with placeholders)
    await updateAgentsMdPlaceholders({ targetPath: targetDir, projectName, version, mainBranch })
    await updateAgentsMdPlaceholders({ targetPath: apiTarget, projectName, version, mainBranch })
    await updateAgentsMdPlaceholders({ targetPath: webTarget, projectName, version, mainBranch })

    // Copy README.md to .claude/
    await copyClaudeReadme({ targetPath: targetDir })
  } else {
    // Multirepo: Install skills in each app
    await installCoreSkills({ targetPath: apiTarget })
    await installCoreSkills({ targetPath: webTarget })
    await installClaudeDocs({ targetPath: apiTarget })
    await installClaudeDocs({ targetPath: webTarget })

    if (advancedSkills.length > 0) {
      await installOptionalSkills({
        targetPath: apiTarget,
        selectedSkills: advancedSkills
      })

      await installOptionalSkills({
        targetPath: webTarget,
        selectedSkills: advancedSkills
      })
    }

    // Update AGENTS.md placeholders
    await updateAgentsMdPlaceholders({ targetPath: apiTarget, projectName, version, mainBranch })
    await updateAgentsMdPlaceholders({ targetPath: webTarget, projectName, version, mainBranch })

    // Copy README.md
    await copyClaudeReadme({ targetPath: apiTarget })
    await copyClaudeReadme({ targetPath: webTarget })
  }
}

/**
 * Update AGENTS.md placeholders ({{PROJECT_NAME}}, {{VERSION}}, {{MAIN_BRANCH}})
 */
async function updateAgentsMdPlaceholders({ targetPath, projectName, version, mainBranch }: { targetPath: string; projectName: string; version: string; mainBranch: string }) {
  const agentsMdPath = join(targetPath, 'AGENTS.md')

  if (await fileExists(agentsMdPath)) {
    let agentsMdContent = await readFile(agentsMdPath, 'utf8')
    agentsMdContent = agentsMdContent
      .replace(/\{\{PROJECT_NAME\}\}/g, projectName)
      .replace(/\{\{VERSION\}\}/g, version)
      .replace(/\{\{MAIN_BRANCH\}\}/g, mainBranch)
    await writeFile(agentsMdPath, agentsMdContent)
  }
}

/**
 * Copy .claude/README.md from blueprint
 */
async function copyClaudeReadme({ targetPath }: { targetPath: string }) {
  // README.md is now in the blueprint's .claude directory
  // For monorepo, it's already copied from overlays/monorepo/root/
  // For multirepo, it's already copied from blueprints/api/ and blueprints/web/
  // So this function is mostly a placeholder for now

  // The README.md is already in place from the blueprint copy in builders
  // We just need to verify it exists
  const readmePath = join(targetPath, '.claude/README.md')

  if (await fileExists(readmePath)) {
    // README already exists from blueprint copy
    return
  }
}

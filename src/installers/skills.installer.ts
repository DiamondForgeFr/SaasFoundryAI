import { copy } from 'fs-extra'
import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'

import { blueprintsPath, overlaysPath } from '../types'
import { fileExists } from '../utils'

interface InstallSkillsParams {
  isMonorepo: boolean
  apiPath: string
  webPath: string
  projectName: string
  version: string
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
 * Install Claude Code skills.
 *
 * Architecture:
 * - Monorepo: Skills installed at root (.claude/) - centralized, no duplication
 * - Multirepo: Skills installed in each app (api/.claude/ and web/.claude/)
 *
 * This function:
 * 1. Copies all core skills to .claude/skills/ (always installed)
 * 2. Copies selected advanced skills to .claude/skills-optional/
 * 3. Creates .env files for advanced skills with user credentials
 * 4. Updates CLAUDE.md placeholders ({{PROJECT_NAME}}, {{VERSION}})
 * 5. Copies .claude/README.md
 *
 * Used by both `sf new` (during initial project generation) and `sf update` (when adding skills later).
 */
export async function installSkills({
  isMonorepo,
  apiPath,
  webPath,
  projectName,
  version,
  advancedSkills = [],
  context7ApiKey,
  atlassianEmail,
  atlassianApiToken,
  atlassianSite,
  atlassianCloudId,
  notionApiToken,
  notionApiVersion,
  figmaApiToken
}: InstallSkillsParams) {
  if (isMonorepo) {
    // Monorepo: Install skills at root (centralized)
    await installSkillsAtRoot({
      projectName,
      version,
      advancedSkills,
      context7ApiKey,
      atlassianEmail,
      atlassianApiToken,
      atlassianSite,
      atlassianCloudId,
      notionApiToken,
      notionApiVersion,
      figmaApiToken
    })
  } else {
    // Multirepo: Install skills in each app
    await installSkillsForApp({
      appPath: apiPath,
      appType: 'api',
      projectName,
      version,
      advancedSkills,
      context7ApiKey,
      atlassianEmail,
      atlassianApiToken,
      atlassianSite,
      atlassianCloudId,
      notionApiToken,
      notionApiVersion,
      figmaApiToken
    })

    await installSkillsForApp({
      appPath: webPath,
      appType: 'web',
      projectName,
      version,
      advancedSkills,
      context7ApiKey,
      atlassianEmail,
      atlassianApiToken,
      atlassianSite,
      atlassianCloudId,
      notionApiToken,
      notionApiVersion,
      figmaApiToken
    })
  }
}

interface InstallSkillsAtRootParams {
  projectName: string
  version: string
  advancedSkills: string[]
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
 * Install skills at monorepo root (centralized)
 */
async function installSkillsAtRoot({
  projectName,
  version,
  advancedSkills,
  context7ApiKey,
  atlassianEmail,
  atlassianApiToken,
  atlassianSite,
  atlassianCloudId,
  notionApiToken,
  notionApiVersion,
  figmaApiToken
}: InstallSkillsAtRootParams) {
  // Copy from monorepo overlay (already includes skills from blueprints)
  const monorepoClaudePath = resolve(overlaysPath, 'monorepo/root/.claude')
  const targetClaudePath = '.claude'

  // Copy all core skills
  const blueprintSkillsPath = resolve(monorepoClaudePath, 'skills')
  const targetSkillsPath = `${targetClaudePath}/skills`
  await copy(blueprintSkillsPath, targetSkillsPath)

  // Copy .claude/README.md
  const blueprintReadmePath = resolve(monorepoClaudePath, 'README.md')
  const targetReadmePath = `${targetClaudePath}/README.md`
  await copy(blueprintReadmePath, targetReadmePath)

  // Copy selected advanced skills if any
  if (advancedSkills.length > 0) {
    for (const skill of advancedSkills) {
      const blueprintSkillPath = resolve(monorepoClaudePath, 'skills-optional', `sf-tool-${skill}`)
      const targetSkillPath = `${targetClaudePath}/skills-optional/sf-tool-${skill}`

      if (await fileExists(blueprintSkillPath)) {
        await copy(blueprintSkillPath, targetSkillPath)

        // Create .env file with credentials for this skill
        await createSkillEnvFile({
          targetSkillPath,
          skill,
          context7ApiKey,
          atlassianEmail,
          atlassianApiToken,
          atlassianSite,
          atlassianCloudId,
          notionApiToken,
          notionApiVersion,
          figmaApiToken
        })
      }
    }
  }

  // Update CLAUDE.md placeholders at root
  const claudeMdPath = 'CLAUDE.md'
  if (await fileExists(claudeMdPath)) {
    let claudeMdContent = await readFile(claudeMdPath, 'utf8')
    claudeMdContent = claudeMdContent.replace(/\{\{PROJECT_NAME\}\}/g, projectName).replace(/\{\{VERSION\}\}/g, version)
    await writeFile(claudeMdPath, claudeMdContent)
  }
}

interface InstallSkillsForAppParams {
  appPath: string
  appType: 'api' | 'web'
  projectName: string
  version: string
  advancedSkills: string[]
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
 * Install skills for a single app (API or Web)
 */
async function installSkillsForApp({
  appPath,
  appType,
  projectName,
  version,
  advancedSkills,
  context7ApiKey,
  atlassianEmail,
  atlassianApiToken,
  atlassianSite,
  atlassianCloudId,
  notionApiToken,
  notionApiVersion,
  figmaApiToken
}: InstallSkillsForAppParams) {
  const blueprintClaudePath = resolve(blueprintsPath, appType, '.claude')
  const targetClaudePath = `${appPath}/.claude`

  // Copy all core skills
  const blueprintSkillsPath = resolve(blueprintClaudePath, 'skills')
  const targetSkillsPath = `${targetClaudePath}/skills`
  await copy(blueprintSkillsPath, targetSkillsPath)

  // Copy .claude/README.md
  const blueprintReadmePath = resolve(blueprintClaudePath, 'README.md')
  const targetReadmePath = `${targetClaudePath}/README.md`
  await copy(blueprintReadmePath, targetReadmePath)

  // Copy selected advanced skills if any
  if (advancedSkills.length > 0) {
    for (const skill of advancedSkills) {
      const blueprintSkillPath = resolve(blueprintClaudePath, 'skills-optional', `sf-tool-${skill}`)
      const targetSkillPath = `${targetClaudePath}/skills-optional/sf-tool-${skill}`

      if (await fileExists(blueprintSkillPath)) {
        await copy(blueprintSkillPath, targetSkillPath)

        // Create .env file with credentials for this skill
        await createSkillEnvFile({
          targetSkillPath,
          skill,
          context7ApiKey,
          atlassianEmail,
          atlassianApiToken,
          atlassianSite,
          atlassianCloudId,
          notionApiToken,
          notionApiVersion,
          figmaApiToken
        })
      }
    }
  }

  // Update CLAUDE.md placeholders
  const claudeMdPath = `${appPath}/CLAUDE.md`
  if (await fileExists(claudeMdPath)) {
    let claudeMdContent = await readFile(claudeMdPath, 'utf8')
    claudeMdContent = claudeMdContent.replace(/\{\{PROJECT_NAME\}\}/g, projectName).replace(/\{\{VERSION\}\}/g, version)
    await writeFile(claudeMdPath, claudeMdContent)
  }
}

interface CreateSkillEnvFileParams {
  targetSkillPath: string
  skill: string
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
 * Create .env file for an advanced skill with user credentials
 */
async function createSkillEnvFile({
  targetSkillPath,
  skill,
  context7ApiKey,
  atlassianEmail,
  atlassianApiToken,
  atlassianSite,
  atlassianCloudId,
  notionApiToken,
  notionApiVersion,
  figmaApiToken
}: CreateSkillEnvFileParams) {
  const envPath = `${targetSkillPath}/.env`
  let envContent = ''

  switch (skill) {
    case 'context7':
      if (context7ApiKey) {
        envContent = `CONTEXT7_API_KEY=${context7ApiKey}\n`
      } else {
        envContent = `# CONTEXT7_API_KEY=\n# Configure this to use the Context7 skill\n`
      }
      break

    case 'atlassian':
      if (atlassianEmail && atlassianApiToken && atlassianSite && atlassianCloudId) {
        envContent = `ATLASSIAN_EMAIL=${atlassianEmail}
ATLASSIAN_API_TOKEN=${atlassianApiToken}
ATLASSIAN_SITE=${atlassianSite}
ATLASSIAN_CLOUD_ID=${atlassianCloudId}
`
      } else {
        envContent = `# ATLASSIAN_EMAIL=
# ATLASSIAN_API_TOKEN=
# ATLASSIAN_SITE=
# ATLASSIAN_CLOUD_ID=
# Configure these to use the Atlassian skill
`
      }
      break

    case 'notion':
      if (notionApiToken) {
        envContent = `NOTION_API_TOKEN=${notionApiToken}
NOTION_API_VERSION=${notionApiVersion || '2022-06-28'}
`
      } else {
        envContent = `# NOTION_API_TOKEN=
# NOTION_API_VERSION=2022-06-28
# Configure these to use the Notion skill
`
      }
      break

    case 'figma':
      if (figmaApiToken) {
        envContent = `FIGMA_API_TOKEN=${figmaApiToken}\n`
      } else {
        envContent = `# FIGMA_API_TOKEN=\n# Configure this to use the Figma skill\n`
      }
      break
  }

  if (envContent) {
    await writeFile(envPath, envContent)
  }
}

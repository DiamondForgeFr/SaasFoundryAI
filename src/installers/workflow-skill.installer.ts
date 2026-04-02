import { copy } from 'fs-extra'
import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'

import { WorkflowConfig, skillsTemplatesPath } from '../types'

interface InstallWorkflowSkillParams {
  targetPath: string
  workflow: WorkflowConfig
  projectUrl?: string
}

/**
 * Install workflow skill from template.
 *
 * This function:
 * 1. Copies workflow skill template from scaffolds/skills-templates/workflow/
 * 2. Replaces placeholders in .env.example → .env
 * 3. Keeps SKILL.md and statuses/ as-is (no placeholders)
 *
 * Used by builders when workflow is configured during project generation.
 */
export async function installWorkflowSkill({ targetPath, workflow, projectUrl }: InstallWorkflowSkillParams) {
  // Source: scaffolds/skills-templates/workflow/
  const templatePath = resolve(skillsTemplatesPath, 'workflow')
  const targetSkillPath = `${targetPath}/.claude/skills/sf-workflow`

  // Copy entire skill template
  await copy(templatePath, targetSkillPath)

  // Replace placeholders in .env.example and save as .env
  const envExamplePath = `${targetSkillPath}/.env.example`
  const envPath = `${targetSkillPath}/.env`

  let envContent = await readFile(envExamplePath, 'utf8')

  // Replace placeholders with actual values
  const workflowName = workflow.template || workflow.tool
  envContent = envContent
    .replace(/\{\{WORKFLOW_TOOL\}\}/g, workflow.tool || '')
    .replace(/\{\{PROJECT_URL\}\}/g, projectUrl || '')
    .replace(/\{\{WORKING_BRANCH\}\}/g, workflow.workingBranch || 'develop')
    .replace(/\{\{PR_TARGET_BRANCH\}\}/g, workflow.prTargetBranch || workflow.workingBranch || 'develop')
    .replace(/\{\{WORKFLOW_NAME\}\}/g, workflowName || '')

  await writeFile(envPath, envContent)
}

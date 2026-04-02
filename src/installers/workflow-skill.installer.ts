import { copy } from 'fs-extra'
import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'

import { WorkflowConfig, skillsTemplatesPath } from '../types'
import { fileExists } from '../utils'

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
 * 3. Injects workflow section into CLAUDE.md
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

  // Inject workflow section into CLAUDE.md
  await injectWorkflowSection({ targetPath, workflow, projectUrl })
}

/**
 * Generate and inject workflow section into CLAUDE.md
 */
async function injectWorkflowSection({ targetPath, workflow, projectUrl }: InstallWorkflowSkillParams) {
  const claudeMdPath = `${targetPath}/CLAUDE.md`

  if (!(await fileExists(claudeMdPath))) {
    return
  }

  let claudeMdContent = await readFile(claudeMdPath, 'utf8')

  // Generate workflow section
  const workflowSection = generateWorkflowSection(workflow, projectUrl)

  // Inject after Git Workflow section (or at the end if not found)
  const gitWorkflowMarker = '## Git Workflow'
  const developmentCommandsMarker = '## Development Commands'

  if (claudeMdContent.includes(gitWorkflowMarker) && claudeMdContent.includes(developmentCommandsMarker)) {
    // Inject between Git Workflow and Development Commands
    claudeMdContent = claudeMdContent.replace(developmentCommandsMarker, `${workflowSection}\n\n${developmentCommandsMarker}`)
  } else {
    // Append at the end
    claudeMdContent += `\n\n${workflowSection}`
  }

  await writeFile(claudeMdPath, claudeMdContent)
}

/**
 * Generate workflow section content for CLAUDE.md
 */
function generateWorkflowSection(workflow: WorkflowConfig, projectUrl?: string): string {
  const workingBranch = workflow.workingBranch || 'develop'
  const prTargetBranch = workflow.prTargetBranch || workingBranch
  const workflowName = workflow.template || workflow.tool

  const sections: string[] = []

  sections.push('## Workflow System')
  sections.push('')
  sections.push('**This project uses an AI-assisted workflow system. All workflow documentation is managed by the `sf-workflow` skill.**')
  sections.push('')
  sections.push('### Quick Reference')
  sections.push('')
  sections.push('- **Tool**: ' + (workflow.tool === 'github-projects' ? 'GitHub Projects' : workflow.tool))
  if (projectUrl) {
    sections.push('- **Project URL**: ' + projectUrl)
  }
  sections.push('- **Working Branch**: `' + workingBranch + '`')
  sections.push('- **PR Target Branch**: `' + prTargetBranch + '`')
  if (workflowName) {
    sections.push('- **Workflow Template**: ' + workflowName)
  }
  sections.push('')

  // Branch naming
  if (workflow.branchNaming) {
    sections.push('### Branch Naming')
    sections.push('')
    if (workflow.branchNaming.feature) {
      sections.push('- Features: `' + workflow.branchNaming.feature + '`')
    }
    if (workflow.branchNaming.fix) {
      sections.push('- Fixes: `' + workflow.branchNaming.fix + '`')
    }
    if (workflow.branchNaming.release) {
      sections.push('- Releases: `' + workflow.branchNaming.release + '`')
    }
    sections.push('')
  }

  // Commit format
  if (workflow.commitFormat) {
    sections.push('### Commit Format')
    sections.push('')
    if (workflow.commitFormat.pattern) {
      sections.push('Pattern: `' + workflow.commitFormat.pattern + '`')
      sections.push('')
    }
    if (workflow.commitFormat.requireTicket) {
      sections.push('**Ticket reference is required in commit messages.**')
      sections.push('')
    }
    if (workflow.commitFormat.types && workflow.commitFormat.types.length > 0) {
      sections.push('Allowed types: ' + workflow.commitFormat.types.map(t => `\`${t}\``).join(', '))
      sections.push('')
    }
  }

  // Workflow CLI commands
  sections.push('### Workflow Commands')
  sections.push('')
  sections.push('Use the `sf-workflow` skill CLI to check your current status and next steps:')
  sections.push('')
  sections.push('```bash')
  sections.push('# Check current ticket status and what to do')
  sections.push('.claude/skills/sf-workflow/workflow-cli.sh status <ticket-number>')
  sections.push('')
  sections.push('# Show next status in the workflow')
  sections.push('.claude/skills/sf-workflow/workflow-cli.sh next <ticket-number>')
  sections.push('')
  sections.push('# Display full workflow documentation')
  sections.push('.claude/skills/sf-workflow/workflow-cli.sh help')
  sections.push('```')
  sections.push('')
  sections.push('**IMPORTANT**: The workflow skill contains detailed status descriptions, mandatory actions, and exit conditions for each workflow phase. Always consult it before moving tickets between statuses.')

  return sections.join('\n')
}

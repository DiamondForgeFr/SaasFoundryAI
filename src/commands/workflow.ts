import inquirer from 'inquirer'
import chalk from 'chalk'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { spawnSync } from 'child_process'
import {
  DEFAULT_WORKING_BRANCH,
  promptWorkflowConfiguration,
  listGlobalWorkflows,
  loadGlobalWorkflow,
  saveGlobalWorkflow,
  setupGitHubProjectWithAutoCreation,
  updateGitHubProjectStatuses,
  WORKFLOW_PRESETS
} from '../prompts/workflow.prompts'
import { installWorkflowSkill } from '../installers/workflow-skill.installer'
import { readManifest } from '../utils'
import { mutateProjectManifestSafe } from '../manifest-file'
import { assertGitBranchName } from '../run'
import { assertBoardUrl, boardRemediation, isMissingBoard } from '../utils/workflow-board'
import { getRemoteUrl } from '../utils/git-info'
import type { SaaSFoundryManifest, WorkflowTemplate } from '../types'

const WORKFLOWS_DIR = path.join(os.homedir(), '.claude', 'workflows')
const HISTORY_FILE = path.join(WORKFLOWS_DIR, '.history.json')

/**
 * Main workflow command handler
 */
export async function workflowCommand(subcommand?: string, ...args: string[]) {
  // Commands that don't require a project
  const globalCommands = ['list', 'create', 'delete', 'show-template']

  if (!subcommand || subcommand === 'help') {
    showUsage()
    return
  }

  // Options reach the subcommands as arguments; only `use` takes any (#821)
  const stray = subcommand === 'use' ? undefined : args.find((arg) => arg.startsWith('-'))
  if (stray) {
    console.error(chalk.red(`\n❌ Unknown option for \`sf workflow ${subcommand}\`: ${stray}\n`))
    showUsage()
    process.exit(1)
  }

  // Check if we're in a project (unless it's a global command)
  const manifest = await readManifest(process.cwd())

  if (!globalCommands.includes(subcommand) && !manifest) {
    console.error(chalk.red('\n❌ Not a SaaSFoundryAI project (no .saasfoundry.json found)\n'))
    console.log(chalk.gray('Global commands available everywhere:'))
    console.log(chalk.gray('  sf workflow list'))
    console.log(chalk.gray('  sf workflow create <name>'))
    console.log(chalk.gray('  sf workflow show-template <name>\n'))
    process.exit(1)
  }

  switch (subcommand) {
    // Project-level commands
    case 'show':
      showWorkflowConfig(manifest!)
      break
    case 'use':
      await useTemplate(manifest!, args)
      break
    case 'set-working-branch':
      await setWorkflowBranch(manifest!, 'workingBranch', args[0])
      break
    case 'set-pr-target-branch':
      await setWorkflowBranch(manifest!, 'prTargetBranch', args[0])
      break
    case 'set-ai-rules':
      await setAIRules(manifest!)
      break
    case 'validate':
      await validateWorkflowConfig(manifest!)
      break
    case 'save':
      await saveAsTemplate(manifest!, args[0])
      break

    // Global template commands
    case 'list':
      await listTemplates()
      break
    case 'create':
      await createTemplate(args[0])
      break
    case 'delete':
      await deleteTemplate(args[0])
      break
    case 'show-template':
      await showTemplate(args[0])
      break

    default:
      console.log(chalk.red(`\n❌ Unknown subcommand: ${subcommand}\n`))
      showUsage()
      process.exit(1)
  }
}

function showUsage() {
  console.log(chalk.blue('\nUsage: sf workflow <subcommand> [options]\n'))
  console.log(chalk.bold('Project-level commands:'))
  console.log('  show                        Display current workflow configuration')
  console.log('  use <template>              Apply a global template to current project')
  console.log('      [--project-url <url> | --create-board]  Attach an existing board, or create a GitHub Projects one')
  console.log('  set-working-branch <branch> Change the working branch')
  console.log('  set-pr-target-branch <branch> Change the branch pull requests target')
  console.log('  set-ai-rules                Modify AI development rules')
  console.log('  validate                    Validate workflow configuration')
  console.log('  save <name>                 Save as global template')
  console.log()
  console.log(chalk.bold('Global template commands:'))
  console.log('  list                        List all templates')
  console.log('  create <name>               Create new template')
  console.log('  delete <name>               Delete template')
  console.log('  show-template <name>        View template details\n')
}

// ============================================================================
// Project-level commands
// ============================================================================

function showWorkflowConfig(manifest: SaaSFoundryManifest) {
  const { workflow, aiRules } = manifest

  if (!workflow) {
    console.log(chalk.yellow('\n⚠️  No workflow configured\n'))
    return
  }

  console.log(chalk.blue('\n📋 Workflow Configuration\n'))

  if (workflow.template) {
    console.log(chalk.bold('Template:'), chalk.cyan(workflow.template))
  }
  console.log(chalk.bold('Tool:'), workflow.tool)
  if (workflow.projectUrl) {
    console.log(chalk.bold('Project URL:'), workflow.projectUrl)
  }
  console.log(chalk.bold('Branch de travail:'), chalk.cyan(workflow.workingBranch))
  console.log(chalk.bold('PR target branch:'), workflow.prTargetBranch)
  console.log(chalk.bold('Require code review:'), workflow.requireCodeReview ? 'Yes' : 'No')

  if (workflow.validated !== undefined) {
    console.log(chalk.bold('Validated:'), workflow.validated ? chalk.green('Yes') : chalk.yellow('No'))
    if (workflow.lastValidated) {
      console.log(chalk.gray(`  Last validated: ${workflow.lastValidated}`))
    }
  }

  console.log(chalk.blue('\n⚙️  AI Development Rules\n'))
  if (aiRules) {
    Object.entries(aiRules).forEach(([key, value]) => {
      const label = key
        .replace(/([A-Z])/g, ' $1')
        .toLowerCase()
        .replace(/^./, (str) => str.toUpperCase())
      console.log(`  ${value ? chalk.green('✅') : chalk.gray('❌')} ${label}`)
    })
  }

  console.log(chalk.blue('\n📊 Workflow Statuses\n'))
  if (workflow.statuses) {
    Object.entries(workflow.statuses).forEach(([key, value]) => {
      if (value) {
        console.log(`  ${chalk.gray(key)}: ${value}`)
      }
    })
  }
  console.log()
}

interface UseOptions {
  templateName?: string
  projectUrl?: string
  createBoard: boolean
}

/** `use <template> [--project-url <url> | --create-board]`; any other flag is refused rather than ignored. */
export function parseUseArgs(args: string[]): UseOptions {
  const options: UseOptions = { createBoard: false }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--project-url' || arg.startsWith('--project-url=')) {
      const value = arg === '--project-url' ? args[++i] : arg.slice('--project-url='.length)
      if (!value || value.startsWith('-')) throw new Error('--project-url needs the board URL')
      options.projectUrl = value
    } else if (arg === '--create-board') {
      options.createBoard = true
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option for \`sf workflow use\`: ${arg}`)
    } else if (options.templateName === undefined) {
      options.templateName = arg
    } else {
      throw new Error(`Unexpected argument for \`sf workflow use\`: ${arg}`)
    }
  }
  if (options.projectUrl && options.createBoard) throw new Error('--project-url and --create-board are exclusive: attach an existing board, or create one.')
  return options
}

async function useTemplate(manifest: SaaSFoundryManifest, args: string[]) {
  let options: UseOptions
  try {
    options = parseUseArgs(args)
  } catch (error) {
    console.error(chalk.red(`\n❌ ${error instanceof Error ? error.message : String(error)}\n`))
    console.log('Usage: sf workflow use <template-name> [--project-url <url> | --create-board]\n')
    process.exit(1)
  }
  const templateName = options.templateName
  if (!templateName) {
    console.error(chalk.red('\n❌ Template name is required\n'))
    console.log('Usage: sf workflow use <template-name> [--project-url <url> | --create-board]\n')
    process.exit(1)
  }

  // Saved templates first, then built-in presets (saasfoundry | solo) — the
  // preset path is the in-place upgrade/downgrade between team and solo:
  // tool, URLs and branch config come from the current manifest, only the
  // status set (and docs) change. Tickets, issue types and labels stay valid.
  let template = await loadGlobalWorkflow(templateName)

  if (!template) {
    const presetKey = templateName.toLowerCase() as keyof typeof WORKFLOW_PRESETS
    const preset = WORKFLOW_PRESETS[presetKey]
    if (preset) {
      template = {
        name: preset.name,
        tool: manifest.workflow?.tool ?? 'none',
        workingBranch: manifest.workflow?.workingBranch,
        prTargetBranch: manifest.workflow?.prTargetBranch,
        requireCodeReview: manifest.workflow?.requireCodeReview,
        statuses: preset.statuses,
        issueTypes: preset.issueTypes,
        branchNaming: manifest.workflow?.branchNaming,
        commitFormat: manifest.workflow?.commitFormat,
        aiRules: manifest.aiRules
      }
    }
  }

  if (!template) {
    console.error(chalk.red(`\n❌ Template "${templateName}" not found\n`))
    console.log('Run: sf workflow list (or use a built-in preset: saasfoundry | solo)\n')
    process.exit(1)
  }

  const projectUrl = await resolveUseBoard(manifest, template, options)

  // Apply template to project
  const workflow: NonNullable<SaaSFoundryManifest['workflow']> = {
    template: template.name ?? templateName,
    tool: template.tool,
    projectUrl,
    workingBranch: template.workingBranch,
    prTargetBranch: template.prTargetBranch,
    requireCodeReview: template.requireCodeReview,
    statuses: template.statuses,
    issueTypes: template.issueTypes,
    branchNaming: template.branchNaming,
    commitFormat: template.commitFormat,
    validated: false
  }

  const appliedManifest = await mutateProjectManifestSafe(process.cwd(), (current) => {
    current.workflow = workflow
    current.aiRules = template.aiRules
  })
  await updateWorkflowHistory(templateName)

  // Regenerate the workflow skill so SKILL.md and the statuses/ docs match
  // the new status set — without this, an in-place preset upgrade leaves the
  // agent documentation describing the previous workflow.
  if (appliedManifest.workflow?.tool !== 'none') {
    await installWorkflowSkill({ targetPath: process.cwd(), workflow: appliedManifest.workflow!, projectUrl: appliedManifest.workflow?.projectUrl })
    console.log(chalk.green('✅ Workflow skill regenerated (SKILL.md + statuses docs)'))
  }

  // Align the GitHub Project board with the new status set (best-effort).
  if (appliedManifest.workflow?.tool === 'github-projects' && appliedManifest.workflow.projectUrl && appliedManifest.workflow.statuses?.length) {
    await updateGitHubProjectStatuses(appliedManifest.workflow.projectUrl, appliedManifest.workflow.statuses)
  }

  console.log(chalk.green(`\n✅ Workflow template "${templateName}" applied\n`))
  if (appliedManifest.workflow && isMissingBoard(appliedManifest.workflow)) {
    console.log(chalk.yellow(`⚠️  No ${appliedManifest.workflow.tool} board attached: the workflow scripts refuse ticket commands until one is.`))
    console.log(chalk.gray(`   ${boardRemediation(appliedManifest.workflow)}\n`))
  }
}

/**
 * The board `use` applies: `--project-url`, a board created by `--create-board`,
 * the project's current board when the tool is unchanged (never re-asked), or a
 * prompt on a terminal. Without a terminal it stays empty and is reported (#821).
 */
async function resolveUseBoard(manifest: SaaSFoundryManifest, template: WorkflowTemplate, options: UseOptions): Promise<string | undefined> {
  const fail = (message: string): never => {
    console.error(chalk.red(`\n❌ ${message}\n`))
    process.exit(1)
  }
  if (template.tool === 'none') return undefined
  if (options.projectUrl) {
    try {
      return assertBoardUrl(template.tool, options.projectUrl)
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  }
  if (options.createBoard) {
    if (template.tool !== 'github-projects') return fail(`--create-board creates a GitHub Projects board, not a ${template.tool} one: pass --project-url <url>.`)
    const created = await setupGitHubProjectWithAutoCreation(manifest.projectName, template.statuses ?? [], getRemoteUrl(), { interactive: false })
    return created ?? fail('--create-board: the GitHub Projects board was not created (see the reason above). Fix it and re-run, or attach an existing board with --project-url <url>.')
  }
  if (manifest.workflow?.projectUrl && manifest.workflow.tool === template.tool) return manifest.workflow.projectUrl
  if (!process.stdin.isTTY) return undefined

  const { projectUrl } = await inquirer.prompt([
    {
      type: 'input',
      name: 'projectUrl',
      message: `${template.tool} project URL (leave empty to attach it later):`
    }
  ])
  return projectUrl?.trim() ? projectUrl.trim() : undefined
}

const BRANCH_FIELDS = {
  workingBranch: { label: 'working branch', prompt: 'Working branch:' },
  prTargetBranch: { label: 'PR target branch', prompt: 'Branch pull requests target:' }
} as const

/**
 * `set-working-branch` / `set-pr-target-branch`. A PR target that followed the
 * working branch keeps following it, as when both were chosen at setup.
 */
async function setWorkflowBranch(manifest: SaaSFoundryManifest, field: keyof typeof BRANCH_FIELDS, branch?: string) {
  if (!manifest.workflow) {
    console.error(chalk.red('\n❌ No workflow configured\n'))
    process.exit(1)
  }

  if (!branch) {
    const answer = await inquirer.prompt([{ type: 'input', name: 'branch', message: BRANCH_FIELDS[field].prompt, default: manifest.workflow[field] || DEFAULT_WORKING_BRANCH }])
    branch = answer.branch as string
  }
  try {
    assertGitBranchName(branch)
  } catch (error) {
    console.error(chalk.red(`\n❌ ${error instanceof Error ? error.message : String(error)}\n`))
    process.exit(1)
  }

  const previous = manifest.workflow
  const followsWorkingBranch = field === 'workingBranch' && (!previous.prTargetBranch || previous.prTargetBranch === previous.workingBranch)
  await mutateProjectManifestSafe(process.cwd(), (current) => {
    if (!current.workflow) throw new Error('No workflow configured in the current project manifest.')
    current.workflow[field] = branch!
    if (followsWorkingBranch) current.workflow.prTargetBranch = branch!
  })

  console.log(chalk.green(`\n✅ ${BRANCH_FIELDS[field].label[0].toUpperCase()}${BRANCH_FIELDS[field].label.slice(1)} set to: ${chalk.cyan(branch)}`))
  if (followsWorkingBranch) console.log(chalk.gray(`   Pull requests target it too (PR target branch: ${branch}).`))
  if (!branchExists(branch)) {
    console.log(chalk.yellow(`⚠️  Branch "${branch}" does not exist yet — create it: git branch ${branch} && git push -u origin ${branch}`))
  }
  console.log()
}

/** Local or on origin. Outside a git repository nothing can be checked, so the branch is not reported missing. */
function branchExists(branch: string): boolean {
  const git = (...args: string[]) => spawnSync('git', args, { stdio: 'ignore' }).status === 0
  if (!git('rev-parse', '--git-dir')) return true
  return git('rev-parse', '--verify', '--quiet', `refs/heads/${branch}`) || git('rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`)
}

async function setAIRules(manifest: SaaSFoundryManifest) {
  console.log(chalk.blue('\n⚙️  AI Development Rules\n'))

  const current = manifest.aiRules || {
    alwaysCreateBranchFromWorking: false,
    alwaysCreateTicketBeforeCode: false,
    autoUpdateTicketStatus: false,
    requireHumanCheckOnPushedBranch: false
  }

  const { aiRules } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'aiRules',
      message: 'Select rules for AI to follow:',
      choices: [
        {
          name: 'Always create branch from working branch',
          value: 'alwaysCreateBranchFromWorking',
          checked: current.alwaysCreateBranchFromWorking
        },
        {
          name: 'Always create ticket before writing code',
          value: 'alwaysCreateTicketBeforeCode',
          checked: current.alwaysCreateTicketBeforeCode
        },
        {
          name: 'Auto-update ticket status when creating branches/PRs',
          value: 'autoUpdateTicketStatus',
          checked: current.autoUpdateTicketStatus
        },
        {
          name: 'Require human validation before marking PR ready for review',
          value: 'requireHumanCheckOnPushedBranch',
          checked: current.requireHumanCheckOnPushedBranch
        }
      ]
    }
  ])

  const nextRules = {
    alwaysCreateBranchFromWorking: aiRules.includes('alwaysCreateBranchFromWorking'),
    alwaysCreateTicketBeforeCode: aiRules.includes('alwaysCreateTicketBeforeCode'),
    autoUpdateTicketStatus: aiRules.includes('autoUpdateTicketStatus'),
    requireHumanCheckOnPushedBranch: aiRules.includes('requireHumanCheckOnPushedBranch')
  }

  await mutateProjectManifestSafe(process.cwd(), (current) => {
    current.aiRules = nextRules
  })
  console.log(chalk.green('\n✅ AI rules updated\n'))
}

async function saveAsTemplate(manifest: SaaSFoundryManifest, templateName?: string) {
  if (!manifest.workflow) {
    console.error(chalk.red('\n❌ No workflow configured in this project\n'))
    process.exit(1)
  }

  if (!templateName) {
    const { name, description } = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Template name:',
        validate: (input) => {
          if (!input || input.length === 0) return 'Name is required'
          if (!/^[a-z0-9-]+$/.test(input)) {
            return 'Use lowercase letters, numbers, and hyphens only'
          }
          return true
        }
      },
      {
        type: 'input',
        name: 'description',
        message: 'Description (optional):'
      }
    ])
    templateName = name

    const template: WorkflowTemplate = {
      name: templateName!,
      description,
      tool: manifest.workflow.tool,
      workingBranch: manifest.workflow.workingBranch,
      prTargetBranch: manifest.workflow.prTargetBranch,
      requireCodeReview: manifest.workflow.requireCodeReview,
      statuses: manifest.workflow.statuses,
      issueTypes: manifest.workflow.issueTypes,
      branchNaming: manifest.workflow.branchNaming,
      commitFormat: manifest.workflow.commitFormat,
      aiRules: manifest.aiRules || {
        alwaysCreateBranchFromWorking: false,
        alwaysCreateTicketBeforeCode: false,
        autoUpdateTicketStatus: false,
        requireHumanCheckOnPushedBranch: false
      }
    }

    await saveGlobalWorkflow(templateName!, template)
  } else {
    const template: WorkflowTemplate = {
      name: templateName!,
      tool: manifest.workflow.tool,
      workingBranch: manifest.workflow.workingBranch,
      prTargetBranch: manifest.workflow.prTargetBranch,
      requireCodeReview: manifest.workflow.requireCodeReview,
      statuses: manifest.workflow.statuses,
      issueTypes: manifest.workflow.issueTypes,
      branchNaming: manifest.workflow.branchNaming,
      commitFormat: manifest.workflow.commitFormat,
      aiRules: manifest.aiRules || {
        alwaysCreateBranchFromWorking: false,
        alwaysCreateTicketBeforeCode: false,
        autoUpdateTicketStatus: false,
        requireHumanCheckOnPushedBranch: false
      }
    }

    await saveGlobalWorkflow(templateName!, template)
  }

  console.log(chalk.green(`\n✅ Workflow saved as template: ${chalk.cyan(templateName!)}\n`))
}

export interface WorkflowConfigIssue {
  issue: string
  remediation: string
}

/**
 * The checks behind `sf workflow validate`: the workflow block of the local
 * manifest only. The remote board is not queried — `github-projects-cli.sh`
 * reports a board that no longer matches the manifest.
 */
export function workflowConfigIssues(manifest: SaaSFoundryManifest): WorkflowConfigIssue[] {
  const workflow = manifest.workflow
  if (!workflow)
    return [{ issue: 'No workflow configuration found', remediation: 'Create a template with `sf workflow create <name>` (it asks for the tool), then apply it with `sf workflow use <name>`.' }]

  const issues: WorkflowConfigIssue[] = []
  if (!workflow.tool) issues.push({ issue: 'Tool not specified', remediation: 'Set `workflow.tool` with `sf workflow use <template>`.' })
  if (workflow.tool && workflow.tool !== 'none' && !workflow.projectUrl) {
    issues.push({ issue: `No ${workflow.tool} board attached (workflow.projectUrl is empty)`, remediation: boardRemediation(workflow) })
  }
  if (!workflow.workingBranch) issues.push({ issue: 'Working branch not specified', remediation: 'Run `sf workflow set-working-branch <branch>`.' })
  if (!workflow.prTargetBranch) issues.push({ issue: 'PR target branch not specified', remediation: 'Run `sf workflow set-pr-target-branch <branch>`.' })
  return issues
}

async function validateWorkflowConfig(manifest: SaaSFoundryManifest) {
  console.log(chalk.blue('\n🔍 Validating the workflow configuration in .saasfoundry.json'))
  console.log(chalk.gray('Checks the tool, board URL and branches recorded locally; the remote board is not queried.\n'))

  const issues = workflowConfigIssues(manifest)
  if (issues.length === 0) {
    console.log(chalk.green('✅ Workflow configuration is valid\n'))
    return
  }

  console.log(chalk.red('❌ Validation failed:\n'))
  for (const { issue, remediation } of issues) {
    console.log(`  - ${issue}`)
    console.log(chalk.gray(`    ${remediation}`))
  }
  console.log()
  process.exit(1)
}

// ============================================================================
// Global template commands
// ============================================================================

async function listTemplates() {
  const templates = await listGlobalWorkflows()

  if (templates.length === 0) {
    console.log(chalk.yellow('\n⚠️  No workflow templates found\n'))
    console.log('Create one with: sf workflow create <name>\n')
    return
  }

  console.log(chalk.blue('\n📋 Global Workflow Templates\n'))

  templates.forEach((template) => {
    console.log(chalk.cyan(`  ${template.name}`))
    if (template.description) {
      console.log(chalk.gray(`    ${template.description}`))
    }
    console.log(chalk.gray(`    Tool: ${template.tool}`))
    console.log()
  })

  console.log(chalk.gray(`Total: ${templates.length} template(s)\n`))
}

async function createTemplate(templateName?: string) {
  if (!templateName) {
    const { name } = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Template name:',
        validate: (input) => {
          if (!input || input.length === 0) return 'Name is required'
          if (!/^[a-z0-9-]+$/.test(input)) {
            return 'Use lowercase letters, numbers, and hyphens only'
          }
          return true
        }
      }
    ])
    templateName = name
  }

  // Validate template name (even when passed as argument)
  if (!templateName || !/^[a-z0-9-]+$/.test(templateName)) {
    console.error(chalk.red('\n❌ Invalid template name'))
    console.log(chalk.gray('Use lowercase letters, numbers, and hyphens only\n'))
    process.exit(1)
  }

  // Check if template already exists (templateName is guaranteed to be string here)
  const existing = await loadGlobalWorkflow(templateName)
  if (existing) {
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: `Template "${templateName}" already exists. Overwrite?`,
        default: false
      }
    ])

    if (!overwrite) {
      console.log(chalk.yellow('\n⚠️  Template creation cancelled\n'))
      return
    }
  }

  console.log(chalk.blue(`\n📋 Creating template: ${chalk.cyan(templateName!)}\n`))

  // Use the standard workflow configuration prompts (but skip project URL and template save)
  const { workflow, aiRules } = await promptWorkflowConfiguration()

  const template: WorkflowTemplate = {
    name: templateName!,
    description: workflow.template, // Reuse description if provided
    tool: workflow.tool,
    workingBranch: workflow.workingBranch,
    prTargetBranch: workflow.prTargetBranch,
    requireCodeReview: workflow.requireCodeReview,
    statuses: workflow.statuses,
    issueTypes: workflow.issueTypes,
    branchNaming: workflow.branchNaming,
    commitFormat: workflow.commitFormat,
    aiRules
  }

  await saveGlobalWorkflow(templateName!, template)

  console.log(chalk.green(`\n✅ Template "${templateName}" created\n`))
}

async function deleteTemplate(templateName?: string) {
  if (!templateName) {
    console.error(chalk.red('\n❌ Template name is required\n'))
    console.log('Usage: sf workflow delete <name>\n')
    process.exit(1)
  }

  const template = await loadGlobalWorkflow(templateName)
  if (!template) {
    console.error(chalk.red(`\n❌ Template "${templateName}" not found\n`))
    process.exit(1)
  }

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Delete template "${templateName}"?`,
      default: false
    }
  ])

  if (!confirm) {
    console.log(chalk.yellow('\n⚠️  Deletion cancelled\n'))
    return
  }

  await fs.unlink(path.join(WORKFLOWS_DIR, `${templateName}.json`))
  console.log(chalk.green(`\n✅ Template "${templateName}" deleted\n`))
}

async function showTemplate(templateName?: string) {
  if (!templateName) {
    console.error(chalk.red('\n❌ Template name is required\n'))
    console.log('Usage: sf workflow show-template <name>\n')
    process.exit(1)
  }

  const template = await loadGlobalWorkflow(templateName)

  if (!template) {
    console.error(chalk.red(`\n❌ Template "${templateName}" not found\n`))
    process.exit(1)
  }

  console.log(chalk.blue(`\n📋 Template: ${chalk.cyan(templateName)}\n`))

  if (template.description) {
    console.log(chalk.bold('Description:'), template.description)
  }
  console.log(chalk.bold('Tool:'), template.tool)
  console.log(chalk.bold('Branch de travail:'), chalk.cyan(template.workingBranch))
  console.log(chalk.bold('PR target branch:'), template.prTargetBranch)
  console.log(chalk.bold('Require code review:'), template.requireCodeReview ? 'Yes' : 'No')

  console.log(chalk.blue('\n⚙️  AI Development Rules\n'))
  if (template.aiRules) {
    Object.entries(template.aiRules).forEach(([key, value]) => {
      const label = key
        .replace(/([A-Z])/g, ' $1')
        .toLowerCase()
        .replace(/^./, (str) => str.toUpperCase())
      console.log(`  ${value ? chalk.green('✅') : chalk.gray('❌')} ${label}`)
    })
  }

  console.log()
}

// ============================================================================
// Helper functions
// ============================================================================

async function ensureWorkflowsDir(): Promise<void> {
  try {
    await fs.mkdir(WORKFLOWS_DIR, { recursive: true })
  } catch {
    // Directory already exists
  }
}

async function updateWorkflowHistory(name: string): Promise<void> {
  await ensureWorkflowsDir()

  let history: {
    recentWorkflows: string[]
    usage: Record<string, { lastUsed: string; projectCount: number }>
  }

  try {
    const content = await fs.readFile(HISTORY_FILE, 'utf-8')
    history = JSON.parse(content)
  } catch {
    history = { recentWorkflows: [], usage: {} }
  }

  // Update recent workflows
  history.recentWorkflows = [name, ...history.recentWorkflows.filter((w) => w !== name)].slice(0, 10)

  // Update usage stats
  if (!history.usage[name]) {
    history.usage[name] = { lastUsed: new Date().toISOString(), projectCount: 0 }
  }
  history.usage[name].lastUsed = new Date().toISOString()
  history.usage[name].projectCount++

  await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8')
}

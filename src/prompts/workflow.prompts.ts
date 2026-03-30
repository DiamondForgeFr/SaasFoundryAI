import inquirer from 'inquirer'
import chalk from 'chalk'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'
import type { WorkflowConfig, AIRules, WorkflowTemplate } from '../types'
import { fileExists } from '../utils'

const WORKFLOWS_DIR = path.join(os.homedir(), '.claude', 'workflows')
const CREDENTIALS_DIR = path.join(os.homedir(), '.claude', 'credentials')

/**
 * Check if GitHub CLI is authenticated
 * @returns true if gh CLI is authenticated and ready to use
 */
function checkGhAuth(): boolean {
  try {
    execSync('gh auth status', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Detect available workflow tools based on credentials and gh auth status
 * Scans ~/.claude/credentials/ directories for tool credentials
 * @returns {available: string[], recommended: string} object with tool detection results
 */
export async function detectAvailableTools(): Promise<{
  available: string[]
  recommended: string
}> {
  const available: string[] = []
  const tools = ['jira', 'notion', 'linear']

  // Check GitHub Projects (via gh CLI authentication)
  if (checkGhAuth()) {
    available.push('github-projects')
  }

  // Check credential-based tools
  for (const tool of tools) {
    const toolDir = path.join(CREDENTIALS_DIR, tool)

    try {
      if (await fileExists(toolDir)) {
        const files = await fs.readdir(toolDir)
        const hasCredentials = files.some((f) => f.endsWith('.env'))

        if (hasCredentials) {
          available.push(tool)
        }
      }
    } catch {
      // Directory doesn't exist or can't be read - skip
    }
  }

  // Determine recommendation
  let recommended = 'none'
  if (available.length > 0) {
    // Prefer GitHub Projects if available (built-in, no extra setup)
    if (available.includes('github-projects')) {
      recommended = 'github-projects'
    } else {
      // Otherwise recommend the first available tool
      recommended = available[0]
    }
  }

  return { available, recommended }
}

/**
 * Setup GitHub Project with auto-creation via GraphQL API
 * Creates a new GitHub Project using the createProjectV2 mutation
 * @param projectName - Name for the new project
 * @returns Project URL if successful, or null if failed
 */
export async function setupGitHubProjectWithAutoCreation(projectName: string): Promise<string | null> {
  try {
    // Check gh auth
    if (!checkGhAuth()) {
      console.log(chalk.yellow('\n⚠️  GitHub CLI not authenticated. Run: gh auth login\n'))
      return null
    }

    // Get current repository info
    let repoOwner: string
    let isOrg = false

    try {
      const repoInfo = execSync('gh repo view --json owner,name', { encoding: 'utf-8' })
      const repo = JSON.parse(repoInfo)
      repoOwner = repo.owner.login

      // Check if owner is an organization
      const ownerType = execSync(`gh api users/${repoOwner} --jq .type`, { encoding: 'utf-8' }).trim()
      isOrg = ownerType === 'Organization'
    } catch {
      console.log(chalk.yellow("\n⚠️  Could not detect repository. Make sure you're in a git repository.\n"))
      return null
    }

    console.log(chalk.blue(`\n🔨 Creating GitHub Project "${projectName}"...\n`))

    // Get owner ID (user or org)
    const ownerIdQuery = isOrg ? `query { organization(login: "${repoOwner}") { id } }` : `query { user(login: "${repoOwner}") { id } }`

    const ownerIdResult = execSync(`gh api graphql -f query='${ownerIdQuery}'`, { encoding: 'utf-8' })
    const ownerId = JSON.parse(ownerIdResult).data[isOrg ? 'organization' : 'user'].id

    // Create project
    const mutation = `
      mutation {
        createProjectV2(input: {
          ownerId: "${ownerId}"
          title: "${projectName}"
        }) {
          projectV2 {
            id
            number
            url
          }
        }
      }
    `

    const result = execSync(`gh api graphql -f query='${mutation.replace(/\n/g, ' ')}'`, { encoding: 'utf-8' })
    const projectData = JSON.parse(result).data.createProjectV2.projectV2

    console.log(chalk.green(`✅ Project created: ${projectData.url}\n`))

    return projectData.url
  } catch (error) {
    const err = error as Error
    console.log(chalk.red(`\n❌ Failed to create GitHub Project: ${err.message}\n`))
    return null
  }
}

// Default configurations for each tool
export const DEFAULT_STATUSES = {
  'github-projects': {
    backlog: 'Backlog',
    ready: 'Ready',
    inProgress: 'In Progress',
    inReview: 'In Review',
    done: 'Done'
  },
  jira: {
    backlog: 'Backlog',
    ready: 'Ready for Dev',
    inProgress: 'In Progress',
    inReview: 'Code Review',
    done: 'Done'
  },
  notion: {
    backlog: 'Backlog',
    ready: 'Ready',
    inProgress: 'In Progress',
    inReview: 'In Review',
    done: 'Done'
  },
  linear: {
    backlog: 'Backlog',
    ready: 'Ready',
    inProgress: 'In Progress',
    inReview: 'In Review',
    done: 'Done'
  },
  none: {
    backlog: '',
    ready: '',
    inProgress: '',
    inReview: '',
    done: ''
  }
}

export const DEFAULT_BRANCH_NAMING = {
  feature: 'feature/{name}',
  fix: 'fix/{name}',
  release: 'rc-{version}'
}

export const DEFAULT_COMMIT_FORMAT = {
  pattern: 'type(#N): description',
  requireTicket: true,
  types: ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'chore', 'ci', 'build', 'revert']
}

export const DEFAULT_AI_RULES: AIRules = {
  alwaysCreateBranchFromWorking: true,
  alwaysCreateTicketBeforeCode: true,
  autoUpdateTicketStatus: true,
  requireHumanCheckOnPushedBranch: true
}

/**
 * Main workflow configuration prompt
 * Handles template selection or new workflow creation
 */
export async function promptWorkflowConfiguration(): Promise<{
  workflow: WorkflowConfig
  aiRules: AIRules
}> {
  console.log(chalk.blue('\n📋 Project Management & Workflow Setup\n'))

  // Step 1: Check for existing templates
  const existingWorkflows = await listGlobalWorkflows()

  let workflowConfig: Partial<WorkflowConfig>
  let aiRulesConfig: AIRules | undefined

  if (existingWorkflows.length > 0) {
    console.log(chalk.gray('Found existing workflow templates:\n'))
    existingWorkflows.forEach((w) => {
      console.log(chalk.gray(`  - ${w.name}: ${w.description || w.tool}`))
    })
    console.log()

    const { useExisting } = await inquirer.prompt([
      {
        type: 'list',
        name: 'useExisting',
        message: 'Use an existing workflow or create a new one?',
        choices: [
          { name: 'Use existing workflow template', value: true },
          { name: 'Create new workflow', value: false }
        ]
      }
    ])

    if (useExisting) {
      const { selectedWorkflow } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedWorkflow',
          message: 'Select workflow template:',
          choices: existingWorkflows.map((w) => ({
            name: `${w.name} - ${w.description || w.tool}`,
            value: w.name
          }))
        }
      ])

      // Load workflow template
      const template = await loadGlobalWorkflow(selectedWorkflow)
      if (!template) {
        throw new Error(`Failed to load workflow template: ${selectedWorkflow}`)
      }

      workflowConfig = { ...template }
      aiRulesConfig = template.aiRules || {}

      // Prompt for project-specific values
      if (template.tool !== 'none') {
        const { projectUrl } = await inquirer.prompt([
          {
            type: 'input',
            name: 'projectUrl',
            message: `${template.tool} project URL:`,
            validate: (input) => input.length > 0 || 'URL is required'
          }
        ])
        workflowConfig.projectUrl = projectUrl
      }

      workflowConfig.template = selectedWorkflow

      return {
        workflow: workflowConfig as WorkflowConfig,
        aiRules: aiRulesConfig
      }
    }
  }

  // Step 2: Detect available tools
  console.log(chalk.blue('🔍 Detecting available project management tools...\n'))
  const { available, recommended } = await detectAvailableTools()

  if (available.length > 0) {
    console.log(chalk.green('✅ Found credentials for:'))
    available.forEach((t) => {
      const badge = t === recommended ? chalk.cyan(' (recommended)') : ''
      console.log(chalk.gray(`  - ${t}${badge}`))
    })
    console.log()
  } else {
    console.log(chalk.gray('No tools configured yet. You can set up credentials later.\n'))
  }

  // Step 3: Create new workflow - offer auto-creation for GitHub Projects
  const choices = [
    {
      name: available.includes('github-projects') ? chalk.green('✓ GitHub Projects (built-in, authenticated)') : 'GitHub Projects (built-in)',
      value: 'github-projects'
    },
    {
      name: available.includes('jira') ? chalk.green('✓ Jira (Atlassian, credentials found)') : 'Jira (Atlassian)',
      value: 'jira'
    },
    {
      name: available.includes('notion') ? chalk.green('✓ Notion (credentials found)') : 'Notion',
      value: 'notion'
    },
    {
      name: available.includes('linear') ? chalk.green('✓ Linear (credentials found)') : 'Linear',
      value: 'linear'
    },
    { name: 'None (no project management integration)', value: 'none' }
  ]

  const { tool } = await inquirer.prompt([
    {
      type: 'list',
      name: 'tool',
      message: 'Choose your project management tool:',
      choices,
      default: recommended !== 'none' ? recommended : 'github-projects'
    }
  ])

  if (tool === 'none') {
    return {
      workflow: {
        tool: 'none',
        workingBranch: 'develop',
        prTargetBranch: 'develop',
        requireCodeReview: false,
        statuses: DEFAULT_STATUSES.none,
        branchNaming: DEFAULT_BRANCH_NAMING,
        commitFormat: DEFAULT_COMMIT_FORMAT
      },
      aiRules: DEFAULT_AI_RULES
    }
  }

  // Step 4: Tool-specific configuration
  let projectUrl = ''
  if (tool === 'github-projects') {
    // Offer auto-creation if gh is authenticated
    if (available.includes('github-projects')) {
      const { createNew } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'createNew',
          message: 'Create a new GitHub Project automatically?',
          default: true
        }
      ])

      if (createNew) {
        const { projectName } = await inquirer.prompt([
          {
            type: 'input',
            name: 'projectName',
            message: 'Project name:',
            default: 'Development Board',
            validate: (input) => input.length > 0 || 'Name is required'
          }
        ])

        const createdUrl = await setupGitHubProjectWithAutoCreation(projectName)
        if (createdUrl) {
          projectUrl = createdUrl
        } else {
          // Fallback to manual URL entry
          const { url } = await inquirer.prompt([
            {
              type: 'input',
              name: 'url',
              message: 'GitHub Project URL (manual entry):',
              default: 'https://github.com/users/{username}/projects/1',
              validate: (input) => {
                if (input.match(/github\.com\/(orgs|users)\/[^/]+\/projects\/\d+/)) {
                  return true
                }
                return 'Invalid GitHub Project URL format'
              }
            }
          ])
          projectUrl = url
        }
      } else {
        // Manual URL entry
        const { url } = await inquirer.prompt([
          {
            type: 'input',
            name: 'url',
            message: 'GitHub Project URL:',
            default: 'https://github.com/users/{username}/projects/1',
            validate: (input) => {
              if (input.match(/github\.com\/(orgs|users)\/[^/]+\/projects\/\d+/)) {
                return true
              }
              return 'Invalid GitHub Project URL format'
            }
          }
        ])
        projectUrl = url
      }
    } else {
      // Not authenticated - manual URL only
      console.log(chalk.yellow('\n💡 Tip: Run "gh auth login" to enable auto-creation of GitHub Projects\n'))
      const { url } = await inquirer.prompt([
        {
          type: 'input',
          name: 'url',
          message: 'GitHub Project URL:',
          default: 'https://github.com/users/{username}/projects/1',
          validate: (input) => {
            if (input.match(/github\.com\/(orgs|users)\/[^/]+\/projects\/\d+/)) {
              return true
            }
            return 'Invalid GitHub Project URL format'
          }
        }
      ])
      projectUrl = url
    }
  } else if (tool === 'jira') {
    const { domain, projectKey } = await inquirer.prompt([
      {
        type: 'input',
        name: 'domain',
        message: 'Jira domain (e.g., mycompany.atlassian.net):',
        validate: (input) => input.includes('atlassian.net') || 'Invalid Jira domain'
      },
      {
        type: 'input',
        name: 'projectKey',
        message: 'Jira project key (e.g., PROJ):',
        validate: (input) => /^[A-Z]+$/.test(input) || 'Invalid project key (must be uppercase letters)'
      }
    ])
    projectUrl = `https://${domain}/browse/${projectKey}`
  } else if (tool === 'notion') {
    const { url } = await inquirer.prompt([
      {
        type: 'input',
        name: 'url',
        message: 'Notion database URL:',
        validate: (input) => {
          if (input.includes('notion.so') || input.includes('notion.site')) {
            return true
          }
          return 'Invalid Notion URL'
        }
      }
    ])
    projectUrl = url
  } else if (tool === 'linear') {
    const { teamKey } = await inquirer.prompt([
      {
        type: 'input',
        name: 'teamKey',
        message: 'Linear team key (e.g., ENG):',
        validate: (input) => /^[A-Z]+$/.test(input) || 'Invalid team key (must be uppercase letters)'
      }
    ])
    projectUrl = `linear://${teamKey}`
  }

  // Step 4: Git workflow configuration
  const branchAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'workingBranch',
      message: 'Working branch (rebase from + PR target):',
      default: 'develop'
    },
    {
      type: 'input',
      name: 'prTargetBranch',
      message: 'Override PR target? (leave empty to use working branch):',
      default: ''
    },
    {
      type: 'confirm',
      name: 'requireCodeReview',
      message: 'Require code review before merging?',
      default: true
    }
  ])

  const workingBranch = branchAnswers.workingBranch
  const prTargetBranch = branchAnswers.prTargetBranch || branchAnswers.workingBranch
  const requireCodeReview = branchAnswers.requireCodeReview

  // Step 5: AI Rules
  console.log(chalk.blue('\n⚙️  AI Development Rules\n'))

  const { aiRules } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'aiRules',
      message: 'Select development rules for AI to follow:',
      choices: [
        {
          name: 'Always create branch from working branch',
          value: 'alwaysCreateBranchFromWorking',
          checked: true
        },
        {
          name: 'Always create ticket before writing code',
          value: 'alwaysCreateTicketBeforeCode',
          checked: true
        },
        {
          name: 'Auto-update ticket status when creating branches/PRs',
          value: 'autoUpdateTicketStatus',
          checked: true
        },
        {
          name: 'Require human validation before creating PR (push → test → approval → PR)',
          value: 'requireHumanCheckOnPushedBranch',
          checked: true
        }
      ]
    }
  ])

  // Convert array to object
  aiRulesConfig = {
    alwaysCreateBranchFromWorking: aiRules.includes('alwaysCreateBranchFromWorking'),
    alwaysCreateTicketBeforeCode: aiRules.includes('alwaysCreateTicketBeforeCode'),
    autoUpdateTicketStatus: aiRules.includes('autoUpdateTicketStatus'),
    requireHumanCheckOnPushedBranch: aiRules.includes('requireHumanCheckOnPushedBranch')
  }

  workflowConfig = {
    tool,
    projectUrl,
    workingBranch,
    prTargetBranch,
    requireCodeReview,
    statuses: DEFAULT_STATUSES[tool as keyof typeof DEFAULT_STATUSES],
    branchNaming: DEFAULT_BRANCH_NAMING,
    commitFormat: DEFAULT_COMMIT_FORMAT
  }

  // Step 6: Save as template?
  const { saveAsTemplate, templateName, templateDescription } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'saveAsTemplate',
      message: 'Save this workflow as a reusable template?',
      default: true
    },
    {
      type: 'input',
      name: 'templateName',
      message: 'Template name (e.g., "client-a-jira", "standard-github"):',
      validate: (input) => {
        if (!input || input.length === 0) return 'Name is required'
        if (!/^[a-z0-9-]+$/.test(input)) {
          return 'Use lowercase letters, numbers, and hyphens only'
        }
        return true
      },
      when: (answers) => answers.saveAsTemplate
    },
    {
      type: 'input',
      name: 'templateDescription',
      message: 'Template description (optional):',
      when: (answers) => answers.saveAsTemplate
    }
  ])

  if (saveAsTemplate) {
    await saveGlobalWorkflow(templateName, {
      name: templateName,
      description: templateDescription,
      tool: workflowConfig.tool!,
      workingBranch: workflowConfig.workingBranch!,
      prTargetBranch: workflowConfig.prTargetBranch!,
      requireCodeReview: workflowConfig.requireCodeReview!,
      statuses: workflowConfig.statuses!,
      branchNaming: workflowConfig.branchNaming!,
      commitFormat: workflowConfig.commitFormat!,
      aiRules: aiRulesConfig
    })

    console.log(chalk.green(`\n✅ Workflow template "${templateName}" saved\n`))
    workflowConfig.template = templateName
  }

  return {
    workflow: workflowConfig as WorkflowConfig,
    aiRules: aiRulesConfig
  }
}

/**
 * Ensure the workflows directory exists
 */
async function ensureWorkflowsDir(): Promise<void> {
  try {
    await fs.mkdir(WORKFLOWS_DIR, { recursive: true })
  } catch {
    // Directory already exists or other error
  }
}

/**
 * List all global workflow templates
 */
export async function listGlobalWorkflows(): Promise<WorkflowTemplate[]> {
  await ensureWorkflowsDir()

  try {
    const files = await fs.readdir(WORKFLOWS_DIR)
    const workflows: WorkflowTemplate[] = []

    for (const file of files) {
      if (file.endsWith('.json') && file !== '.history.json') {
        try {
          const content = await fs.readFile(path.join(WORKFLOWS_DIR, file), 'utf-8')
          workflows.push(JSON.parse(content))
        } catch {
          // Skip invalid files
          console.warn(chalk.yellow(`Warning: Could not read workflow template: ${file}`))
        }
      }
    }

    return workflows
  } catch {
    return []
  }
}

/**
 * Load a specific global workflow template by name
 */
export async function loadGlobalWorkflow(name: string): Promise<WorkflowTemplate | null> {
  await ensureWorkflowsDir()

  try {
    const filePath = path.join(WORKFLOWS_DIR, `${name}.json`)
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

/**
 * Save a workflow template globally
 */
export async function saveGlobalWorkflow(name: string, template: WorkflowTemplate): Promise<void> {
  await ensureWorkflowsDir()

  const filePath = path.join(WORKFLOWS_DIR, `${name}.json`)
  await fs.writeFile(filePath, JSON.stringify(template, null, 2), 'utf-8')
}

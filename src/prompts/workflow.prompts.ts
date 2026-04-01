import inquirer from 'inquirer'
import chalk from 'chalk'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'
import type { WorkflowConfig, AIRules, WorkflowTemplate, WorkflowStatus, GitHubProjectColor } from '../types'
import { fileExists } from '../utils'

const WORKFLOWS_DIR = path.join(os.homedir(), '.claude', 'workflows')
const CREDENTIALS_DIR = path.join(os.homedir(), '.claude', 'credentials')

// Workflow Presets
const WORKFLOW_PRESETS = {
  saasfoundry: {
    name: 'SaaSFoundry AI Workflow',
    description: '7-status workflow with AI and Human testing phases (recommended for AI-assisted development)',
    statuses: [
      {
        name: 'Backlog',
        description:
          'Raw ideas and specs waiting to be challenged. AI must challenge the ticket with the developer to clarify requirements, identify edge cases, and validate approach before moving to Ready. Ask questions, suggest improvements, and ensure specs are complete.',
        color: 'GRAY' as GitHubProjectColor
      },
      {
        name: 'Ready',
        description:
          'Specs have been challenged and validated. Priority assigned, potentially with a target date. Requirements are clear and actionable. AI can pick tickets in order, or wait for developer to specify which one to work on. Ready to start development immediately.',
        color: 'YELLOW' as GitHubProjectColor
      },
      {
        name: 'In Progress',
        description:
          'Task currently being worked on by AI. Create subtasks during implementation and link them to the main ticket. Commit after each subtask completion. When all subtasks are done: run existing tests (unit, E2E, lint, TypeScript) to ensure nothing is broken, commit and push all changes, then move to AI Testing and generate a test plan.',
        color: 'BLUE' as GitHubProjectColor
      },
      {
        name: 'AI Testing',
        description:
          'First validation phase. Execute the generated test plan step by step. For each test: verify functionality, check edge cases, validate against requirements. Document all findings in ticket comments. If issues found: fix them, commit changes, and re-test. When all tests pass: create test report summary and move to Human Testing for second validation.',
        color: 'PURPLE' as GitHubProjectColor
      },
      {
        name: 'Human Testing',
        description:
          'Second validation by human reviewer. Developer performs manual testing of functionality, validates edge cases, reviews UX/UI. If approved: AI creates pull request and moves to In Review. If major issues found: send back to In Progress with detailed feedback for fixes.',
        color: 'ORANGE' as GitHubProjectColor
      },
      {
        name: 'In Review',
        description:
          'Pull request created and awaiting code review from team members. AI monitors review comments and addresses feedback if needed (make requested changes, answer questions, update documentation). When PR is approved by reviewers: merge to main branch and move to Done.',
        color: 'PINK' as GitHubProjectColor
      },
      {
        name: 'Done',
        description:
          'Feature completed and merged to main branch. Code is deployed or ready for deployment. Close the ticket, archive subtasks, and update any related documentation. Celebrate the win!',
        color: 'GREEN' as GitHubProjectColor
      }
    ]
  },
  standard: {
    name: 'Standard Workflow',
    description: '5-status workflow for general development',
    statuses: [
      { name: 'Backlog', description: 'Tasks to be prioritized', color: 'GRAY' as GitHubProjectColor },
      { name: 'Ready', description: 'Ready for development', color: 'YELLOW' as GitHubProjectColor },
      { name: 'In Progress', description: 'Currently being worked on', color: 'BLUE' as GitHubProjectColor },
      { name: 'In Review', description: 'In code review', color: 'PINK' as GitHubProjectColor },
      { name: 'Done', description: 'Completed', color: 'GREEN' as GitHubProjectColor }
    ]
  }
}

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
 * Creates a new GitHub Project using the createProjectV2 mutation and configures the Status field
 * @param projectName - Name for the new project
 * @param statuses - Workflow statuses to configure
 * @param repositoryUrl - Optional repository URL to extract owner from (for sf new before git init)
 * @returns Project URL if successful, or null if failed
 */
export async function setupGitHubProjectWithAutoCreation(projectName: string, statuses: WorkflowStatus[], repositoryUrl?: string): Promise<string | null> {
  try {
    // Check gh auth
    if (!checkGhAuth()) {
      console.log(chalk.yellow('\n⚠️  GitHub CLI not authenticated. Run: gh auth login\n'))
      return null
    }

    // Get owner info
    let repoOwner: string
    let isOrg = false

    // Try to detect from repository URL first (for sf new)
    if (repositoryUrl) {
      // Extract owner from URL (https://github.com/owner/repo or https://github.com/orgs/owner/...)
      const urlMatch = repositoryUrl.match(/github\.com\/(orgs\/)?([^/]+)/)
      if (urlMatch) {
        repoOwner = urlMatch[2]
        isOrg = !!urlMatch[1] // If URL contains 'orgs/', it's an organization

        // Verify owner exists and get type
        try {
          const ownerType = execSync(`gh api users/${repoOwner} --jq .type`, { encoding: 'utf-8' }).trim()
          isOrg = ownerType === 'Organization'
        } catch {
          console.log(chalk.yellow(`\n⚠️  Could not verify GitHub user/org: ${repoOwner}\n`))
          return null
        }
      } else {
        console.log(chalk.yellow('\n⚠️  Invalid GitHub repository URL format\n'))
        return null
      }
    } else {
      // Try to detect from current git repository (for existing repos)
      try {
        const repoInfo = execSync('gh repo view --json owner,name', { encoding: 'utf-8' })
        const repo = JSON.parse(repoInfo)
        repoOwner = repo.owner.login

        // Check if owner is an organization
        const ownerType = execSync(`gh api users/${repoOwner} --jq .type`, { encoding: 'utf-8' }).trim()
        isOrg = ownerType === 'Organization'
      } catch {
        // Not in a git repository - ask user where to create the project
        console.log(chalk.blue('\n📍 Where should the GitHub Project be created?\n'))

        const { ownerType } = await inquirer.prompt([
          {
            type: 'list',
            name: 'ownerType',
            message: 'Create project in:',
            choices: [
              { name: 'Personal account (your GitHub user)', value: 'user' },
              { name: 'Organization', value: 'org' }
            ]
          }
        ])

        if (ownerType === 'org') {
          const { orgName } = await inquirer.prompt([
            {
              type: 'input',
              name: 'orgName',
              message: 'Organization name:',
              validate: (input: string) => {
                if (!input || input.trim().length === 0) return 'Organization name is required'
                return true
              }
            }
          ])

          repoOwner = orgName.trim()
          isOrg = true

          // Verify org exists
          try {
            execSync(`gh api orgs/${repoOwner}`, { stdio: 'ignore' })
          } catch {
            console.log(chalk.yellow(`\n⚠️  Organization "${repoOwner}" not found or you don't have access\n`))
            return null
          }
        } else {
          // Get authenticated user
          try {
            repoOwner = execSync('gh api user --jq .login', { encoding: 'utf-8' }).trim()
            isOrg = false
          } catch {
            console.log(chalk.yellow('\n⚠️  Could not get authenticated user\n'))
            return null
          }
        }
      }
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
    const projectId = projectData.id

    console.log(chalk.green(`✅ Project created: ${projectData.url}`))

    // Configure Status field
    console.log(chalk.blue(`🔧 Configuring Status field with ${statuses.length} states...\n`))

    // Get the Status field (GitHub Projects creates it by default)
    const getFieldQuery = `
      query {
        node(id: "${projectId}") {
          ... on ProjectV2 {
            field(name: "Status") {
              ... on ProjectV2SingleSelectField {
                id
                name
              }
            }
          }
        }
      }
    `

    const fieldResult = execSync(`gh api graphql -f query='${getFieldQuery.replace(/\n/g, ' ')}'`, { encoding: 'utf-8' })
    const statusField = JSON.parse(fieldResult).data.node.field

    if (!statusField) {
      console.log(chalk.yellow('⚠️  Status field not found, skipping configuration'))
      return projectData.url
    }

    const statusFieldId = statusField.id

    // Build options array for the mutation
    const optionsJson = statuses
      .map((status) => {
        const color = status.color || 'GRAY'
        const description = status.description ? `, description: "${status.description.replace(/"/g, '\\"')}"` : ''
        return `{ name: "${status.name.replace(/"/g, '\\"')}", color: ${color}${description} }`
      })
      .join(', ')

    // Update Status field with custom options
    const updateFieldMutation = `
      mutation {
        updateProjectV2Field(input: {
          projectId: "${projectId}"
          fieldId: "${statusFieldId}"
          name: "Status"
          singleSelectOptions: [${optionsJson}]
        }) {
          projectV2Field {
            ... on ProjectV2SingleSelectField {
              id
              name
              options {
                id
                name
              }
            }
          }
        }
      }
    `

    execSync(`gh api graphql -f query='${updateFieldMutation.replace(/\n/g, ' ')}'`, { encoding: 'utf-8' })

    console.log(chalk.green('✅ Status field configured:'))
    statuses.forEach((status) => {
      const colorDot =
        status.color === 'GREEN'
          ? '🟢'
          : status.color === 'YELLOW'
            ? '🟡'
            : status.color === 'BLUE'
              ? '🔵'
              : status.color === 'PURPLE'
                ? '🟣'
                : status.color === 'ORANGE'
                  ? '🟠'
                  : status.color === 'PINK'
                    ? '🩷'
                    : status.color === 'RED'
                      ? '🔴'
                      : '⚪'
      console.log(chalk.gray(`   ${colorDot} ${status.name}${status.description ? ` - ${status.description}` : ''}`))
    })
    console.log()

    return projectData.url
  } catch (error) {
    const err = error as Error
    console.log(chalk.red(`\n❌ Failed to create GitHub Project: ${err.message}\n`))
    return null
  }
}

// Default configurations for each tool (backward compatibility)
export const DEFAULT_STATUSES = {
  'github-projects': WORKFLOW_PRESETS.standard.statuses,
  jira: [
    { name: 'Backlog', description: 'Tasks to be prioritized' },
    { name: 'Ready for Dev', description: 'Ready for development' },
    { name: 'In Progress', description: 'Currently being worked on' },
    { name: 'Code Review', description: 'In code review' },
    { name: 'Done', description: 'Completed' }
  ],
  notion: WORKFLOW_PRESETS.standard.statuses,
  linear: WORKFLOW_PRESETS.standard.statuses,
  none: []
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
 * Prompt user to select a workflow preset or create custom
 * @returns Selected workflow statuses
 */
async function promptWorkflowPreset(): Promise<WorkflowStatus[]> {
  const { preset } = await inquirer.prompt([
    {
      type: 'list',
      name: 'preset',
      message: 'Choose your workflow configuration:',
      choices: [
        {
          name: `${chalk.cyan('SaaSFoundry AI Workflow')} - 7 statuses with AI/Human testing phases ${chalk.gray('(recommended for AI-assisted development)')}`,
          value: 'saasfoundry'
        },
        {
          name: `${chalk.blue('Standard Workflow')} - 5 statuses for general development`,
          value: 'standard'
        },
        {
          name: `${chalk.yellow('Custom Workflow')} - Define your own statuses`,
          value: 'custom'
        }
      ],
      default: 'saasfoundry'
    }
  ])

  if (preset === 'custom') {
    return await promptCustomWorkflow()
  }

  const selectedPreset = WORKFLOW_PRESETS[preset as keyof typeof WORKFLOW_PRESETS]

  console.log(chalk.green(`\n✅ Using ${selectedPreset.name} with ${selectedPreset.statuses.length} statuses:`))
  selectedPreset.statuses.forEach((status, idx) => {
    const colorDot =
      status.color === 'GREEN'
        ? '🟢'
        : status.color === 'YELLOW'
          ? '🟡'
          : status.color === 'BLUE'
            ? '🔵'
            : status.color === 'PURPLE'
              ? '🟣'
              : status.color === 'ORANGE'
                ? '🟠'
                : status.color === 'PINK'
                  ? '🩷'
                  : status.color === 'RED'
                    ? '🔴'
                    : '⚪'
    console.log(chalk.gray(`   ${idx + 1}. ${colorDot} ${status.name}${status.description ? ` - ${status.description}` : ''}`))
  })
  console.log()

  return selectedPreset.statuses
}

/**
 * Prompt user to create a custom workflow with N statuses
 * @returns Array of custom workflow statuses
 */
async function promptCustomWorkflow(): Promise<WorkflowStatus[]> {
  const statuses: WorkflowStatus[] = []
  const availableColors: GitHubProjectColor[] = ['GRAY', 'YELLOW', 'BLUE', 'PURPLE', 'ORANGE', 'PINK', 'GREEN', 'RED']

  console.log(chalk.blue('\n📋 Custom Workflow Configuration'))
  console.log(chalk.gray('Define your workflow statuses. Descriptions are mandatory to help Claude understand your development process.\n'))

  let continueAdding = true
  let statusNumber = 1

  while (continueAdding) {
    console.log(chalk.cyan(`\nStatus ${statusNumber}:`))

    const { name, description, color } = await inquirer.prompt<{
      name: string
      description: string
      color: GitHubProjectColor
    }>([
      {
        type: 'input',
        name: 'name',
        message: 'Status name:',
        validate: (input: string) => {
          if (!input || input.trim().length === 0) return 'Status name is required'
          if (statuses.some((s) => s.name.toLowerCase() === input.toLowerCase())) {
            return 'Status name already exists'
          }
          return true
        }
      },
      {
        type: 'input',
        name: 'description',
        message: 'Description (mandatory for AI context):',
        validate: (input: string) => {
          if (!input || input.trim().length === 0) {
            return 'Description is required to help Claude understand this workflow step'
          }
          return true
        }
      },
      {
        type: 'list',
        name: 'color',
        message: 'Color:',
        choices: availableColors.map((c) => ({
          name: `${c === 'GRAY' ? '⚪' : c === 'YELLOW' ? '🟡' : c === 'BLUE' ? '🔵' : c === 'PURPLE' ? '🟣' : c === 'ORANGE' ? '🟠' : c === 'PINK' ? '🩷' : c === 'GREEN' ? '🟢' : '🔴'} ${c}`,
          value: c
        })),
        default: statusNumber === 1 ? 'GRAY' : statusNumber === statuses.length ? 'GREEN' : 'BLUE'
      }
    ])

    statuses.push({
      name: name.trim(),
      description: description.trim(),
      color
    })

    statusNumber++

    // Ask if user wants to add another status (require at least 2 statuses)
    if (statuses.length >= 2) {
      const { addAnother } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'addAnother',
          message: 'Add another status?',
          default: statuses.length < 5
        }
      ])

      continueAdding = addAnother
    }
  }

  console.log(chalk.green(`\n✅ ${statuses.length} statuses configured\n`))

  return statuses
}

/**
 * Main workflow configuration prompt
 * Handles template selection or new workflow creation
 * @param projectName - Optional project name to use as default for GitHub Project creation
 * @param repositoryUrl - Optional repository URL to extract owner from (for sf new before git init)
 */
export async function promptWorkflowConfiguration(
  projectName?: string,
  repositoryUrl?: string
): Promise<{
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
  let workflowStatuses: WorkflowStatus[] = []

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
        // Step 4a: Choose workflow preset
        workflowStatuses = await promptWorkflowPreset()

        // Step 4b: Enter project name (use passed projectName as default)
        const { ghProjectName } = await inquirer.prompt([
          {
            type: 'input',
            name: 'ghProjectName',
            message: 'GitHub Project name:',
            default: projectName || 'Development Board',
            validate: (input) => input.length > 0 || 'Name is required'
          }
        ])

        // Step 4c: Create project with configured statuses
        const createdUrl = await setupGitHubProjectWithAutoCreation(ghProjectName, workflowStatuses, repositoryUrl)
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
        // Manual URL entry - still ask for workflow preset
        workflowStatuses = await promptWorkflowPreset()

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
      // Not authenticated - manual URL only, but still configure workflow
      workflowStatuses = await promptWorkflowPreset()

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
    statuses: workflowStatuses.length > 0 ? workflowStatuses : DEFAULT_STATUSES[tool as keyof typeof DEFAULT_STATUSES],
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

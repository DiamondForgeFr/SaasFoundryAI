import inquirer from 'inquirer'
import chalk from 'chalk'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import type { WorkflowConfig, AIRules, WorkflowTemplate } from '../types'

const WORKFLOWS_DIR = path.join(os.homedir(), '.claude', 'workflows')

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

  // Step 2: Create new workflow
  const { tool } = await inquirer.prompt([
    {
      type: 'list',
      name: 'tool',
      message: 'Choose your project management tool:',
      choices: [
        { name: 'GitHub Projects (built-in)', value: 'github-projects' },
        { name: 'Jira (Atlassian)', value: 'jira' },
        { name: 'Notion', value: 'notion' },
        { name: 'Linear', value: 'linear' },
        { name: 'None (no project management integration)', value: 'none' }
      ]
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

  // Step 3: Tool-specific configuration
  let projectUrl = ''
  if (tool === 'github-projects') {
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
          return 'Invalid GitHub Project URL format (e.g., https://github.com/orgs/myorg/projects/1)'
        }
      }
    ])
    projectUrl = url
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

import inquirer from 'inquirer'
import chalk from 'chalk'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { execFileSync } from 'child_process'
import type { WorkflowConfig, AIRules, WorkflowTemplate, WorkflowStatus, GitHubProjectColor } from '../types'
import { fileExists } from '../utils'
import { githubRepoOf } from '../status/collect'
import { configureBoardView } from './workflow.board-view'

const WORKFLOWS_DIR = path.join(os.homedir(), '.claude', 'workflows')
const CREDENTIALS_DIR = path.join(os.homedir(), '.claude', 'credentials')

// Workflow Presets
export const WORKFLOW_PRESETS = {
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
          'First validation phase. Execute the generated test plan step by step. For each test: verify functionality, check edge cases, validate against requirements. Document all findings in ticket comments. If issues found: fix them, commit changes, and re-test. When all tests pass: post the test report, open a draft PR with the manual test plan and move to Human Testing. Heavy local validation must pass before this transition.',
        color: 'PURPLE' as GitHubProjectColor
      },
      {
        name: 'Human Testing',
        description:
          'Human validation uses an open draft PR with the diff and test plan. Test/build CI is skipped while draft. After approval and non-regression tests, mark the same PR ready and move to In Review; full CI starts. On failure, fix and repeat AI Testing.',
        color: 'ORANGE' as GitHubProjectColor
      },
      {
        name: 'In Review',
        description:
          'A non-draft pull request awaits code review with full CI. Address feedback and rerun checks after changes. After approval and green CI, wait for the developer to merge into the configured target branch before moving to Done.',
        color: 'PINK' as GitHubProjectColor
      },
      {
        name: 'Done',
        description:
          'Feature completed and merged to main branch. Code is deployed or ready for deployment. Close the ticket, archive subtasks, and update any related documentation. Celebrate the win!',
        color: 'GREEN' as GitHubProjectColor
      }
    ],
    issueTypes: [
      { name: 'sf-epic', description: 'Grouper for related sf-stories/sf-tasks (no PR, no branch)', color: 'PURPLE' as GitHubProjectColor },
      { name: 'sf-story', description: 'Delivers user-observable value', color: 'BLUE' as GitHubProjectColor },
      { name: 'sf-task', description: 'Delivers a technical action (refactor, infra, tooling)', color: 'GRAY' as GitHubProjectColor },
      { name: 'sf-issue', description: 'Defect or unexpected behavior to investigate and fix', color: 'RED' as GitHubProjectColor }
    ]
  },
  solo: {
    name: 'SaaSFoundry Solo',
    description: '5-status workflow for solo developers — same rigor and guards, less ceremony (PR review is the human gate); upgradable in place to the team workflow',
    statuses: [
      {
        name: 'Backlog',
        description:
          'Raw ideas and specs waiting to be challenged. AI must challenge the ticket with the developer to clarify requirements, identify edge cases, and validate approach before starting. Complexity label is mandatory before leaving Backlog.',
        color: 'GRAY' as GitHubProjectColor
      },
      {
        name: 'In Progress',
        description:
          'Task currently being worked on by AI after the developer confirmed pickup. One commit per subtask. When all subtasks are done: run existing tests (unit, E2E, lint, TypeScript), commit and push all changes, then move to AI Testing and generate a test plan.',
        color: 'BLUE' as GitHubProjectColor
      },
      {
        name: 'AI Testing',
        description:
          'Validation phase. Execute the generated test plan step by step, document findings in ticket comments, fix and re-test on failure. When all tests pass: post the test report, create the pull request and move to In Review — the PR review is where the developer validates.',
        color: 'PURPLE' as GitHubProjectColor
      },
      {
        name: 'In Review',
        description:
          'Pull request open — this is the human gate of the solo workflow. The developer reviews the changes (and tests manually if needed); AI monitors CI and review comments and addresses feedback. The developer merging the PR is what moves the ticket to Done.',
        color: 'PINK' as GitHubProjectColor
      },
      {
        name: 'Done',
        description: 'PR merged to the working branch. Close the ticket, clean up local branches, and update any related documentation.',
        color: 'GREEN' as GitHubProjectColor
      }
    ],
    issueTypes: [
      { name: 'sf-epic', description: 'Grouper for related sf-stories/sf-tasks (no PR, no branch)', color: 'PURPLE' as GitHubProjectColor },
      { name: 'sf-story', description: 'Delivers user-observable value', color: 'BLUE' as GitHubProjectColor },
      { name: 'sf-task', description: 'Delivers a technical action (refactor, infra, tooling)', color: 'GRAY' as GitHubProjectColor },
      { name: 'sf-issue', description: 'Defect or unexpected behavior to investigate and fix', color: 'RED' as GitHubProjectColor }
    ]
  }
}

/** Whether the GitHub CLI can create a board: installed and logged in, or which of the two is missing. */
export type GhState = 'ready' | 'unauthenticated' | 'missing'

export function ghState(): GhState {
  try {
    gh(['auth', 'status'], { quiet: true })
    return 'ready'
  } catch (error) {
    // execFileSync reports a binary absent from PATH as ENOENT; any other failure is a gh that answered
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unauthenticated'
  }
}

/** What to do about a GitHub CLI that cannot create a board (#898): `gh auth login` only exists once gh is installed. */
export function ghRemedy(state: Exclude<GhState, 'ready'>): string {
  return state === 'missing' ? 'GitHub CLI (gh) is not installed. Install it from https://cli.github.com, then run: gh auth login' : 'GitHub CLI not authenticated. Run: gh auth login'
}

/**
 * Run `gh` with an argument vector, never through a shell, so a project name
 * or an owner login reaches GitHub as given (#897).
 */
function gh(args: string[], options: { input?: string; quiet?: boolean } = {}): string {
  return execFileSync('gh', args, { encoding: 'utf-8', input: options.input, stdio: ['pipe', 'pipe', options.quiet ? 'ignore' : 'pipe'] })
}

/** A GraphQL call whose values travel as variables, never spliced into the query (#897). */
function ghGraphql<T = Record<string, unknown>>(query: string, variables: Record<string, unknown> = {}): T {
  return JSON.parse(gh(['api', 'graphql', '--input', '-'], { input: JSON.stringify({ query, variables }) })).data as T
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
  if (ghState() === 'ready') {
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
/**
 * Interactive owner picker used when no owner could be auto-detected (or the
 * user declined the detected one). Returns the resolved owner or null on
 * failure / missing access.
 */
async function promptOwnerSelection(): Promise<{ owner: string; isOrg: boolean } | null> {
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
    const owner = orgName.trim()
    try {
      gh(['api', `orgs/${encodeURIComponent(owner)}`], { quiet: true })
    } catch {
      console.log(chalk.yellow(`\n⚠️  Organization "${owner}" not found or you don't have access\n`))
      return null
    }
    return { owner, isOrg: true }
  }

  try {
    const owner = gh(['api', 'user', '--jq', '.login']).trim()
    return { owner, isOrg: false }
  } catch {
    console.log(chalk.yellow('\n⚠️  Could not get authenticated user\n'))
    return null
  }
}

/** `owner` / `repo` of a GitHub repository URL: https, scp-style (`git@github.com:o/r.git`) or `ssh://`; an org URL gives the owner only. */
export function githubOwnerOf(url: string): { owner: string; repo?: string } | undefined {
  if (!/github\.com[:/]/i.test(url)) return undefined
  const slug = githubRepoOf(url)
  if (slug) {
    const [owner, repo] = slug.split('/')
    return { owner, repo }
  }
  const org = /github\.com\/orgs\/([^/\s]+)/i.exec(url)?.[1]
  return org ? { owner: org } : undefined
}

/**
 * Create a GitHub Projects board and configure its Status field. Interactive
 * (the default), it confirms the detected owner and offers a picker; with
 * `interactive: false` (`--create-board`) the owner comes from the repository
 * URL alone and nothing is asked — no owner, no board (#821).
 */
export async function setupGitHubProjectWithAutoCreation(projectName: string, statuses: WorkflowStatus[], repositoryUrl?: string, options: { interactive?: boolean } = {}): Promise<string | null> {
  const interactive = options.interactive ?? true
  try {
    // Check gh auth
    const ghStatus = ghState()
    if (ghStatus !== 'ready') {
      console.log(chalk.yellow(`\n⚠️  ${ghRemedy(ghStatus)}\n`))
      return null
    }

    // Resolve the owner (user or org) + repo the project belongs to.
    let repoOwner: string | undefined
    let repoName: string | undefined
    let isOrg = false

    // 1) From an explicit repository URL (sf new with a known remote)
    if (repositoryUrl) {
      // The former regex missed scp-style remotes and cut `my.repo` to `my` (#821)
      const parsed = githubOwnerOf(repositoryUrl)
      if (parsed) {
        repoOwner = parsed.owner
        repoName = parsed.repo
        // Verify owner exists and get its type
        try {
          const ownerType = gh(['api', `users/${repoOwner}`, '--jq', '.type']).trim()
          isOrg = ownerType === 'Organization'
        } catch {
          console.log(chalk.yellow(`\n⚠️  Could not verify GitHub user/org: ${repoOwner}\n`))
          return null
        }
      } else {
        console.log(chalk.yellow(`\n⚠️  Not a GitHub repository URL: ${repositoryUrl}\n`))
        return null
      }
    } else if (!interactive) {
      console.log(chalk.yellow('\n⚠️  No GitHub remote to take the board owner from — add the remote, or create the board yourself and pass --project-url <url>.\n'))
      return null
    } else {
      // 2) From the current git repository (existing repos)
      try {
        const repoInfo = gh(['repo', 'view', '--json', 'owner,name'], { quiet: true })
        const repo = JSON.parse(repoInfo)
        repoOwner = repo.owner.login
        repoName = repo.name
        const ownerType = gh(['api', `users/${repoOwner}`, '--jq', '.type'], { quiet: true }).trim()
        isOrg = ownerType === 'Organization'
      } catch {
        // Not in a git repo — fall through to the manual picker below.
      }
    }

    // Confirm the auto-detected owner before creating — the board lands under
    // this account and picking the wrong one is painful to undo (#463 finding 1).
    if (repoOwner && interactive) {
      const { confirmOwner } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmOwner',
          message: `Create the GitHub Project under ${isOrg ? 'organization' : 'user'} "${repoOwner}"?`,
          default: true
        }
      ])
      if (!confirmOwner) {
        repoOwner = undefined
        repoName = undefined
      }
    }

    // Nothing detected, or the user declined — pick the owner explicitly.
    if (!repoOwner) {
      const selected = await promptOwnerSelection()
      if (!selected) return null
      repoOwner = selected.owner
      isOrg = selected.isOrg
      repoName = undefined // manual path: no specific repo to link to
    }

    console.log(chalk.blue(`\n🔨 Creating GitHub Project "${projectName}"...\n`))

    // Get owner ID (user or org)
    const ownerField = isOrg ? 'organization' : 'user'
    const owner = ghGraphql<Record<string, { id: string }>>(`query($login: String!) { ${ownerField}(login: $login) { id } }`, { login: repoOwner })
    const ownerId = owner[ownerField].id

    // Create project
    const created = ghGraphql<{ createProjectV2: { projectV2: { id: string; number: number; url: string } } }>(
      `mutation($ownerId: ID!, $title: String!) {
        createProjectV2(input: { ownerId: $ownerId, title: $title }) {
          projectV2 { id number url }
        }
      }`,
      { ownerId, title: projectName }
    )
    const projectData = created.createProjectV2.projectV2
    const projectId = projectData.id

    console.log(chalk.green(`✅ Project created: ${projectData.url}`))

    // Link the board to the repository so it surfaces under the repo's
    // Projects tab — best-effort, never fail creation on it (#463 finding 2).
    if (repoName) {
      try {
        gh(['project', 'link', String(projectData.number), '--owner', repoOwner, '--repo', `${repoOwner}/${repoName}`], { quiet: true })
        console.log(chalk.green(`✅ Linked the project to ${repoOwner}/${repoName}`))
      } catch {
        console.log(chalk.yellow(`⚠️  Could not link the project to ${repoOwner}/${repoName} — link it manually from the repo's Projects tab.`))
      }
    }

    // Configure Status field
    console.log(chalk.blue(`🔧 Configuring Status field with ${statuses.length} states...\n`))

    // Get the Status field (GitHub Projects creates it by default)
    const fieldResult = ghGraphql<{ node: { field: { id: string; name: string } | null } }>(
      `query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            field(name: "Status") {
              ... on ProjectV2SingleSelectField { id name }
            }
          }
        }
      }`,
      { projectId }
    )
    const statusField = fieldResult.node.field

    if (!statusField) {
      console.log(chalk.yellow('⚠️  Status field not found, skipping configuration'))
      return projectData.url
    }

    const statusFieldId = statusField.id

    // Update Status field with custom options
    const options = statuses.map((status) => ({ name: status.name, color: status.color || 'GRAY', description: status.description ?? '' }))
    ghGraphql(UPDATE_STATUS_OPTIONS_MUTATION, { fieldId: statusFieldId, options })

    // Display concise confirmation (full descriptions already shown when selecting the workflow)
    console.log(chalk.green(`✅ Status field configured with ${statuses.length} states`))

    // Add a Board-layout view with the team's default visible fields. The REST
    // view endpoint is create-only, so the default Table view stays — surface
    // that so the user knows they can drop it in the UI. Best-effort (#478).
    const view = configureBoardView({ owner: repoOwner, isOrg, projectNumber: projectData.number })
    if (view.created) {
      console.log(chalk.green(`✅ Added a Board view (${view.visible.length} fields)`) + chalk.gray(' — the default Table view remains; remove it from the board if you prefer.'))
      if (view.missing.length > 0) console.log(chalk.gray(`   Skipped fields not exposed by the API: ${view.missing.join(', ')}`))
    } else {
      console.log(chalk.yellow('⚠️  Could not add the Board view — configure the layout + fields manually from the board (Views → New view → Board).'))
    }

    return projectData.url
  } catch (error) {
    const err = error as Error
    console.log(chalk.red(`\n❌ Failed to create GitHub Project: ${err.message}\n`))
    return null
  }
}

/** Replace a board's Status options; names and descriptions travel as variables (#897). */
const UPDATE_STATUS_OPTIONS_MUTATION = `mutation($fieldId: ID!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
  updateProjectV2Field(input: { fieldId: $fieldId, singleSelectOptions: $options }) {
    projectV2Field {
      ... on ProjectV2SingleSelectField { id name }
    }
  }
}`

/**
 * Align an EXISTING GitHub Project's Status field with a preset's statuses
 * (in-place preset upgrade, e.g. solo → team). Options are rebuilt in the
 * preset's order; existing options that the preset doesn't know (custom
 * columns) are preserved at the end. Best-effort: returns false (with a
 * warning) instead of throwing — a board misalignment must never block the
 * manifest/skill upgrade.
 */
export async function updateGitHubProjectStatuses(projectUrl: string, statuses: WorkflowStatus[]): Promise<boolean> {
  try {
    const ghStatus = ghState()
    if (ghStatus !== 'ready') {
      console.log(chalk.yellow(`⚠️  ${ghRemedy(ghStatus)} Until then, update the GitHub Project Status field manually (Project settings → Status).`))
      return false
    }

    const match = projectUrl.match(/github\.com\/(orgs|users)\/([^/]+)\/projects\/(\d+)/)
    if (!match) {
      console.log(chalk.yellow(`⚠️  Unrecognized GitHub Project URL (${projectUrl}) — Status field not updated.`))
      return false
    }
    const [, kind, owner, number] = match
    const ownerField = kind === 'orgs' ? 'organization' : 'user'

    type StatusField = { id: string; options?: { name: string; color?: string; description?: string }[] }
    const fieldResult = ghGraphql<Record<string, { projectV2?: { field?: StatusField } } | null>>(
      `query($login: String!, $number: Int!) {
        ${ownerField}(login: $login) {
          projectV2(number: $number) {
            field(name: "Status") {
              ... on ProjectV2SingleSelectField {
                id
                options { name color description }
              }
            }
          }
        }
      }`,
      { login: owner, number: Number(number) }
    )
    const statusField = fieldResult[ownerField]?.projectV2?.field
    if (!statusField) {
      console.log(chalk.yellow('⚠️  Status field not found on the project — not updated.'))
      return false
    }

    type ExistingOption = { name: string; color?: string; description?: string }
    const existing: ExistingOption[] = statusField.options ?? []
    const presetNames = statuses.map((s) => s.name.toLowerCase())
    const missing = statuses.filter((s) => !existing.some((o) => o.name.toLowerCase() === s.name.toLowerCase()))
    const extras = existing.filter((o) => !presetNames.includes(o.name.toLowerCase()))

    if (missing.length === 0) {
      return true
    }

    // Preset order first (reusing existing descriptions/colors when the
    // option already exists keeps the board familiar), custom columns last.
    const merged = [
      ...statuses.map((s) => {
        const current = existing.find((o) => o.name.toLowerCase() === s.name.toLowerCase())
        return { name: current?.name ?? s.name, color: current?.color || s.color || 'GRAY', description: current?.description || s.description || '' }
      }),
      ...extras.map((o) => ({ name: o.name, color: o.color || 'GRAY', description: o.description || '' }))
    ]

    ghGraphql(UPDATE_STATUS_OPTIONS_MUTATION, { fieldId: statusField.id, options: merged })

    console.log(chalk.green(`✅ GitHub Project Status field updated (${missing.length} status(es) added: ${missing.map((s) => s.name).join(', ')})`))
    return true
  } catch (error) {
    const err = error as Error
    console.log(chalk.yellow(`⚠️  Could not update the GitHub Project Status field: ${err.message}`))
    console.log(chalk.gray('   Update it manually: Project settings → Status → add the missing statuses.'))
    return false
  }
}

// Default configurations for each tool (backward compatibility)
export const DEFAULT_STATUSES = {
  'github-projects': WORKFLOW_PRESETS.saasfoundry.statuses,
  jira: WORKFLOW_PRESETS.saasfoundry.statuses,
  notion: WORKFLOW_PRESETS.saasfoundry.statuses,
  linear: WORKFLOW_PRESETS.saasfoundry.statuses,
  none: []
}

export const DEFAULT_ISSUE_TYPES = WORKFLOW_PRESETS.saasfoundry.issueTypes

// The {N} ticket prefix is load-bearing, not cosmetic: sf-workflow's
// get_open_pr_for_ticket() resolves a ticket's PR via `^(feature|fix)/<ticket>(-|$)`.
// A branch without the ticket prefix (e.g. `fix/name`) never matches, so the
// In-Review / Done PR guards mis-fire and force SF_WORKFLOW_BYPASS_* on every
// ticket. Keep these patterns ticket-prefixed and in sync with that regex.
export const DEFAULT_BRANCH_NAMING = {
  feature: 'feature/{N}-{description}',
  fix: 'fix/{N}-{description}',
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

/** Branches chosen by `--working-branch` / `--pr-target-branch`, overriding the defaults and the prompts. */
export interface WorkflowBranches {
  workingBranch?: string
  prTargetBranch?: string
}

export const DEFAULT_WORKING_BRANCH = 'develop'

/** The working branch defaults to `develop`; the PR target defaults to the working branch. */
export function resolveWorkflowBranches(branches: WorkflowBranches = {}, fallbackWorkingBranch = DEFAULT_WORKING_BRANCH): { workingBranch: string; prTargetBranch: string } {
  const workingBranch = branches.workingBranch || fallbackWorkingBranch
  return { workingBranch, prTargetBranch: branches.prTargetBranch || workingBranch }
}

/** Apply explicit branch choices to a workflow built from a saved template; unset choices keep the template's. */
function withBranches<T extends Partial<WorkflowConfig>>(workflow: T, branches?: WorkflowBranches): T {
  if (!branches?.workingBranch && !branches?.prTargetBranch) return workflow
  const workingBranch = branches.workingBranch || workflow.workingBranch || DEFAULT_WORKING_BRANCH
  const prTargetBranch = branches.prTargetBranch || (branches.workingBranch ? workingBranch : workflow.prTargetBranch) || workingBranch
  return { ...workflow, workingBranch, prTargetBranch }
}

/**
 * Materialize a built-in workflow preset without prompting or provisioning a
 * remote board. Non-interactive `sf new` uses this path so an explicit
 * `--workflow` choice reaches the manifest and harness deposits instead of
 * being reduced to a collection-only preset hint.
 */
export function workflowConfigFromPreset(presetKey: keyof typeof WORKFLOW_PRESETS, tool: WorkflowConfig['tool'], branches: WorkflowBranches = {}): { workflow: WorkflowConfig; aiRules: AIRules } {
  const preset = WORKFLOW_PRESETS[presetKey]
  return {
    workflow: {
      tool,
      ...resolveWorkflowBranches(branches),
      requireCodeReview: true,
      template: preset.name,
      statuses: preset.statuses.map((status) => ({ ...status })),
      issueTypes: tool === 'github-projects' ? preset.issueTypes.map((issueType) => ({ ...issueType })) : undefined,
      branchNaming: { ...DEFAULT_BRANCH_NAMING },
      commitFormat: { ...DEFAULT_COMMIT_FORMAT, types: [...DEFAULT_COMMIT_FORMAT.types] }
    },
    aiRules: { ...DEFAULT_AI_RULES }
  }
}

/**
 * Prompt user to select a workflow preset or create custom
 * @returns Selected workflow statuses
 */
async function promptWorkflowPreset(preselected?: keyof typeof WORKFLOW_PRESETS): Promise<{ statuses: WorkflowStatus[]; isPreconfigured: boolean; presetKey?: keyof typeof WORKFLOW_PRESETS }> {
  if (preselected && WORKFLOW_PRESETS[preselected]) {
    const chosen = WORKFLOW_PRESETS[preselected]
    console.log(chalk.green(`\n✅ Using ${chosen.name} (preset passed via --workflow) with ${chosen.statuses.length} statuses.`))
    return { statuses: chosen.statuses, isPreconfigured: true, presetKey: preselected }
  }

  const { preset } = await inquirer.prompt([
    {
      type: 'list',
      name: 'preset',
      message: 'Choose your workflow configuration:',
      choices: [
        {
          name: `${chalk.cyan('SaaSFoundry AI Workflow')} - 7 statuses with AI/Human testing phases ${chalk.gray('(recommended for teams)')}`,
          value: 'saasfoundry'
        },
        {
          name: `${chalk.cyan('SaaSFoundry Solo')} - 5 statuses, PR review as the human gate ${chalk.gray('(solo developers — upgradable to the team workflow)')}`,
          value: 'solo'
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
    return {
      statuses: await promptCustomWorkflow(),
      isPreconfigured: false
    }
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

  return {
    statuses: selectedPreset.statuses,
    isPreconfigured: true,
    presetKey: preset as keyof typeof WORKFLOW_PRESETS
  }
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
  repositoryUrl?: string,
  presetOverride?: keyof typeof WORKFLOW_PRESETS,
  preselectedTool?: WorkflowConfig['tool'],
  existingProjectUrl?: string,
  branches?: WorkflowBranches
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

      // Prompt for project-specific values (same as new workflow creation)
      if (template.tool === 'github-projects') {
        // Check if GitHub CLI is authenticated
        const ghStatus = ghState()

        if (ghStatus === 'ready') {
          const { autoCreate } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'autoCreate',
              message: 'Create a new GitHub Project automatically?',
              default: true
            }
          ])

          if (autoCreate) {
            const { ghProjectName } = await inquirer.prompt([
              {
                type: 'input',
                name: 'ghProjectName',
                message: 'GitHub Project name:',
                default: projectName || 'Development Board',
                validate: (input) => {
                  if (!input || input.trim().length === 0) return 'Project name is required'
                  return true
                }
              }
            ])

            // Create project with template statuses
            const createdUrl = await setupGitHubProjectWithAutoCreation(ghProjectName, template.statuses || [], repositoryUrl)
            if (createdUrl) {
              workflowConfig.projectUrl = createdUrl
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
                    return 'Please enter a valid GitHub Project URL'
                  }
                }
              ])
              workflowConfig.projectUrl = url
            }
          } else {
            // Manual URL entry
            const { url } = await inquirer.prompt([
              {
                type: 'input',
                name: 'url',
                message: 'GitHub Project URL:',
                validate: (input) => {
                  if (input.match(/github\.com\/(orgs|users)\/[^/]+\/projects\/\d+/)) {
                    return true
                  }
                  return 'Please enter a valid GitHub Project URL'
                }
              }
            ])
            workflowConfig.projectUrl = url
          }
        } else {
          // GitHub CLI missing or not authenticated, ask for URL
          console.log(chalk.yellow(`\n💡 ${ghRemedy(ghStatus)}\n`))
          const { url } = await inquirer.prompt([
            {
              type: 'input',
              name: 'url',
              message: 'GitHub Project URL:',
              validate: (input) => {
                if (input.match(/github\.com\/(orgs|users)\/[^/]+\/projects\/\d+/)) {
                  return true
                }
                return 'Please enter a valid GitHub Project URL'
              }
            }
          ])
          workflowConfig.projectUrl = url
        }
      } else if (template.tool !== 'none') {
        // For other tools (Jira, Notion, Linear), just ask for URL
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
        workflow: withBranches(workflowConfig, branches) as WorkflowConfig,
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

  // Tracker already chosen in the tools-first step (FR-CONFIG-ENGINE-04) —
  // honour it instead of re-asking. Falls back to the interactive prompt when
  // no preselection was threaded through.
  let tool: WorkflowConfig['tool']
  if (preselectedTool) {
    tool = preselectedTool
    console.log(chalk.gray(`Using the tracker selected earlier: ${preselectedTool}\n`))
  } else {
    ;({ tool } = await inquirer.prompt([
      {
        type: 'list',
        name: 'tool',
        message: 'Choose your project management tool:',
        choices,
        default: recommended !== 'none' ? recommended : 'github-projects'
      }
    ]))
  }

  if (tool === 'none') {
    return {
      workflow: {
        tool: 'none',
        ...resolveWorkflowBranches(branches),
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
  let isPreconfiguredWorkflow = false
  let selectedPresetKey: keyof typeof WORKFLOW_PRESETS | undefined

  if (tool === 'github-projects') {
    // Reuse an already-configured board instead of silently creating a
    // duplicate when re-running config on a project that already has one
    // (#463 finding 5).
    let reused = false
    if (existingProjectUrl) {
      const { reuse } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'reuse',
          message: `This project already references a GitHub Project board:\n  ${existingProjectUrl}\nReuse it (no new board will be created)?`,
          default: true
        }
      ])
      if (reuse) {
        const presetResult = await promptWorkflowPreset(presetOverride)
        workflowStatuses = presetResult.statuses
        isPreconfiguredWorkflow = presetResult.isPreconfigured
        selectedPresetKey = presetResult.presetKey
        projectUrl = existingProjectUrl
        reused = true
      }
    }

    // Offer auto-creation if gh is authenticated
    if (!reused && available.includes('github-projects')) {
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
        const presetResult = await promptWorkflowPreset(presetOverride)
        workflowStatuses = presetResult.statuses
        isPreconfiguredWorkflow = presetResult.isPreconfigured
        selectedPresetKey = presetResult.presetKey

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
        const presetResult = await promptWorkflowPreset(presetOverride)
        workflowStatuses = presetResult.statuses
        isPreconfiguredWorkflow = presetResult.isPreconfigured
        selectedPresetKey = presetResult.presetKey

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
    } else if (!reused) {
      // Not authenticated - manual URL only, but still configure workflow
      const presetResult = await promptWorkflowPreset(presetOverride)
      workflowStatuses = presetResult.statuses
      isPreconfiguredWorkflow = presetResult.isPreconfigured
      selectedPresetKey = presetResult.presetKey

      const ghStatus = ghState()
      if (ghStatus !== 'ready') console.log(chalk.yellow(`\n💡 ${ghRemedy(ghStatus)} — it lets sf create GitHub Projects for you.\n`))
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

  // Step 4: Git workflow configuration — a branch passed as a flag is not asked again
  const branchAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'workingBranch',
      message: 'Working branch (rebase from + PR target):',
      default: DEFAULT_WORKING_BRANCH,
      when: () => !branches?.workingBranch
    },
    {
      type: 'input',
      name: 'prTargetBranch',
      message: 'Override PR target? (leave empty to use working branch):',
      default: '',
      when: () => !branches?.prTargetBranch
    }
  ])

  const { workingBranch, prTargetBranch } = resolveWorkflowBranches({
    workingBranch: branches?.workingBranch || branchAnswers.workingBranch,
    prTargetBranch: branches?.prTargetBranch || branchAnswers.prTargetBranch
  })

  // For preconfigured workflows (SaaSFoundry AI), code review is implicit in the workflow (In Review status)
  // For custom workflows, ask explicitly
  let requireCodeReview = true
  if (!isPreconfiguredWorkflow) {
    const { requireCodeReview: codeReview } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'requireCodeReview',
        message: 'Require code review before merging?',
        default: true
      }
    ])
    requireCodeReview = codeReview
  }

  // Step 5: AI Rules
  // For preconfigured workflows (SaaSFoundry AI), rules are implicit
  // For custom workflows, let user configure them
  if (isPreconfiguredWorkflow) {
    // Use default AI rules for preconfigured workflow
    aiRulesConfig = {
      alwaysCreateBranchFromWorking: true,
      alwaysCreateTicketBeforeCode: true,
      autoUpdateTicketStatus: true,
      requireHumanCheckOnPushedBranch: true
    }
  } else {
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
            name: 'Require human validation before marking PR ready (test → draft PR → approval → ready)',
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
  }

  workflowConfig = {
    tool,
    projectUrl,
    workingBranch,
    prTargetBranch,
    requireCodeReview,
    template: selectedPresetKey ? WORKFLOW_PRESETS[selectedPresetKey].name : undefined,
    statuses: workflowStatuses.length > 0 ? workflowStatuses : DEFAULT_STATUSES[tool as keyof typeof DEFAULT_STATUSES],
    issueTypes: tool === 'github-projects' ? DEFAULT_ISSUE_TYPES : undefined,
    branchNaming: DEFAULT_BRANCH_NAMING,
    commitFormat: DEFAULT_COMMIT_FORMAT
  }

  // Step 6: Save as template?
  // For preconfigured workflows, saving as template is not needed (already available globally)
  // For custom workflows, offer to save as reusable template
  if (!isPreconfiguredWorkflow) {
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
        issueTypes: workflowConfig.issueTypes,
        branchNaming: workflowConfig.branchNaming!,
        commitFormat: workflowConfig.commitFormat!,
        aiRules: aiRulesConfig
      })

      console.log(chalk.green(`\n✅ Workflow template "${templateName}" saved\n`))
      workflowConfig.template = templateName
    }
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

import { Command } from 'commander'
import { DEFAULT_OUTPUT_LANGUAGE } from '../language'
import { getAgentIds, isHarnessAgent } from '../harness/agent-registry'
import { assertGitBranchName } from '../run'
import { findTool, ToolCategory, toolsByCategory } from '../tools/catalogue'
import { Answers, DbCredentials, HarnessAgent, S3Credentials } from '../types'
import { parseWorkflowFlag } from './workflow-flag'

export interface NewCommandOptions {
  nonInteractive?: boolean

  // Intent profile (what to install)
  profile?: 'full' | 'harness' | 'stack'
  agents?: string

  // Project basics
  projectName?: string
  projectDescription?: string
  structure?: 'monorepo' | 'multirepo'
  mainBranch?: 'main' | 'master'

  // Repository
  setupRepo?: 'local' | 'existing'
  monorepoUrl?: string
  backendRepoUrl?: string
  frontendRepoUrl?: string

  // Database
  dbSetup?: 'docker' | 'credentials' | 'manual'
  dbType?: 'postgresql' | 'sql'
  dbHost?: string
  dbPort?: string
  dbUser?: string
  dbPassword?: string
  dbName?: string

  // Ports. An explicit value is honoured or refused, never moved (#584); the db port
  // is only a local one when `dbSetup` is `docker`.
  apiPort?: string
  webPort?: string

  // Email
  emailService?: 'none' | 'mailersend'
  mailersendApiKey?: string
  mailersendSenderEmail?: string
  mailersendSenderName?: string

  // Storage
  s3Setup?: 'docker' | 'credentials' | 'manual'
  s3Endpoint?: string
  s3AccessKey?: string
  s3SecretKey?: string
  s3Bucket?: string
  s3Region?: string

  // Analytics
  analytics?: boolean
  pwa?: boolean

  // Output language of AI-produced artefacts (BCP-47 tag). Defaults to English.
  language?: string

  // Advanced skills
  advancedSkills?: string
  context7ApiKey?: string
  atlassianEmail?: string
  atlassianApiToken?: string
  atlassianSite?: string
  atlassianCloudId?: string
  notionApiToken?: string
  notionApiVersion?: string
  figmaApiToken?: string

  // SRS bootstrap (opt-in)
  srsEnable?: boolean
  srsBackend?: 'notion'
  srsParentPageInput?: string

  // SRS existing-notes ingestion (opt-in, requires srsEnable)
  srsIngestEnable?: boolean
  srsIngestParentInput?: string

  // Tools-first selection (FR-CONFIG-ENGINE-04). Tracker/docs take one tool;
  // design takes a comma-separated list. `--no-network` makes Commander set
  // `network = false`, degrading the connection checks to presence only.
  tracker?: string
  docs?: string
  design?: string
  network?: boolean

  // Workflow (flag allows skipping; full config still goes through `sf workflow` or interactive)
  workflow?: string | boolean
  workingBranch?: string
  prTargetBranch?: string
  projectUrl?: string
  createBoard?: boolean

  // Post-setup behavior
  startServices?: boolean
  startApps?: 'all' | 'backend' | 'frontend' | 'none'
}

/**
 * Declare every option of `sf new` on its Commander command.
 *
 * Kept here rather than inline in `src/index.ts` so a test can build the real command without
 * running the CLI: the `tool-saasfoundry` skill's `reference/new-flags.json` is checked against
 * it in both directions, so a flag added here and not there fails the suite (#968).
 */
export function registerNewCommandOptions(command: Command): Command {
  return (
    command
      .option('--non-interactive', 'Fail if any required value is missing instead of prompting')
      // Intent profile
      .option('--profile <profile>', 'What to install: full (stack + AI harness, default), harness (AI workflow/skills/SRS on an existing project), or stack (technical base only)')
      .option('--agents <agents>', 'Comma-separated coding-agent profiles to configure (for example: claude-code,codex)')
      // Project basics
      .option('--project-name <name>', 'Project name (kebab-case)')
      .option('--project-description <description>', 'Project description')
      .option('--structure <structure>', 'Project structure: monorepo or multirepo')
      .option('--main-branch <branch>', 'Main branch name: main or master')
      // Repository
      .option('--setup-repo <setup>', 'Repository setup: local or existing')
      .option('--monorepo-url <url>', 'Monorepo remote URL (when --structure monorepo and --setup-repo existing)')
      .option('--backend-repo-url <url>', 'Backend repository URL (when --structure multirepo and --setup-repo existing)')
      .option('--frontend-repo-url <url>', 'Frontend repository URL (when --structure multirepo and --setup-repo existing)')
      // Database
      .option('--db-setup <setup>', 'Database setup: docker, credentials, or manual')
      .option('--db-type <type>', 'Database type: postgresql or sql')
      .option('--db-host <host>', 'Database host')
      .option('--db-port <port>', 'Database port (default: first free from 5435)')
      .option('--db-user <user>', 'Database user')
      .option('--db-password <password>', 'Database password')
      .option('--db-name <name>', 'Database name')

      // Ports — an explicit value is honoured or refused, never silently moved (#584)
      .option('--api-port <port>', 'Host port the API listens on (default: first free from 3500)')
      .option('--web-port <port>', 'Host port the web dev server listens on (default: first free from 5173)')
      // Email
      .option('--email-service <service>', 'Email service: none or mailersend')
      .option('--mailersend-api-key <key>', 'MailerSend API key')
      .option('--mailersend-sender-email <email>', 'MailerSend sender email')
      .option('--mailersend-sender-name <name>', 'MailerSend sender name')
      // Storage
      .option('--s3-setup <setup>', 'S3 storage setup: docker, credentials, or manual')
      .option('--s3-endpoint <endpoint>', 'S3 endpoint URL')
      .option('--s3-access-key <key>', 'S3 access key')
      .option('--s3-secret-key <key>', 'S3 secret key')
      .option('--s3-bucket <bucket>', 'S3 bucket name')
      .option('--s3-region <region>', 'S3 region')
      // Analytics
      .option('--analytics', 'Include analytics module')
      .option('--no-analytics', 'Skip analytics module')
      .option('--pwa', 'Make the app installable as a desktop application (default)')
      .option('--no-pwa', 'Skip the installable-app module')
      // Output language
      .option('--language <tag>', 'Language the AI writes in — SRS, tickets, code comments (BCP-47 tag, default: en)')
      // Advanced skills
      .option('--advanced-skills <skills>', 'Comma-separated list of advanced skills (context7,atlassian,notion,figma)')
      .option('--context7-api-key <key>', 'Context7 API key (unused — free public API)')
      .option('--atlassian-email <email>', 'Atlassian account email')
      .option('--atlassian-api-token <token>', 'Atlassian API token')
      .option('--atlassian-site <site>', 'Atlassian site name (e.g. "mycompany")')
      .option('--atlassian-cloud-id <id>', 'Atlassian Cloud ID')
      .option('--notion-api-token <token>', 'Notion API token (prefer NOTION_API_TOKEN for SRS setup)')
      .option('--notion-api-version <version>', 'Notion API version (default: 2022-06-28)')
      .option('--figma-api-token <token>', 'Figma API token')
      // SRS bootstrap (opt-in)
      .option('--srs-enable', 'Enable SRS bootstrap (creates Notion workspace)')
      .option('--no-srs-enable', 'Skip SRS bootstrap')
      .option('--srs-backend <backend>', 'SRS backend (V1: notion)')
      .option('--srs-parent-page-input <urlOrId>', 'URL or ID of the Notion parent page that will host the SRS workspace')
      .option('--srs-ingest-enable', 'Enable ingestion of existing notes into the SRS after bootstrap')
      .option('--no-srs-ingest-enable', 'Skip existing-notes ingestion')
      .option('--srs-ingest-parent-input <urlOrId>', 'URL or ID of the Notion parent page that contains the existing notes to ingest')
      // Tools-first selection (FR-CONFIG-ENGINE-04)
      .option('--tracker <tool>', 'Issue/project tracker: github-projects, jira, notion, or linear')
      .option('--docs <tool>', 'Docs/SRS backend: notion, confluence, or local-markdown')
      .option('--design <tools>', 'Comma-separated design tools (figma,miro)')
      .option('--no-network', 'Skip live connection checks; verify credential presence only')
      // Workflow
      .option('--workflow <preset>', 'Workflow preset: solo, saasfoundry, or none')
      .option('--no-workflow', 'Skip workflow configuration entirely')
      .option('--working-branch <branch>', 'Working branch: feature branches start from it and pull requests target it (default: develop)')
      .option('--pr-target-branch <branch>', 'Branch pull requests target (default: the working branch)')
      .option('--project-url <url>', 'Attach an existing board to the workflow (GitHub Projects, Jira, Notion or Linear URL)')
      .option('--create-board', 'Create the GitHub Projects board, owned by the account of the git remote, without prompting')
      // Post-setup behavior
      .option('--start-services', 'Start dev services automatically (DB + MinIO)')
      .option('--no-start-services', 'Do not start dev services after setup')
      .option('--start-apps <mode>', 'Apps to start after setup: all, backend, frontend, none')
  )
}

/**
 * Convert Commander-parsed options into a `Partial<Answers>` prefill
 * consumable by the config-engine session (`runConfigSession`).
 *
 * Only fields that were explicitly passed end up in the prefill, apart from
 * safe non-interactive defaults and the opt-in SRS token environment fallback.
 */
export function buildPrefillFromOptions(opts: NewCommandOptions, env: NodeJS.ProcessEnv = process.env): Partial<Answers> {
  const prefill: Partial<Answers> = {}

  // Intent profile is opt-in; in --non-interactive mode default to `full` so
  // existing flag-driven invocations keep today's behaviour without a new flag.
  if (opts.profile !== undefined) prefill.profile = opts.profile
  else if (opts.nonInteractive === true) prefill.profile = 'full'

  if (opts.agents !== undefined) prefill.agents = parseAgentsOption(opts.agents)

  if (opts.projectName !== undefined) prefill.projectName = opts.projectName
  if (opts.projectDescription !== undefined) prefill.projectDescription = opts.projectDescription
  if (opts.structure !== undefined) prefill.isMonorepo = opts.structure === 'monorepo'
  if (opts.mainBranch !== undefined) prefill.mainBranch = opts.mainBranch

  if (opts.setupRepo !== undefined) prefill.setupRepo = opts.setupRepo
  if (opts.monorepoUrl !== undefined) prefill.monorepoUrl = opts.monorepoUrl
  if (opts.backendRepoUrl !== undefined) prefill.backendRepoUrl = opts.backendRepoUrl
  if (opts.frontendRepoUrl !== undefined) prefill.frontendRepoUrl = opts.frontendRepoUrl

  if (opts.dbSetup !== undefined) prefill.dbSetup = opts.dbSetup

  const dbCreds: Partial<DbCredentials> = {}
  if (opts.dbType !== undefined) dbCreds.dbType = opts.dbType
  if (opts.dbHost !== undefined) dbCreds.host = opts.dbHost
  if (opts.dbPort !== undefined) dbCreds.port = opts.dbPort
  if (opts.dbUser !== undefined) dbCreds.user = opts.dbUser
  if (opts.dbPassword !== undefined) dbCreds.password = opts.dbPassword
  if (opts.dbName !== undefined) dbCreds.database = opts.dbName
  if (Object.keys(dbCreds).length > 0) prefill.dbCredentials = dbCreds as DbCredentials

  if (opts.emailService !== undefined) prefill.emailService = opts.emailService
  if (opts.mailersendApiKey !== undefined) prefill.mailersendApiKey = opts.mailersendApiKey
  if (opts.mailersendSenderEmail !== undefined) prefill.mailersendSenderEmail = opts.mailersendSenderEmail
  if (opts.mailersendSenderName !== undefined) prefill.mailersendSenderName = opts.mailersendSenderName

  if (opts.s3Setup !== undefined) prefill.s3Setup = opts.s3Setup

  const s3Creds: Partial<S3Credentials> = {}
  if (opts.s3Endpoint !== undefined) s3Creds.endpoint = opts.s3Endpoint
  if (opts.s3AccessKey !== undefined) s3Creds.accessKey = opts.s3AccessKey
  if (opts.s3SecretKey !== undefined) s3Creds.secretKey = opts.s3SecretKey
  if (opts.s3Bucket !== undefined) s3Creds.bucket = opts.s3Bucket
  if (opts.s3Region !== undefined) s3Creds.region = opts.s3Region
  if (Object.keys(s3Creds).length > 0) prefill.s3Credentials = s3Creds as S3Credentials

  if (opts.analytics !== undefined) prefill.includeAnalytics = opts.analytics
  // Default-on module. In --non-interactive the config session throws on any unfilled field
  // rather than applying the step's `default`, so the default has to be materialised here —
  // same shape as `profile` above. Without this, every scripted `sf new` would be forced to
  // pass a flag just to get the documented default behaviour.
  if (opts.pwa !== undefined) prefill.includePwa = opts.pwa
  else if (opts.nonInteractive === true) prefill.includePwa = true

  // Same non-interactive materialisation as `pwa` above: the session throws on an
  // unfilled field instead of applying the step default, so a scripted `sf new`
  // would otherwise be forced to pass a flag just to get English.
  if (opts.language !== undefined) prefill.outputLanguage = opts.language
  else if (opts.nonInteractive === true) prefill.outputLanguage = DEFAULT_OUTPUT_LANGUAGE

  if (opts.advancedSkills !== undefined) {
    prefill.advancedSkills = opts.advancedSkills
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }

  if (opts.context7ApiKey !== undefined) prefill.context7ApiKey = opts.context7ApiKey
  if (opts.atlassianEmail !== undefined) prefill.atlassianEmail = opts.atlassianEmail
  if (opts.atlassianApiToken !== undefined) prefill.atlassianApiToken = opts.atlassianApiToken
  if (opts.atlassianSite !== undefined) prefill.atlassianSite = opts.atlassianSite
  if (opts.atlassianCloudId !== undefined) prefill.atlassianCloudId = opts.atlassianCloudId
  // An assistant-led SRS setup must not require a secret in argv, shell history,
  // or the planner's intent JSON. Keep the flag for compatibility, but prefer
  // NOTION_API_TOKEN when SRS bootstrap is explicitly requested without it.
  const notionApiToken = opts.notionApiToken ?? (opts.srsEnable === true ? env.NOTION_API_TOKEN : undefined)
  if (notionApiToken !== undefined) prefill.notionApiToken = notionApiToken
  if (opts.notionApiVersion !== undefined) prefill.notionApiVersion = opts.notionApiVersion
  if (opts.figmaApiToken !== undefined) prefill.figmaApiToken = opts.figmaApiToken

  // SRS bootstrap is opt-in. In --non-interactive mode, default to `false` so the
  // command never blocks on the srsEnable confirm prompt unless the user explicitly
  // passes --srs-enable (matches the email.ready pattern in `sf update`).
  if (opts.srsEnable !== undefined) prefill.srsEnable = opts.srsEnable
  else if (opts.nonInteractive === true) prefill.srsEnable = false
  if (opts.srsBackend !== undefined) prefill.srsBackend = opts.srsBackend
  if (opts.srsParentPageInput !== undefined) prefill.srsParentPageInput = opts.srsParentPageInput

  // Ingestion is also opt-in; same non-interactive safety as srsEnable.
  if (opts.srsIngestEnable !== undefined) prefill.srsIngestEnable = opts.srsIngestEnable
  else if (opts.nonInteractive === true) prefill.srsIngestEnable = false
  if (opts.srsIngestParentInput !== undefined) prefill.srsIngestParentInput = opts.srsIngestParentInput

  // Tools-first selections → manifest.tools registry (FR-CONFIG-ENGINE-04).
  const toolSelections: NonNullable<Answers['toolSelections']> = {}
  if (opts.tracker !== undefined) toolSelections.tracker = { name: opts.tracker }
  if (opts.docs !== undefined) toolSelections.docs = { name: opts.docs }
  if (opts.design !== undefined) {
    const design = opts.design
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ name }))
    if (design.length > 0) toolSelections.design = design
  }
  assertKnownTools(toolSelections)
  if (Object.keys(toolSelections).length > 0) prefill.toolSelections = toolSelections

  // `--no-network` (Commander → network === false) degrades checks to presence.
  if (opts.network === false) prefill.toolsNoNetwork = true

  // `--workflow <preset>` preselects a workflow preset; an unknown value is
  // refused here, before any question, as `sf update` does. `none` and
  // `--no-workflow` skip the workflow step, interactive or not.
  const workflow = parseWorkflowFlag(opts.workflow)
  if (workflow.preset) prefill.workflowPreset = workflow.preset
  if (workflow.disabled) {
    const workflowFlags = (
      [
        ['workingBranch', '--working-branch'],
        ['prTargetBranch', '--pr-target-branch'],
        ['projectUrl', '--project-url'],
        ['createBoard', '--create-board']
      ] as const
    ).filter(([key]) => opts[key] !== undefined && opts[key] !== false)
    if (workflowFlags.length > 0) throw new Error(`${workflowFlags[0][1]} configures a workflow, which --no-workflow skips: drop one of them.`)
    prefill.workflowDisabled = true
  }

  const workflowBranches = parseWorkflowBranches(opts)
  if (workflowBranches) {
    // Non-interactively, only a preset builds a workflow: without one the branches would be dropped
    if (opts.nonInteractive === true && !prefill.workflowPreset) {
      throw new Error('--working-branch and --pr-target-branch configure a workflow: pass --workflow solo or --workflow saasfoundry with them.')
    }
    prefill.workflowBranches = workflowBranches
  }

  if (opts.projectUrl !== undefined || opts.createBoard === true) {
    if (opts.projectUrl !== undefined && opts.createBoard === true) throw new Error('--project-url and --create-board are exclusive: attach an existing board, or create one.')
    if (opts.nonInteractive === true && !prefill.workflowPreset) {
      throw new Error(`${opts.createBoard ? '--create-board' : '--project-url'} configures a workflow: pass --workflow solo or --workflow saasfoundry with it.`)
    }
    if (opts.createBoard === true && opts.tracker !== undefined && opts.tracker !== 'github-projects') {
      throw new Error(`--create-board creates a GitHub Projects board, not a ${opts.tracker} one: pass --project-url <url> for an existing ${opts.tracker} board.`)
    }
    prefill.workflowBoard = opts.createBoard === true ? { create: true } : { projectUrl: opts.projectUrl }
  }

  return prefill
}

/** `--tracker`, `--docs` and `--design` name catalogue tools or `none`; anything else is refused before any question (#914). */
function assertKnownTools(selections: NonNullable<Answers['toolSelections']>): void {
  const check = (category: ToolCategory, flag: string, name: string | undefined, allowNone: boolean): void => {
    if (name === undefined || (allowNone && name === 'none') || findTool(category, name)) return
    const valid = [...toolsByCategory(category).map((tool) => tool.name), ...(allowNone ? ['none'] : [])]
    throw new Error(`${flag} ${name}: unknown ${category} tool. Use one of: ${valid.join(', ')}.`)
  }
  check('tracker', '--tracker', selections.tracker?.name, true)
  check('docs', '--docs', selections.docs?.name, true)
  for (const tool of selections.design ?? []) check('design', '--design', tool.name, false)
}

/** `--working-branch` / `--pr-target-branch`, validated as Git does: `sf new` passes them to git. */
function parseWorkflowBranches(opts: NewCommandOptions): Answers['workflowBranches'] {
  const branches: NonNullable<Answers['workflowBranches']> = {}
  for (const [key, flag] of [
    ['workingBranch', '--working-branch'],
    ['prTargetBranch', '--pr-target-branch']
  ] as const) {
    const value = opts[key]
    if (value === undefined) continue
    try {
      assertGitBranchName(value)
    } catch {
      throw new Error(`${flag}: invalid Git branch name ${JSON.stringify(value)}`)
    }
    branches[key] = value
  }
  return Object.keys(branches).length > 0 ? branches : undefined
}

/** Parse the comma-separated --agents option against the versioned registry. */
export function parseAgentsOption(value: string): HarnessAgent[] {
  const agents = [
    ...new Set(
      value
        .split(',')
        .map((agent) => agent.trim())
        .filter(Boolean)
    )
  ]
  if (agents.length === 0) throw new Error('The --agents option requires at least one registered coding-agent profile.')
  const unsupported = agents.filter((agent) => !isHarnessAgent(agent))
  if (unsupported.length > 0) {
    throw new Error(`Unknown coding agent '${unsupported[0]}'. Supported profiles: ${getAgentIds().join(', ')}. Model names and providers are separate.`)
  }
  return agents as HarnessAgent[]
}

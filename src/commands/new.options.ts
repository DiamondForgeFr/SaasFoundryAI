import { DEFAULT_OUTPUT_LANGUAGE } from '../language'
import { getAgentIds, isHarnessAgent } from '../harness/agent-registry'
import { assertGitBranchName } from '../run'
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
  if (Object.keys(toolSelections).length > 0) prefill.toolSelections = toolSelections

  // `--no-network` (Commander → network === false) degrades checks to presence.
  if (opts.network === false) prefill.toolsNoNetwork = true

  // `--workflow <preset>` preselects a workflow preset; an unknown value is
  // refused here, before any question, as `sf update` does.
  const workflow = parseWorkflowFlag(opts.workflow)
  if (workflow.preset) prefill.workflowPreset = workflow.preset

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

/**
 * Whether the workflow step should be skipped entirely, based on the
 * `--workflow` / `--no-workflow` flags.
 *
 * - `--no-workflow` → Commander sets `opts.workflow = false`
 * - `--workflow none` → explicit skip
 * - anything else → interactive config (or prefilled `workflow` object, handled upstream)
 */
export function shouldSkipWorkflow(opts: NewCommandOptions): boolean {
  if (opts.workflow === false) return true
  if (typeof opts.workflow === 'string' && opts.workflow.toLowerCase() === 'none') return true
  return false
}

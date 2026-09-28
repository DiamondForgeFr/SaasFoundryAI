import { AdvancedSkillCredentials } from '../prompts/skills.prompts'
import type { ProjectCapabilities } from '../project-capabilities'
import type { TechnicalStackDryRunReport } from '../scaffold/technical-stack.planner'
import type { Answers, DbCredentials, S3Credentials } from '../types'

export type ConflictStrategy = 'keep' | 'replace' | 'save-new'
export type UpdateTargetProfile = 'full'

export interface UpdateCommandOptions {
  nonInteractive?: boolean
  dryRun?: boolean
  json?: boolean
  targetProfile?: string
  acceptTemplateUpdates?: boolean
  conflictStrategy?: string
  /** Built-in workflow preset used when installing the harness non-interactively. */
  workflow?: string | boolean

  // Explicit adoption of a project created before manifests existed.
  adoptLegacy?: boolean
  adoptPlan?: string
  projectName?: string
  mainBranch?: string

  // Module selection
  addModules?: string

  // Technical stack adoption
  projectDescription?: string
  structure?: 'monorepo' | 'multirepo'
  dbSetup?: 'docker' | 'credentials' | 'manual'
  dbType?: 'postgresql' | 'sql'
  dbHost?: string
  dbPort?: string
  dbUser?: string
  dbPassword?: string
  dbName?: string
  apiPort?: string
  webPort?: string
  emailService?: 'none' | 'mailersend'
  analytics?: boolean
  pwa?: boolean

  // Email module
  mailersendApiKey?: string
  mailersendSenderEmail?: string
  mailersendSenderName?: string

  // Storage module
  s3Setup?: 'docker' | 'credentials' | 'manual'
  s3Endpoint?: string
  s3AccessKey?: string
  s3SecretKey?: string
  s3Bucket?: string
  s3Region?: string

  // Skill credentials
  context7ApiKey?: string
  atlassianEmail?: string
  atlassianApiToken?: string
  atlassianSite?: string
  atlassianCloudId?: string
  notionApiToken?: string
  notionApiVersion?: string
  figmaApiToken?: string

  // SRS bootstrap
  srsBackend?: 'notion'
  srsParentPageInput?: string
}

export interface UpdatePrefill {
  selectedModules?: string[]
  email: { ready?: boolean; mailersendApiKey?: string; mailersendSenderEmail?: string; mailersendSenderName?: string }
  storage: { s3Setup?: 'docker' | 'credentials'; endpoint?: string; accessKey?: string; secretKey?: string; bucket?: string; region?: string }
  skills: AdvancedSkillCredentials
  srs: { srsBackend?: 'notion'; srsParentPageInput?: string; notionApiToken?: string; notionApiVersion?: string }
  workflowPreset?: 'solo' | 'saasfoundry'
  workflowDisabled?: boolean
}

/**
 * Machine-readable preview emitted on stdout when `sf update --dry-run` runs.
 * Contains no side effects — callers can parse it to verify what the command
 * would do without actually mutating the project.
 */
export interface UpdateDryRunReport {
  version: 1
  mutated: false
  cliVersion: string
  projectVersion: string
  conflictStrategy: ConflictStrategy
  profileTransition?: {
    targetProfile: UpdateTargetProfile
    currentCapabilities: ProjectCapabilities
    resultCapabilities?: ProjectCapabilities
    status: 'ready' | 'blocked' | 'noop'
    plan?: TechnicalStackDryRunReport
    reasonCode?: string
    remediation?: Array<{ command: string; description: string }>
  }
  templateUpdate:
    | { status: 'blocked'; reasonCode: 'template-analysis-failed' }
    | { status: 'skipped-no-hashes' }
    | { status: 'up-to-date' }
    | { status: 'no-changes' }
    | {
        status: 'would-apply'
        update: string[]
        add: string[]
        conflict: string[]
        remove: string[]
      }
  harnessRefresh?:
    | { status: 'adoption-needed' }
    | {
        status: 'would-apply'
        update: string[]
        add: string[]
        conflict: string[]
      }
  moduleAddition: {
    available: string[]
    selected: string[]
    harness?: { workflowConfigured: boolean; skills: string[] }
    email?: { configured: boolean }
    storage?: { s3Setup: 'docker' | 'credentials'; credentialsProvided: boolean }
    skills: string[]
    wouldRunNpmInstall: boolean
    /** Values intentionally omitted from the preview but required to apply. */
    requiredForApply?: string[]
  }
}

const VALID_STRATEGIES: ReadonlyArray<ConflictStrategy> = ['keep', 'replace', 'save-new']
const VALID_TARGET_PROFILES: ReadonlyArray<UpdateTargetProfile> = ['full']

/**
 * Parse the requested capability result. V1 is deliberately additive and only
 * supports convergence to `full`; accepting any other spelling would make a
 * removal or topology-conversion request look supported when it is not.
 */
export function parseTargetProfile(value: string | undefined): UpdateTargetProfile | undefined {
  if (value === undefined) return undefined
  if ((VALID_TARGET_PROFILES as ReadonlyArray<string>).includes(value)) return value as UpdateTargetProfile
  throw new Error(`Invalid --target-profile "${value}". V1 supports only: ${VALID_TARGET_PROFILES.join(', ')}.`)
}

/** Validate output-mode combinations before update performs any I/O. */
export function validateUpdateOutputOptions(opts: Pick<UpdateCommandOptions, 'dryRun' | 'json'>): void {
  if (opts.json === true && opts.dryRun !== true) throw new Error('The --json option requires --dry-run.')
}

/** Legacy adoption is a manifest-only transaction and cannot hide other requested mutations. */
export function validateLegacyAdoptionOptions(opts: UpdateCommandOptions): void {
  if (opts.adoptPlan && !opts.adoptLegacy) throw new Error('The --adopt-plan option requires --adopt-legacy.')
  if (!opts.adoptLegacy) return
  const allowed = new Set<keyof UpdateCommandOptions>(['adoptLegacy', 'adoptPlan', 'dryRun', 'json', 'nonInteractive', 'projectName', 'mainBranch'])
  const incompatible = Object.entries(opts)
    .filter(([key, value]) => value !== undefined && !allowed.has(key as keyof UpdateCommandOptions))
    .map(([key]) => `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`)
  if (incompatible.length > 0) throw new Error(`--adopt-legacy cannot be combined with ${incompatible.join(', ')}. Adopt the manifest first, then run sf update again.`)
}

function assertEnumOption(name: string, value: string | undefined, allowed: readonly string[]): void {
  if (value !== undefined && !allowed.includes(value)) throw new Error(`Invalid --${name} "${value}". Expected one of: ${allowed.join(', ')}.`)
}

/** Runtime validation for Commander values before the project is read. */
export function validateTechnicalTransitionOptions(opts: UpdateCommandOptions): void {
  assertEnumOption('structure', opts.structure, ['monorepo', 'multirepo'])
  assertEnumOption('db-setup', opts.dbSetup, ['docker', 'credentials', 'manual'])
  assertEnumOption('db-type', opts.dbType, ['postgresql', 'sql'])
  assertEnumOption('email-service', opts.emailService, ['none', 'mailersend'])
  assertEnumOption('s3-setup', opts.s3Setup, ['docker', 'credentials', 'manual'])
}

/**
 * Parse and validate the --conflict-strategy flag. Defaults to 'save-new' to
 * preserve the pre-#59 behavior (conflicts are written as .saasfoundry.new).
 */
export function parseConflictStrategy(value: string | undefined): ConflictStrategy {
  if (value === undefined) return 'save-new'
  if ((VALID_STRATEGIES as ReadonlyArray<string>).includes(value)) return value as ConflictStrategy
  throw new Error(`Invalid --conflict-strategy "${value}". Expected one of: ${VALID_STRATEGIES.join(', ')}.`)
}

/**
 * Parse the --add-modules CSV. Trims whitespace and drops empty entries.
 */
export function parseAddModules(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Parse the workflow choice shared with `sf new` without provisioning a board. */
export function parseUpdateWorkflow(value: string | boolean | undefined): { preset?: 'solo' | 'saasfoundry'; disabled?: boolean } {
  if (value === undefined) return {}
  if (value === false || value === 'none') return { disabled: true }
  if (value === 'solo' || value === 'saasfoundry') return { preset: value }
  throw new Error(`Invalid --workflow "${String(value)}". Expected one of: solo, saasfoundry, none.`)
}

/**
 * Convert the technical stack flags shared with `sf new` into config-engine
 * prefill. Ports stay flat on UpdateCommandOptions because they are resolved
 * immediately before rendering, after the database/storage choices are known.
 */
export function buildTechnicalTransitionPrefillFromOptions(opts: UpdateCommandOptions): Partial<Answers> {
  const prefill: Partial<Answers> = {}
  const dbPassword = opts.dbPassword ?? process.env.SF_UPDATE_DB_PASSWORD
  const mailersendApiKey = opts.mailersendApiKey ?? process.env.SF_UPDATE_MAILERSEND_API_KEY
  const s3AccessKey = opts.s3AccessKey ?? process.env.SF_UPDATE_S3_ACCESS_KEY
  const s3SecretKey = opts.s3SecretKey ?? process.env.SF_UPDATE_S3_SECRET_KEY

  if (opts.projectDescription !== undefined) prefill.projectDescription = opts.projectDescription
  if (opts.structure !== undefined) prefill.isMonorepo = opts.structure === 'monorepo'
  if (opts.dbSetup !== undefined) prefill.dbSetup = opts.dbSetup

  const dbCredentials: Partial<DbCredentials> = {}
  if (opts.dbType !== undefined) dbCredentials.dbType = opts.dbType
  if (opts.dbHost !== undefined) dbCredentials.host = opts.dbHost
  if (opts.dbPort !== undefined) dbCredentials.port = opts.dbPort
  if (opts.dbUser !== undefined) dbCredentials.user = opts.dbUser
  if (dbPassword !== undefined) dbCredentials.password = dbPassword
  if (opts.dbName !== undefined) dbCredentials.database = opts.dbName
  if (Object.keys(dbCredentials).length > 0) prefill.dbCredentials = dbCredentials as DbCredentials

  if (opts.emailService !== undefined) prefill.emailService = opts.emailService
  if (mailersendApiKey !== undefined) prefill.mailersendApiKey = mailersendApiKey
  if (opts.mailersendSenderEmail !== undefined) prefill.mailersendSenderEmail = opts.mailersendSenderEmail
  if (opts.mailersendSenderName !== undefined) prefill.mailersendSenderName = opts.mailersendSenderName

  if (opts.s3Setup !== undefined) prefill.s3Setup = opts.s3Setup
  const s3Credentials: Partial<S3Credentials> = {}
  if (opts.s3Endpoint !== undefined) s3Credentials.endpoint = opts.s3Endpoint
  if (s3AccessKey !== undefined) s3Credentials.accessKey = s3AccessKey
  if (s3SecretKey !== undefined) s3Credentials.secretKey = s3SecretKey
  if (opts.s3Bucket !== undefined) s3Credentials.bucket = opts.s3Bucket
  if (opts.s3Region !== undefined) s3Credentials.region = opts.s3Region
  if (Object.keys(s3Credentials).length > 0) prefill.s3Credentials = s3Credentials as S3Credentials

  if (opts.analytics !== undefined) prefill.includeAnalytics = opts.analytics
  if (opts.pwa !== undefined) prefill.includePwa = opts.pwa
  else if (opts.nonInteractive === true) prefill.includePwa = true

  return prefill
}

/**
 * Build the prefill structure consumed by the `update` prompts from flat
 * Commander options.
 *
 * In non-interactive mode, auto-sets `email.ready = true` so the "are you ready
 * to configure MailerSend?" confirm prompt never blocks (the signup UX is
 * interactive-only).
 */
export function buildUpdatePrefillFromOptions(opts: UpdateCommandOptions): UpdatePrefill {
  const prefill: UpdatePrefill = { email: {}, storage: {}, skills: {}, srs: {} }
  const secret = (value: string | undefined, envName: string): string | undefined => value ?? process.env[envName]

  const modules = parseAddModules(opts.addModules)
  if (modules !== undefined) prefill.selectedModules = modules
  const workflow = parseUpdateWorkflow(opts.workflow)
  if (workflow.preset) prefill.workflowPreset = workflow.preset
  if (workflow.disabled) prefill.workflowDisabled = true

  const mailersendApiKey = secret(opts.mailersendApiKey, 'SF_UPDATE_MAILERSEND_API_KEY')
  if (mailersendApiKey !== undefined) prefill.email.mailersendApiKey = mailersendApiKey
  if (opts.mailersendSenderEmail !== undefined) prefill.email.mailersendSenderEmail = opts.mailersendSenderEmail
  if (opts.mailersendSenderName !== undefined) prefill.email.mailersendSenderName = opts.mailersendSenderName
  if (opts.nonInteractive === true) prefill.email.ready = true

  // `manual` is a full-stack rendering choice. The legacy storage-module
  // installer only supports Docker or an existing credentialed service.
  if (opts.s3Setup !== undefined && opts.s3Setup !== 'manual') prefill.storage.s3Setup = opts.s3Setup
  if (opts.s3Endpoint !== undefined) prefill.storage.endpoint = opts.s3Endpoint
  const s3AccessKey = secret(opts.s3AccessKey, 'SF_UPDATE_S3_ACCESS_KEY')
  const s3SecretKey = secret(opts.s3SecretKey, 'SF_UPDATE_S3_SECRET_KEY')
  if (s3AccessKey !== undefined) prefill.storage.accessKey = s3AccessKey
  if (s3SecretKey !== undefined) prefill.storage.secretKey = s3SecretKey
  if (opts.s3Bucket !== undefined) prefill.storage.bucket = opts.s3Bucket
  if (opts.s3Region !== undefined) prefill.storage.region = opts.s3Region

  const context7ApiKey = secret(opts.context7ApiKey, 'SF_UPDATE_CONTEXT7_API_KEY')
  if (context7ApiKey !== undefined) prefill.skills.context7ApiKey = context7ApiKey
  if (opts.atlassianEmail !== undefined) prefill.skills.atlassianEmail = opts.atlassianEmail
  const atlassianApiToken = secret(opts.atlassianApiToken, 'SF_UPDATE_ATLASSIAN_API_TOKEN')
  if (atlassianApiToken !== undefined) prefill.skills.atlassianApiToken = atlassianApiToken
  if (opts.atlassianSite !== undefined) prefill.skills.atlassianSite = opts.atlassianSite
  if (opts.atlassianCloudId !== undefined) prefill.skills.atlassianCloudId = opts.atlassianCloudId
  const notionApiToken = secret(opts.notionApiToken, 'SF_UPDATE_NOTION_API_TOKEN')
  if (notionApiToken !== undefined) prefill.skills.notionApiToken = notionApiToken
  if (opts.notionApiVersion !== undefined) prefill.skills.notionApiVersion = opts.notionApiVersion
  const figmaApiToken = secret(opts.figmaApiToken, 'SF_UPDATE_FIGMA_API_TOKEN')
  if (figmaApiToken !== undefined) prefill.skills.figmaApiToken = figmaApiToken

  if (opts.srsBackend !== undefined) prefill.srs.srsBackend = opts.srsBackend
  if (opts.srsParentPageInput !== undefined) prefill.srs.srsParentPageInput = opts.srsParentPageInput
  if (notionApiToken !== undefined) prefill.srs.notionApiToken = notionApiToken
  if (opts.notionApiVersion !== undefined) prefill.srs.notionApiVersion = opts.notionApiVersion

  return prefill
}

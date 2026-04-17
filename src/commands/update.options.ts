import { AdvancedSkillCredentials } from '../prompts/skills.prompts'

export type ConflictStrategy = 'keep' | 'replace' | 'save-new'

export interface UpdateCommandOptions {
  nonInteractive?: boolean
  dryRun?: boolean
  acceptTemplateUpdates?: boolean
  conflictStrategy?: string

  // Module selection
  addModules?: string

  // Email module
  mailersendApiKey?: string
  mailersendSenderEmail?: string
  mailersendSenderName?: string

  // Storage module
  s3Setup?: 'docker' | 'credentials'
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
}

export interface UpdatePrefill {
  selectedModules?: string[]
  email: { ready?: boolean; mailersendApiKey?: string; mailersendSenderEmail?: string; mailersendSenderName?: string }
  storage: { s3Setup?: 'docker' | 'credentials'; endpoint?: string; accessKey?: string; secretKey?: string; bucket?: string; region?: string }
  skills: AdvancedSkillCredentials
}

/**
 * Machine-readable preview emitted on stdout when `sf update --dry-run` runs.
 * Contains no side effects — callers can parse it to verify what the command
 * would do without actually mutating the project.
 */
export interface UpdateDryRunReport {
  cliVersion: string
  projectVersion: string
  conflictStrategy: ConflictStrategy
  templateUpdate:
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
  moduleAddition: {
    available: string[]
    selected: string[]
    email?: { configured: boolean }
    storage?: { s3Setup: 'docker' | 'credentials'; credentialsProvided: boolean }
    skills: string[]
    wouldRunNpmInstall: boolean
  }
}

const VALID_STRATEGIES: ReadonlyArray<ConflictStrategy> = ['keep', 'replace', 'save-new']

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

/**
 * Build the prefill structure consumed by the `update` prompts from flat
 * Commander options.
 *
 * In non-interactive mode, auto-sets `email.ready = true` so the "are you ready
 * to configure MailerSend?" confirm prompt never blocks (the signup UX is
 * interactive-only).
 */
export function buildUpdatePrefillFromOptions(opts: UpdateCommandOptions): UpdatePrefill {
  const prefill: UpdatePrefill = { email: {}, storage: {}, skills: {} }

  const modules = parseAddModules(opts.addModules)
  if (modules !== undefined) prefill.selectedModules = modules

  if (opts.mailersendApiKey !== undefined) prefill.email.mailersendApiKey = opts.mailersendApiKey
  if (opts.mailersendSenderEmail !== undefined) prefill.email.mailersendSenderEmail = opts.mailersendSenderEmail
  if (opts.mailersendSenderName !== undefined) prefill.email.mailersendSenderName = opts.mailersendSenderName
  if (opts.nonInteractive === true) prefill.email.ready = true

  if (opts.s3Setup !== undefined) prefill.storage.s3Setup = opts.s3Setup
  if (opts.s3Endpoint !== undefined) prefill.storage.endpoint = opts.s3Endpoint
  if (opts.s3AccessKey !== undefined) prefill.storage.accessKey = opts.s3AccessKey
  if (opts.s3SecretKey !== undefined) prefill.storage.secretKey = opts.s3SecretKey
  if (opts.s3Bucket !== undefined) prefill.storage.bucket = opts.s3Bucket
  if (opts.s3Region !== undefined) prefill.storage.region = opts.s3Region

  if (opts.context7ApiKey !== undefined) prefill.skills.context7ApiKey = opts.context7ApiKey
  if (opts.atlassianEmail !== undefined) prefill.skills.atlassianEmail = opts.atlassianEmail
  if (opts.atlassianApiToken !== undefined) prefill.skills.atlassianApiToken = opts.atlassianApiToken
  if (opts.atlassianSite !== undefined) prefill.skills.atlassianSite = opts.atlassianSite
  if (opts.atlassianCloudId !== undefined) prefill.skills.atlassianCloudId = opts.atlassianCloudId
  if (opts.notionApiToken !== undefined) prefill.skills.notionApiToken = opts.notionApiToken
  if (opts.notionApiVersion !== undefined) prefill.skills.notionApiVersion = opts.notionApiVersion
  if (opts.figmaApiToken !== undefined) prefill.skills.figmaApiToken = opts.figmaApiToken

  return prefill
}

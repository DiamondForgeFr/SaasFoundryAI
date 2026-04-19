import { Answers, DbCredentials, S3Credentials } from '../types'

export interface NewCommandOptions {
  nonInteractive?: boolean

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

  // Workflow (flag allows skipping; full config still goes through `sf workflow` or interactive)
  workflow?: string | boolean

  // Post-setup behavior
  startServices?: boolean
  startApps?: 'all' | 'backend' | 'frontend' | 'none'
}

/**
 * Convert Commander-parsed options into a `Partial<Answers>` prefill
 * consumable by `getUserStartProjectInputs`.
 *
 * Only fields that were explicitly passed end up in the prefill, so the
 * interactive prompt still asks for anything the user didn't specify.
 */
export function buildPrefillFromOptions(opts: NewCommandOptions): Partial<Answers> {
  const prefill: Partial<Answers> = {}

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
  if (opts.notionApiToken !== undefined) prefill.notionApiToken = opts.notionApiToken
  if (opts.notionApiVersion !== undefined) prefill.notionApiVersion = opts.notionApiVersion
  if (opts.figmaApiToken !== undefined) prefill.figmaApiToken = opts.figmaApiToken

  // SRS bootstrap is opt-in. In --non-interactive mode, default to `false` so the
  // command never blocks on the srsEnable confirm prompt unless the user explicitly
  // passes --srs-enable (matches the email.ready pattern in `sf update`).
  if (opts.srsEnable !== undefined) prefill.srsEnable = opts.srsEnable
  else if (opts.nonInteractive === true) prefill.srsEnable = false
  if (opts.srsBackend !== undefined) prefill.srsBackend = opts.srsBackend
  if (opts.srsParentPageInput !== undefined) prefill.srsParentPageInput = opts.srsParentPageInput

  return prefill
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

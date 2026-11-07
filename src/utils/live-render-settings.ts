import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { SaaSFoundryManifest } from '../types'

/**
 * The answers `sf new` rendered into tracked files that the manifest does not record.
 *
 * `sf update` regenerates the project to diff it against the live one. Any answer the
 * regeneration does not know becomes a difference nobody made: the target of the
 * three-way merge reverts the project's own value, a file the user edited gets a false
 * conflict, an untouched one is overwritten silently, and the reverted render becomes the
 * new baseline (#1151, after #858 for the package identity).
 */
export interface RenderSettings {
  /** Sender lines of the API deployment workflow (MailerSend only). */
  mailersendSenderEmail?: string
  mailersendSenderName?: string
  /** Credentials of the Docker development database, in `docker-compose.dev-services.yml`. */
  dbUser: string
  dbPassword: string
  dbName: string
  /** Bucket the MinIO init container creates, in `docker-compose.dev-services.yml` (Docker S3 only). */
  s3Bucket?: string
}

/** What `sf new` writes when the database prompts are left at their defaults. */
const DEFAULT_DB = { dbUser: 'db_dev_user', dbPassword: 'db_dev_password', dbName: 'db_dev' }

/**
 * The sender the regeneration wrote before #1151, whatever the project had chosen. A
 * workflow carrying exactly this pair was rewritten by an earlier `sf update`, so it says
 * nothing about the project's sender.
 */
export const LEGACY_PLACEHOLDER_SENDER = { email: 'noreply@example.com', name: 'App' }

/**
 * The settings the regeneration used before #1151: placeholders for the sender, the
 * database defaults, and the project-named bucket. Rendering with them reproduces the
 * baseline an earlier `sf update` recorded, which is how `repairPlaceholderBaselines`
 * recognises it.
 */
export function legacyRenderSettings(manifest: SaaSFoundryManifest): RenderSettings {
  const mailersend = manifest.modules?.email?.provider === 'mailersend'
  return {
    mailersendSenderEmail: mailersend ? LEGACY_PLACEHOLDER_SENDER.email : undefined,
    mailersendSenderName: mailersend ? LEGACY_PLACEHOLDER_SENDER.name : undefined,
    ...DEFAULT_DB,
    s3Bucket: undefined
  }
}

/** True when both settings render the same files. */
export function sameRenderSettings(a: RenderSettings, b: RenderSettings): boolean {
  return (
    a.mailersendSenderEmail === b.mailersendSenderEmail &&
    a.mailersendSenderName === b.mailersendSenderName &&
    a.dbUser === b.dbUser &&
    a.dbPassword === b.dbPassword &&
    a.dbName === b.dbName &&
    a.s3Bucket === b.s3Bucket
  )
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

/** Value of `KEY=value` or `KEY="value"` in a dotenv file; a commented line does not count. */
function envValue(content: string, key: string): string | undefined {
  const value = new RegExp(`^${key}="?([^"\\n]*)"?$`, 'm').exec(content)?.[1]
  return value ? value : undefined
}

/**
 * The value of an `env_line KEY '<value>'` line, only in the exact single-quoted form the
 * email installer writes. A line the user rewrote (a secret reference, double quotes) is
 * not something the regeneration can reproduce, so it reads as unknown.
 */
function workflowSenderValue(content: string, key: string): string | undefined {
  const word = new RegExp(`^[ \\t]*env_line ${key} ('(?:[^']|'\\\\'')*')[ \\t]*$`, 'm').exec(content)?.[1]
  if (!word) return undefined
  return word.slice(1, -1).replace(/'\\''/g, "'")
}

/** One value of a `KEY: value` line of the development-services compose file. */
function composeValue(content: string, key: string): string | undefined {
  const value = new RegExp(`^[ \\t]*${key}:[ \\t]*(.+?)[ \\t]*$`, 'm').exec(content)?.[1]
  return value ? value : undefined
}

/**
 * Read back the render settings of the live project at `liveRoot`.
 *
 * Each value comes from the tracked file it was rendered into first: that file is the one
 * being compared, it is committed (so every clone reads the same value), and it holds what
 * the baseline was generated with unless the user changed that line — in which case
 * keeping the user's value is right, since it is not a template change. The API's
 * `.env.test` (committed) and `.env` (local, often absent on a fresh clone) are the
 * fallbacks, then the defaults `sf new` applies.
 *
 * A workflow that carries the pre-#1151 placeholder pair falls through to the dotenv files,
 * so an untouched workflow that an earlier `sf update` overwrote gets its sender back. It
 * keeps the placeholders only when nothing else knows the sender.
 */
export async function readLiveRenderSettings(manifest: SaaSFoundryManifest, liveRoot = '.'): Promise<RenderSettings> {
  const isMonorepo = manifest.structure === 'monorepo'
  const apiDir = join(liveRoot, isMonorepo ? 'apps/api' : `apps/${manifest.projectName}-api`)
  const [workflow, envTest, env, devServices] = await Promise.all([
    readText(isMonorepo ? join(liveRoot, '.github/workflows/deployment-api.yml') : join(apiDir, '.github/workflows/deployment.yml')),
    readText(join(apiDir, '.env.test')),
    readText(join(apiDir, '.env')),
    readText(join(apiDir, 'docker-compose.dev-services.yml'))
  ])

  const settings: RenderSettings = { ...DEFAULT_DB }

  if (manifest.modules?.email?.provider === 'mailersend') {
    const fromWorkflow = { email: workflowSenderValue(workflow, 'MAILERSEND_SENDER_EMAIL'), name: workflowSenderValue(workflow, 'MAILERSEND_SENDER_NAME') }
    const placeholder = fromWorkflow.email === LEGACY_PLACEHOLDER_SENDER.email && fromWorkflow.name === LEGACY_PLACEHOLDER_SENDER.name
    const sender = (key: 'email' | 'name', envKey: string): string => (placeholder ? undefined : fromWorkflow[key]) ?? envValue(envTest, envKey) ?? envValue(env, envKey) ?? fromWorkflow[key] ?? ''
    settings.mailersendSenderEmail = sender('email', 'MAILERSEND_SENDER_EMAIL')
    settings.mailersendSenderName = sender('name', 'MAILERSEND_SENDER_NAME')
  }

  if (manifest.modules?.dbSetup === 'docker') {
    const url = /^DATABASE_URL="?[a-z]+:\/\/([^:@/]+):([^@]*)@[^/]+\/([^"?\s]+)/m.exec(env)
    settings.dbUser = composeValue(devServices, 'POSTGRES_USER') ?? url?.[1] ?? DEFAULT_DB.dbUser
    settings.dbPassword = composeValue(devServices, 'POSTGRES_PASSWORD') ?? url?.[2] ?? DEFAULT_DB.dbPassword
    settings.dbName = composeValue(devServices, 'POSTGRES_DB') ?? url?.[3] ?? DEFAULT_DB.dbName
  }

  if (manifest.modules?.s3Setup === 'docker') {
    const bucket = /mc mb --ignore-existing myminio\/([^\s;]+)/.exec(devServices)?.[1] ?? envValue(env, 'S3_BUCKET')
    // The project-named bucket is what the regeneration renders without an answer.
    settings.s3Bucket = bucket && bucket !== `${manifest.projectName}-uploads` ? bucket : undefined
  }

  return settings
}

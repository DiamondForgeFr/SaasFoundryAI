import { execSync } from 'child_process'
import { readFile, readdir } from 'fs/promises'
import { homedir } from 'os'
import { resolve } from 'path'

import { ToolDescriptor } from './catalogue'

/**
 * Live connection checks for the tools-first step (FR-CONFIG-ENGINE-04).
 *
 * Contract: a check NEVER throws and NEVER blocks the stepper. It returns
 * `ok` or `warn` — a `warn` means "selection kept, credential entry deferred".
 * Two depths:
 *  - live  — a real, bounded API ping where a credential is present
 *  - presence — local-only (credential file / `gh` token exists); used in
 *    `--no-network` and non-interactive runs, mirroring `sf status --no-network`
 */

export type ConnectionStatus = 'ok' | 'warn'

export interface ConnectionResult {
  status: ConnectionStatus
  detail: string
}

export interface ConnectionCheckOptions {
  /** Skip every network call — degrade to local presence checks only. */
  noNetwork?: boolean
  /** Account whose credentials to use (defaults to the first `.env` found). */
  account?: string
}

const PING_TIMEOUT_MS = 6000

/**
 * Root of the per-tool credential buckets. Overridable via `SF_CREDENTIALS_DIR`
 * (used by tests and advanced setups); defaults to the standard skill location.
 */
function credentialsBaseDir(): string {
  return process.env.SF_CREDENTIALS_DIR || resolve(homedir(), '.claude/credentials')
}

const ok = (detail: string): ConnectionResult => ({ status: 'ok', detail })
const warn = (detail: string): ConnectionResult => ({ status: 'warn', detail })

/**
 * Read the resolved credentials for a tool bucket. Returns `null` when no
 * account `.env` exists. Parses simple `KEY=VALUE` lines (no quoting/escaping —
 * matches what `sf tools add` writes).
 */
export async function readToolCredentials(credentialTool: string, account?: string): Promise<Record<string, string> | null> {
  const bucket = resolve(credentialsBaseDir(), credentialTool)
  let files: string[]
  try {
    files = (await readdir(bucket)).filter((f) => f.endsWith('.env'))
  } catch {
    return null
  }
  if (files.length === 0) return null

  const chosen = account ? `${account}.env` : files[0]
  if (!files.includes(chosen)) return null

  let raw: string
  try {
    raw = await readFile(resolve(bucket, chosen), 'utf8')
  } catch {
    return null
  }

  const creds: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    creds[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return Object.keys(creds).length > 0 ? creds : null
}

/** Bounded JSON-ish fetch — resolves the Response or throws on timeout/network. */
async function ping(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** `gh auth token` reads the local store without a network round-trip. */
function hasGhToken(): boolean {
  try {
    return execSync('gh auth token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0
  } catch {
    return false
  }
}

/** `gh auth status` performs a live API round-trip against GitHub. */
function ghAuthStatus(): boolean {
  try {
    execSync('gh auth status', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

async function checkGithubProjects(opts: ConnectionCheckOptions): Promise<ConnectionResult> {
  if (opts.noNetwork) {
    return hasGhToken() ? ok('gh token present (offline)') : warn('no gh token — run `gh auth login`')
  }
  return ghAuthStatus() ? ok('gh authenticated') : warn('gh not authenticated — run `gh auth login`')
}

async function liveNotion(creds: Record<string, string>): Promise<ConnectionResult> {
  const token = creds.NOTION_API_TOKEN
  if (!token) return warn('credential incomplete (NOTION_API_TOKEN)')
  const res = await ping('https://api.notion.com/v1/users/me', {
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': creds.NOTION_API_VERSION || '2022-06-28' }
  })
  return res.ok ? ok('Notion API reachable') : warn(`Notion API returned ${res.status}`)
}

async function liveAtlassian(creds: Record<string, string>): Promise<ConnectionResult> {
  const { ATLASSIAN_EMAIL: email, ATLASSIAN_API_TOKEN: token, ATLASSIAN_SITE: site } = creds
  if (!email || !token || !site) return warn('credential incomplete (email/token/site)')
  const base = site.startsWith('http') ? site.replace(/\/+$/, '') : `https://${site}`
  const auth = Buffer.from(`${email}:${token}`).toString('base64')
  const res = await ping(`${base}/rest/api/3/myself`, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } })
  return res.ok ? ok('Atlassian API reachable') : warn(`Atlassian API returned ${res.status}`)
}

async function liveLinear(creds: Record<string, string>): Promise<ConnectionResult> {
  const key = creds.LINEAR_API_KEY || creds.LINEAR_API_TOKEN
  if (!key) return warn('credential incomplete (LINEAR_API_KEY)')
  const res = await ping('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { Authorization: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ viewer { id } }' })
  })
  return res.ok ? ok('Linear API reachable') : warn(`Linear API returned ${res.status}`)
}

async function liveFigma(creds: Record<string, string>): Promise<ConnectionResult> {
  const token = creds.FIGMA_API_TOKEN
  if (!token) return warn('credential incomplete (FIGMA_API_TOKEN)')
  const res = await ping('https://api.figma.com/v1/me', { headers: { 'X-Figma-Token': token } })
  return res.ok ? ok('Figma API reachable') : warn(`Figma API returned ${res.status}`)
}

async function liveMiro(creds: Record<string, string>): Promise<ConnectionResult> {
  const token = creds.MIRO_API_TOKEN || creds.MIRO_TOKEN || creds.MIRO_ACCESS_TOKEN
  if (!token) return warn('credential incomplete (MIRO_API_TOKEN)')
  const res = await ping('https://api.miro.com/v1/oauth-token', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
  return res.ok ? ok('Miro API reachable') : warn(`Miro API returned ${res.status}`)
}

const LIVE_CHECKS: Record<string, (creds: Record<string, string>) => Promise<ConnectionResult>> = {
  notion: liveNotion,
  atlassian: liveAtlassian,
  linear: liveLinear,
  figma: liveFigma,
  miro: liveMiro
}

/**
 * Run the connection check for one selected tool. Resolves to `ok`/`warn`,
 * never rejects — any unexpected error degrades to `warn` so the stepper flows.
 */
export async function checkConnection(descriptor: ToolDescriptor, opts: ConnectionCheckOptions = {}): Promise<ConnectionResult> {
  try {
    // gh-backed tracker
    if (descriptor.name === 'github-projects') return await checkGithubProjects(opts)
    // on-disk backend — nothing to reach
    if (!descriptor.credentialTool) return ok('no remote (local backend)')

    const creds = await readToolCredentials(descriptor.credentialTool, opts.account)
    if (!creds) return warn('no credential found — entry deferred')
    if (opts.noNetwork) return ok('credential present (offline)')

    const live = LIVE_CHECKS[descriptor.credentialTool]
    if (!live) return ok('credential present')
    return await live(creds)
  } catch (err) {
    return warn(`check failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

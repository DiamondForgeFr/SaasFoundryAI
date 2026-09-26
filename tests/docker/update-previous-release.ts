import { spawn } from 'node:child_process'
import { readFile, mkdir, lstat, open, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { canonicalTreeDigest, materializeLegacyReleaseFixture } from './legacy-release-fixture'

const PROJECT_NAME = 'previous-release'
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024
const HOOK_TEARDOWN_GRACE_MS = 10_000
const RUNTIME_EXCLUSIONS = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'logs',
  '.turbo',
  `apps/${PROJECT_NAME}-api/.git`,
  `apps/${PROJECT_NAME}-api/node_modules`,
  `apps/${PROJECT_NAME}-api/dist`,
  `apps/${PROJECT_NAME}-api/build`,
  `apps/${PROJECT_NAME}-api/coverage`,
  `apps/${PROJECT_NAME}-api/logs`,
  `apps/${PROJECT_NAME}-web/.git`,
  `apps/${PROJECT_NAME}-web/node_modules`,
  `apps/${PROJECT_NAME}-web/dist`,
  `apps/${PROJECT_NAME}-web/build`,
  `apps/${PROJECT_NAME}-web/coverage`,
  `apps/${PROJECT_NAME}-web/logs`
] as const
const HISTORICAL_SOURCE_CANARIES = [`apps/${PROJECT_NAME}-web/test-results/.last-run.json`, `apps/${PROJECT_NAME}-web/playwright-report/index.html`] as const
const INHERITED_ENVIRONMENT = ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'COMSPEC', 'PATHEXT', 'SHELL'] as const

export interface PreviousReleaseLifecyclePhaseContext {
  projectRoot: string
  manifest: Record<string, unknown> | undefined
  deadline: number
  signal: AbortSignal
}

export interface PreviousReleaseUpdateLifecycleOptions {
  fixture: Buffer
  workspace: string
  cliEntry: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  signal?: AbortSignal
  /** Runtime hooks are supplied by #788; each hook must tear down its processes in a finally block and honor signal aborts. */
  beforeUpdate?: (context: PreviousReleaseLifecyclePhaseContext) => Promise<void>
  afterUpdate?: (context: PreviousReleaseLifecyclePhaseContext) => Promise<void>
  /** #788 supplies a process-group supervisor here; focused #787 tests use the bounded default. */
  executeUpdate?: (request: PreviousReleaseCliRequest) => Promise<CliResult>
}

export interface PreviousReleaseUpdateLifecycleResult {
  projectRoot: string
  adoptionFingerprint: string
  manifest: Record<string, unknown>
  stableDigest: string
}

export interface PreviousReleaseCliRequest {
  cliEntry: string
  cwd: string
  args: readonly string[]
  env: NodeJS.ProcessEnv
  timeoutMs: number
  maxOutputBytes?: number
  signal?: AbortSignal
}

export interface CliResult {
  stdout: string
  stderr: string
}

function redactDiagnostics(value: string, env: NodeJS.ProcessEnv): string {
  let redacted = value.slice(-16 * 1024)
  for (const [name, secret] of Object.entries(env)) {
    if (secret && /(?:TOKEN|KEY|SECRET|PASSWORD|AUTH|COOKIE)/i.test(name)) redacted = redacted.replaceAll(secret, '<redacted>')
  }
  return redacted.replace(/((?:authorization|cookie|token|api[_-]?key|secret|password)\s*[:=]\s*)[^\s,;]+/gi, '$1<redacted>').replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, '$1<redacted>@')
}

function describeFailure(args: readonly string[], status: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string, env: NodeJS.ProcessEnv): string {
  return [
    `sf update ${args.join(' ')} failed (status=${String(status)}, signal=${String(signal)})`,
    stdout.trim() ? `stdout:\n${redactDiagnostics(stdout, env).trim()}` : '',
    stderr.trim() ? `stderr:\n${redactDiagnostics(stderr, env).trim()}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

async function terminateProcessTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' })
      killer.once('close', () => resolve())
      killer.once('error', () => resolve())
    })
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    return
  }
  await new Promise((resolve) => setTimeout(resolve, 500))
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // The process group exited during the grace period.
  }
}

export function executePreviousReleaseUpdateProcess(request: PreviousReleaseCliRequest): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [request.cliEntry, 'update', ...request.args], {
      cwd: request.cwd,
      env: request.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let outputBytes = 0
    let settled = false
    let timedOut = false
    let aborted = false
    const onAbort = () => {
      if (settled) return
      aborted = true
      void terminateProcessTree(child.pid!)
    }
    request.signal?.addEventListener('abort', onAbort, { once: true })
    if (request.signal?.aborted) onAbort()

    const collect = (target: Buffer[], chunk: Buffer): void => {
      if (settled) return
      outputBytes += chunk.length
      if (outputBytes > (request.maxOutputBytes ?? DEFAULT_MAX_BUFFER)) {
        settled = true
        child.stdout.destroy()
        child.stderr.destroy()
        void terminateProcessTree(child.pid!).finally(() => reject(new Error('sf update exceeded the bounded diagnostic output limit.')))
        return
      }
      target.push(chunk)
    }
    child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk))
    child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk))
    child.once('error', (error) => {
      request.signal?.removeEventListener('abort', onAbort)
      if (!settled) {
        settled = true
        reject(error)
      }
    })
    const timer = setTimeout(() => {
      if (settled) return
      timedOut = true
      void terminateProcessTree(child.pid!)
    }, request.timeoutMs)
    child.once('close', (status, signal) => {
      clearTimeout(timer)
      request.signal?.removeEventListener('abort', onAbort)
      if (settled) return
      settled = true
      const result = { stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }
      if (aborted) {
        reject(request.signal?.reason instanceof Error ? request.signal.reason : new Error('Previous-release update aborted.'))
      } else if (timedOut) {
        reject(new Error(`${describeFailure(request.args, status, signal, result.stdout, result.stderr, request.env)}\nLifecycle deadline exceeded.`))
      } else if (status !== 0) {
        reject(new Error(describeFailure(request.args, status, signal, result.stdout, result.stderr, request.env)))
      } else {
        resolve(result)
      }
    })
  })
}

interface CliExecution extends CliResult {
  env: NodeJS.ProcessEnv
}

async function runUpdate(options: PreviousReleaseUpdateLifecycleOptions, projectRoot: string, args: readonly string[], deadline: number, sterileHome: string): Promise<CliExecution> {
  const inherited = Object.fromEntries(INHERITED_ENVIRONMENT.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]]])))
  const env: NodeJS.ProcessEnv = {
    ...inherited,
    ...options.env,
    HOME: options.env?.HOME ?? sterileHome,
    USERPROFILE: options.env?.USERPROFILE ?? sterileHome,
    npm_config_userconfig: join(sterileHome, '.npmrc'),
    NPM_CONFIG_USERCONFIG: join(sterileHome, '.npmrc'),
    npm_config_ignore_scripts: options.env?.npm_config_ignore_scripts ?? 'true',
    NPM_CONFIG_IGNORE_SCRIPTS: options.env?.NPM_CONFIG_IGNORE_SCRIPTS ?? options.env?.npm_config_ignore_scripts ?? 'true',
    CI: 'true',
    HUSKY: '0',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    // The values are fixture-only sentinels. Secrets stay out of argv and diagnostics.
    SF_UPDATE_MAILERSEND_API_KEY: 'ms_fixture_fake_key_1234567890abcdef'
  }
  const request: PreviousReleaseCliRequest = {
    cliEntry: options.cliEntry,
    cwd: projectRoot,
    args,
    env,
    timeoutMs: Math.max(1, deadline - Date.now()),
    signal: options.signal
  }
  const result = await (options.executeUpdate ?? executePreviousReleaseUpdateProcess)(request)
  return { ...result, env }
}

export function parsePreviousReleaseJsonOutput<T>(result: CliResult, label: string, env: NodeJS.ProcessEnv): T {
  try {
    return JSON.parse(result.stdout) as T
  } catch {
    throw new Error(`${label} did not emit one JSON document.\nstdout:\n${redactDiagnostics(result.stdout, env)}\nstderr:\n${redactDiagnostics(result.stderr, env)}`)
  }
}

async function readManifest(projectRoot: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(projectRoot, '.saasfoundry.json'), 'utf8')) as Record<string, unknown>
}

async function requireRegularFile(path: string): Promise<void> {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected one regular lifecycle deposit: ${path}`)
}

function assertUpdatedManifest(manifest: Record<string, unknown>): void {
  const modules = manifest.modules as
    | {
        harness?: { managed?: boolean }
        email?: { provider?: string }
        s3Setup?: string
        includeAnalytics?: boolean
        pwa?: { version?: number }
        advancedSkills?: string[]
      }
    | undefined
  if (manifest.structure !== 'multirepo') throw new Error('The historical lifecycle changed topology unexpectedly.')
  if (modules?.harness?.managed !== true) throw new Error('The late harness transition was not recorded.')
  if (modules.email?.provider !== 'mailersend') throw new Error('The late email module was not recorded.')
  if (modules.s3Setup !== 'docker') throw new Error('The late storage module was not recorded.')
  if (modules.includeAnalytics !== true) throw new Error('The late analytics module was not recorded.')
  if (modules.pwa?.version !== 1) throw new Error('The late PWA module was not recorded.')
  if (!modules.advancedSkills?.includes('context7')) throw new Error('The late Context7 skill was not recorded.')
  const adoption = manifest.adoption as { refreshPending?: boolean } | undefined
  if (adoption?.refreshPending !== false) throw new Error('The initial historical template refresh is still pending.')
}

async function assertDeposits(projectRoot: string): Promise<void> {
  const api = join(projectRoot, 'apps', `${PROJECT_NAME}-api`)
  const web = join(projectRoot, 'apps', `${PROJECT_NAME}-web`)
  await Promise.all([
    requireRegularFile(join(projectRoot, 'CLAUDE.md')),
    requireRegularFile(join(projectRoot, '.claude', 'skills', 'sf-workflow', 'SKILL.md')),
    requireRegularFile(join(api, '.claude', 'skills', 'sf-tool-context7', 'SKILL.md')),
    requireRegularFile(join(web, '.claude', 'skills', 'sf-tool-context7', 'SKILL.md')),
    requireRegularFile(join(api, 'src', 'modules', 'email', 'services', 'mailersend.service.ts')),
    requireRegularFile(join(api, 'src', 'modules', 'storage', 'storage.module.ts')),
    requireRegularFile(join(web, 'src', 'lib', 'analytics', 'analytics.ts')),
    requireRegularFile(join(web, 'pwa.config.ts')),
    requireRegularFile(join(web, 'public', 'pwa-192x192.png')),
    requireRegularFile(join(api, 'scripts', 'saasfoundry', 'impact-classifier.mjs')),
    requireRegularFile(join(api, 'scripts', 'saasfoundry', 'run-impact-validation.mjs')),
    requireRegularFile(join(api, '.saasfoundry', 'validation.json')),
    requireRegularFile(join(api, '.github', 'workflows', 'test.yml')),
    requireRegularFile(join(web, 'scripts', 'saasfoundry', 'impact-classifier.mjs')),
    requireRegularFile(join(web, 'scripts', 'saasfoundry', 'run-impact-validation.mjs')),
    requireRegularFile(join(web, '.saasfoundry', 'validation.json')),
    requireRegularFile(join(web, '.github', 'workflows', 'test.yml'))
  ])

  const apiClassifier = await readFile(join(api, 'scripts', 'saasfoundry', 'impact-classifier.mjs'))
  const webClassifier = await readFile(join(web, 'scripts', 'saasfoundry', 'impact-classifier.mjs'))
  if (!apiClassifier.equals(webClassifier)) throw new Error('The updated multirepo apps received different impact-classifier contracts.')

  const apiValidation = JSON.parse(await readFile(join(api, '.saasfoundry', 'validation.json'), 'utf8')) as { profile?: string }
  const webValidation = JSON.parse(await readFile(join(web, '.saasfoundry', 'validation.json'), 'utf8')) as { profile?: string }
  if (apiValidation.profile !== 'api' || webValidation.profile !== 'web') throw new Error('The updated multirepo apps received incorrect validation profiles.')

  for (const [path, profile] of [
    [api, 'api'],
    [web, 'web']
  ] as const) {
    const workflow = await readFile(join(path, '.github', 'workflows', 'test.yml'), 'utf8')
    if (!workflow.includes(`--profile ${profile}`) || workflow.includes('{{')) throw new Error(`The updated ${profile} workflow is incomplete or still contains placeholders.`)
    const packageJson = JSON.parse(await readFile(join(path, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
    if (packageJson.scripts?.['test:staged'] !== 'npm run test:impact -- --staged') throw new Error(`The updated ${profile} package is missing staged impact validation.`)
  }
}

async function assertHistoricalSourceCanaries(projectRoot: string, expected: ReadonlyMap<string, Buffer>): Promise<void> {
  for (const path of HISTORICAL_SOURCE_CANARIES) {
    const bytes = expected.get(path)
    if (!bytes) throw new Error(`The authoritative fixture omitted its historical source canary: ${path}`)
    if (!(await readFile(join(projectRoot, ...path.split('/')))).equals(bytes)) throw new Error(`The historical source canary changed during update: ${path}`)
  }
}

async function assertNoTransitionArtifacts(projectRoot: string): Promise<void> {
  const leftovers: string[] = []
  const walk = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.name.endsWith('.saasfoundry.new') || entry.name.startsWith('.saasfoundry-transition')) leftovers.push(relative)
      if (entry.isDirectory()) await walk(join(directory, entry.name), relative)
    }
  }
  await walk(projectRoot, '')
  if (leftovers.length > 0) throw new Error(`The update lifecycle left conflict or transaction artifacts: ${leftovers.sort().join(', ')}`)
}

export async function runPreviousReleaseLifecycleHook(
  label: string,
  hook: ((context: PreviousReleaseLifecyclePhaseContext) => Promise<void>) | undefined,
  context: Omit<PreviousReleaseLifecyclePhaseContext, 'deadline' | 'signal'>,
  deadline: number,
  parentSignal?: AbortSignal
): Promise<void> {
  if (!hook) return
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new Error(`${label} could not start because the lifecycle deadline was exhausted.`)
  const controller = new AbortController()
  const abortFromParent = () => controller.abort(parentSignal?.reason)
  parentSignal?.addEventListener('abort', abortFromParent, { once: true })
  if (parentSignal?.aborted) abortFromParent()
  const hookPromise = Promise.resolve().then(() => hook({ ...context, deadline, signal: controller.signal }))
  let deadlineTimer: NodeJS.Timeout | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    deadlineTimer = setTimeout(() => resolve('timeout'), remaining)
  })
  let outcome: 'complete' | 'timeout'
  try {
    outcome = await Promise.race([hookPromise.then(() => 'complete' as const), timeout])
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer)
    parentSignal?.removeEventListener('abort', abortFromParent)
  }
  if (outcome === 'complete') return

  const deadlineError = new Error(`${label} exceeded the lifecycle deadline.`)
  controller.abort(deadlineError)
  let graceTimer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      hookPromise.catch(() => undefined),
      new Promise<void>((resolve) => {
        graceTimer = setTimeout(resolve, HOOK_TEARDOWN_GRACE_MS)
      })
    ])
  } finally {
    if (graceTimer) clearTimeout(graceTimer)
  }
  // A hook that ignores the abort is detached only after the dedicated cleanup
  // grace period. Suppress a later rejection so it cannot become unhandled.
  void hookPromise.catch(() => undefined)
  throw deadlineError
}

/**
 * Deterministic previous-release transition owned by #787.
 *
 * #788 wraps the two hooks with real PostgreSQL/API/web boot and teardown;
 * #789 runs browser journeys after the second hook; #790 decides CI placement.
 */
export async function runPreviousReleaseUpdateLifecycle(options: PreviousReleaseUpdateLifecycleOptions): Promise<PreviousReleaseUpdateLifecycleResult> {
  await mkdir(options.workspace, { recursive: true })
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const sterileHome = join(options.workspace, '.sf-test-home')
  await mkdir(sterileHome, { mode: 0o700 })
  await writeFile(join(sterileHome, '.npmrc'), '', { flag: 'wx', mode: 0o600 })
  const projectRoot = join(options.workspace, PROJECT_NAME)
  const materialized = await materializeLegacyReleaseFixture(options.fixture, projectRoot)
  const historicalCanaries = new Map(
    materialized.entries.filter((entry) => HISTORICAL_SOURCE_CANARIES.includes(entry.path as (typeof HISTORICAL_SOURCE_CANARIES)[number])).map((entry) => [entry.path, entry.bytes])
  )
  const canary = await open(join(projectRoot, 'USER-CANARY.md'), 'wx', 0o644)
  try {
    await canary.writeFile('SaaSFoundry fixture user canary — preserve byte-for-byte.\n')
  } finally {
    await canary.close()
  }
  await assertHistoricalSourceCanaries(projectRoot, historicalCanaries)

  await runPreviousReleaseLifecycleHook('Previous-release pre-update runtime hook', options.beforeUpdate, { projectRoot, manifest: undefined }, deadline, options.signal)

  const previewExecution = await runUpdate(
    options,
    projectRoot,
    ['--adopt-legacy', '--dry-run', '--json', '--non-interactive', '--project-name', PROJECT_NAME, '--main-branch', 'main'],
    deadline,
    sterileHome
  )
  const preview = parsePreviousReleaseJsonOutput<{
    legacyAdoption?: { status?: string; fingerprint?: string }
  }>(previewExecution, 'Legacy adoption preview', previewExecution.env)
  if (preview.legacyAdoption?.status !== 'would-adopt' || !/^[0-9a-f]{64}$/.test(preview.legacyAdoption.fingerprint ?? '')) {
    throw new Error('The committed fixture did not produce a reviewable legacy-adoption fingerprint.')
  }
  const adoptionFingerprint = preview.legacyAdoption.fingerprint!

  await runUpdate(options, projectRoot, ['--adopt-legacy', '--non-interactive', '--project-name', PROJECT_NAME, '--main-branch', 'main', '--adopt-plan', adoptionFingerprint], deadline, sterileHome)
  await runUpdate(options, projectRoot, ['--non-interactive', '--accept-template-updates', '--conflict-strategy', 'save-new'], deadline, sterileHome)
  await runUpdate(options, projectRoot, ['--non-interactive', '--accept-template-updates', '--target-profile', 'full', '--workflow', 'solo'], deadline, sterileHome)

  const moduleArgs = [
    '--non-interactive',
    '--accept-template-updates',
    '--conflict-strategy',
    'save-new',
    '--add-modules',
    'email,storage,analytics,pwa,sf-skill-context7',
    '--mailersend-sender-email',
    'noreply@example.test',
    '--mailersend-sender-name',
    'Fixture',
    '--s3-setup',
    'docker'
  ] as const
  await runUpdate(options, projectRoot, moduleArgs, deadline, sterileHome)

  const manifest = await readManifest(projectRoot)
  assertUpdatedManifest(manifest)
  await assertDeposits(projectRoot)
  await assertNoTransitionArtifacts(projectRoot)
  await assertHistoricalSourceCanaries(projectRoot, historicalCanaries)
  if ((await readFile(join(projectRoot, 'USER-CANARY.md'), 'utf8')) !== 'SaaSFoundry fixture user canary — preserve byte-for-byte.\n') {
    throw new Error('The unmanaged user canary changed during the update lifecycle.')
  }

  await runPreviousReleaseLifecycleHook('Previous-release post-update runtime hook', options.afterUpdate, { projectRoot, manifest }, deadline, options.signal)

  const stableDigest = await canonicalTreeDigest(projectRoot, { exclude: RUNTIME_EXCLUSIONS })
  await runUpdate(options, projectRoot, ['--non-interactive', '--accept-template-updates', '--target-profile', 'full', '--workflow', 'solo'], deadline, sterileHome)
  await runUpdate(options, projectRoot, moduleArgs, deadline, sterileHome)
  await assertNoTransitionArtifacts(projectRoot)
  const repeatedDigest = await canonicalTreeDigest(projectRoot, { exclude: RUNTIME_EXCLUSIONS })
  if (repeatedDigest !== stableDigest) throw new Error(`The second identical update was not idempotent (${stableDigest} != ${repeatedDigest}).`)
  await assertHistoricalSourceCanaries(projectRoot, historicalCanaries)

  return { projectRoot, adoptionFingerprint, manifest, stableDigest }
}

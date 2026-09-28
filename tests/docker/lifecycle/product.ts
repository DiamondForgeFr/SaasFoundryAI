import { access, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { BrowserFailureBridge, type BrowserCapability } from './browser'
import { lifecycleProcessApi, type LifecycleProcessApi, type PrivatePostgres } from './postgres'
import { validateApiHealth, validateWebDocument, waitForHttpProbe, type HttpProbeResult } from './probes'
import { startProviderFixture, type ProviderFixture } from './provider-fixture'
import type { LifecyclePhase, SupervisedProcessHandle, SupervisedProcessResult } from './types'

export interface ProductLayout {
  topology: 'monorepo' | 'multirepo'
  apiRoot: string
  webRoot: string
}

export interface ProductReadyContext {
  phase: LifecyclePhase
  topology: ProductLayout['topology']
  projectRoot: string
  apiUrl: string
  webUrl: string
  databaseUrl: string
  deadline: number
  processApi: LifecycleProcessApi
  mailbox: Pick<ProviderFixture, 'url' | 'capability'>
  browserCapabilities: readonly BrowserCapability[]
  browserFailures: BrowserFailureBridge
  signal?: AbortSignal
}

export interface ProductPhaseOptions {
  phase: LifecyclePhase
  projectRoot: string
  manifest?: Record<string, unknown>
  postgres: PrivatePostgres
  deadline: number
  /** Per-service readiness budget, applied only after install/build and process launch. */
  readinessTimeoutMs?: number
  /** Short stability window after readiness, before browser/business checks start. */
  settleWindowMs?: number
  signal?: AbortSignal
  apiPort?: number
  webPort?: number
  processApi?: LifecycleProcessApi
  browserCapabilities?: readonly BrowserCapability[]
  egressGuardPath?: string
  startProviderFixture?: typeof startProviderFixture
  onReady?: (context: ProductReadyContext) => Promise<void>
}

export interface ProductPhaseResult {
  phase: LifecyclePhase
  layout: ProductLayout
  apiUrl: string
  webUrl: string
  apiProbe: HttpProbeResult
  webProbe: HttpProbeResult
  apiProcess: SupervisedProcessResult
  webProcess: SupervisedProcessResult
  browserFailureCount: number
}

export async function resolveProductLayout(projectRoot: string, manifest?: Record<string, unknown>): Promise<ProductLayout> {
  const declared = manifest?.structure
  const candidates: ProductLayout[] = []
  if (declared === 'monorepo' || declared === undefined) candidates.push({ topology: 'monorepo', apiRoot: join(projectRoot, 'apps', 'api'), webRoot: join(projectRoot, 'apps', 'web') })
  if (declared === 'multirepo' || declared === undefined) {
    const name = projectName(manifest) ?? basename(projectRoot)
    candidates.push({ topology: 'multirepo', apiRoot: join(projectRoot, 'apps', `${name}-api`), webRoot: join(projectRoot, 'apps', `${name}-web`) })
    try {
      const appNames = await readdir(join(projectRoot, 'apps'))
      for (const apiName of appNames.filter((entry) => entry.endsWith('-api')).sort()) {
        const base = apiName.slice(0, -'-api'.length)
        if (appNames.includes(`${base}-web`)) candidates.push({ topology: 'multirepo', apiRoot: join(projectRoot, 'apps', apiName), webRoot: join(projectRoot, 'apps', `${base}-web`) })
      }
    } catch {
      // The fixed candidates below produce the actionable topology error.
    }
  }
  for (const candidate of candidates) {
    if ((await isFile(join(candidate.apiRoot, 'package.json'))) && (await isFile(join(candidate.webRoot, 'package.json')))) return candidate
  }
  throw new Error(`Could not resolve generated product topology under ${projectRoot}.`)
}

/** Boot one product phase and always tear it down before returning to the updater. */
export async function runProductPhase(options: ProductPhaseOptions): Promise<ProductPhaseResult> {
  const processApi = options.processApi ?? lifecycleProcessApi
  const layout = await resolveProductLayout(options.projectRoot, options.manifest)
  const apiPort = options.apiPort ?? 3500
  const webPort = options.webPort ?? 5173
  validateDistinctPorts([options.postgres.port, apiPort, webPort])
  const apiUrl = `http://127.0.0.1:${apiPort}`
  const webUrl = `http://127.0.0.1:${webPort}`
  const common = {
    CI: 'true',
    HUSKY: '0',
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1'
  }
  const apiEnv: NodeJS.ProcessEnv = {
    ...common,
    DATABASE_URL: options.postgres.databaseUrl,
    DIRECT_URL: options.postgres.directUrl,
    PORT: String(apiPort),
    FRONTEND_URL: webUrl,
    NODE_ENV: 'production',
    LOG_LEVEL: 'error',
    JWT_SECRET_AUTH: 'lifecycle_fixture_auth_secret_000000000000000000',
    JWT_SECRET_REFRESH: 'lifecycle_fixture_refresh_secret_0000000000000000',
    JWT_SECRET_INVITATION: 'lifecycle_fixture_invitation_secret_000000000000',
    JWT_SECRET_CONFIRM_ACCOUNT: 'lifecycle_fixture_confirm_secret_000000000000000',
    JWT_SECRET_RESET_PASSWORD: 'lifecycle_fixture_reset_secret_00000000000000000',
    MAILERSEND_API_KEY: 'ms_fixture_runtime_key_00000000000000000000',
    MAILERSEND_SENDER_EMAIL: 'noreply@example.test',
    MAILERSEND_SENDER_NAME: 'Fixture',
    S3_ENDPOINT: 'http://127.0.0.1:59000',
    S3_ACCESS_KEY: 'fixture_access_key',
    S3_SECRET_KEY: 'fixture_secret_key',
    S3_BUCKET: 'fixture-uploads',
    S3_REGION: 'us-east-1'
  }
  const apiBuildEnv: NodeJS.ProcessEnv = { ...apiEnv }
  delete apiBuildEnv.NODE_ENV
  const webEnv: NodeJS.ProcessEnv = { ...common, VITE_BASE_API_URL: apiUrl }
  const run = (label: string, executable: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = common) =>
    processApi.run({ label, executable, args, cwd, env, deadline: options.deadline, signal: options.signal })

  const packageRoot = layout.topology === 'monorepo' ? options.projectRoot : layout.apiRoot
  if (layout.topology === 'monorepo') {
    await run(`${options.phase} monorepo npm ci`, 'npm', ['ci'], packageRoot, apiBuildEnv)
  } else {
    await run(`${options.phase} api npm ci`, 'npm', ['ci'], layout.apiRoot, apiBuildEnv)
    await run(`${options.phase} web npm ci`, 'npm', ['ci', '--ignore-scripts'], layout.webRoot, webEnv)
  }
  const prisma = join(packageRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma')
  await applySqlDirectory(options.postgres, join(layout.apiRoot, 'prisma', 'sql', 'migrations', 'pre-schema'), 'pre-schema migration')
  const dbPushArgs = options.phase === 'before-update' ? ['db', 'push', '--force-reset', '--accept-data-loss'] : ['db', 'push']
  await run(`${options.phase} prisma db push`, prisma, dbPushArgs, layout.apiRoot, {
    ...apiBuildEnv,
    PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: 'yes'
  })
  await run(`${options.phase} prisma generate`, prisma, ['generate'], layout.apiRoot, apiBuildEnv)
  await applySql(options.postgres, layout.apiRoot)
  await applySqlDirectory(options.postgres, join(layout.apiRoot, 'prisma', 'sql', 'migrations', 'post-schema'), 'post-schema migration')
  if (layout.topology === 'monorepo') {
    await run(`${options.phase} monorepo build`, 'npm', ['run', 'build'], options.projectRoot, { ...apiBuildEnv, ...webEnv })
  } else {
    await run(`${options.phase} api build`, 'npm', ['run', 'build'], layout.apiRoot, apiBuildEnv)
    await run(`${options.phase} web build`, 'npm', ['run', 'build'], layout.webRoot, webEnv)
  }

  let api: SupervisedProcessHandle | undefined
  let web: SupervisedProcessHandle | undefined
  let provider: ProviderFixture | undefined
  let primaryFailure: unknown
  let apiProbe!: HttpProbeResult
  let webProbe!: HttpProbeResult
  const bridge = new BrowserFailureBridge()
  try {
    provider = await (options.startProviderFixture ?? startProviderFixture)({ signal: options.signal })
    apiEnv.SF_LIFECYCLE_MAILBOX_URL = provider.url
    apiEnv.SF_LIFECYCLE_MAILBOX_CAPABILITY = provider.capability
    apiEnv.SF_LIFECYCLE_ALLOW_INSECURE_HTTP = 'true'
    apiEnv.NODE_OPTIONS = `--require=${options.egressGuardPath ?? '/workspace/lifecycle/egress-guard.cjs'}`
    api = await processApi.start({
      label: `${options.phase} api`,
      executable: 'npm',
      args: ['run', 'prod'],
      cwd: layout.apiRoot,
      env: apiEnv,
      deadline: options.deadline,
      signal: options.signal,
      ports: [apiPort],
      fatalPatterns: [/EADDRINUSE/, /PrismaClientInitializationError/, /Cannot find module/, /UnhandledPromiseRejection/, /uncaughtException/, /Failed to start application/],
      secrets: [provider.capability]
    })
    web = await processApi.start({
      label: `${options.phase} web`,
      executable: 'npm',
      args: ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'],
      cwd: layout.webRoot,
      env: webEnv,
      deadline: options.deadline,
      signal: options.signal,
      ports: [webPort],
      fatalPatterns: [/EADDRINUSE/, /Cannot find module/, /UnhandledPromiseRejection/, /uncaughtException/, /Internal server error/i]
    })
    const readinessDeadline = Math.min(options.deadline, Date.now() + (options.readinessTimeoutMs ?? 180_000))
    ;[apiProbe, webProbe] = await Promise.all([
      whileRunning(api, waitForHttpProbe({ label: `${options.phase} api`, url: `${apiUrl}/api/health`, deadline: readinessDeadline, signal: options.signal, validate: validateApiHealth })),
      whileRunning(web, waitForHttpProbe({ label: `${options.phase} web`, url: webUrl, deadline: readinessDeadline, signal: options.signal, validate: validateWebDocument }))
    ])
    await assertStableAfterReadiness([api, web], Math.min(options.settleWindowMs ?? 500, Math.max(0, options.deadline - Date.now())), options.signal)
    if (options.onReady) {
      await whileProcessesRunning(
        [api, web],
        options.onReady({
          phase: options.phase,
          topology: layout.topology,
          projectRoot: options.projectRoot,
          apiUrl,
          webUrl,
          databaseUrl: options.postgres.databaseUrl,
          deadline: options.deadline,
          processApi,
          mailbox: { url: provider.url, capability: provider.capability },
          browserCapabilities: options.browserCapabilities ?? [],
          browserFailures: bridge,
          signal: options.signal
        }),
        'live product validation'
      )
    }
    bridge.assertClean()
  } catch (error) {
    primaryFailure = error
  }

  const cleanupFailures: unknown[] = []
  let webResult: SupervisedProcessResult | undefined
  let apiResult: SupervisedProcessResult | undefined
  for (const [handle, save] of [
    [web, (result: SupervisedProcessResult) => (webResult = result)],
    [api, (result: SupervisedProcessResult) => (apiResult = result)]
  ] as const) {
    if (!handle) continue
    try {
      save(await handle.stop())
    } catch (error) {
      cleanupFailures.push(error)
    }
  }
  if (provider) {
    try {
      await provider.stop()
    } catch (error) {
      cleanupFailures.push(error)
    }
  }
  if (primaryFailure !== undefined || cleanupFailures.length > 0) {
    const processEvidence = [apiResult, webResult]
      .filter((result): result is SupervisedProcessResult => result !== undefined)
      .map((result) => `${result.label} (status=${String(result.status)}, signal=${String(result.signal)})\n${[result.stdout, result.stderr].filter(Boolean).join('\n').slice(-8_192)}`)
      .filter((value) => value.trim().length > 0)
    const failures = [...(primaryFailure === undefined ? [] : [primaryFailure]), ...cleanupFailures, ...(processEvidence.length === 0 ? [] : [new Error(processEvidence.join('\n\n'))])]
    throw failures.length === 1 ? failures[0] : new AggregateError(failures, `${options.phase} product runtime and teardown failed.`)
  }
  return {
    phase: options.phase,
    layout,
    apiUrl,
    webUrl,
    apiProbe,
    webProbe,
    apiProcess: apiResult!,
    webProcess: webResult!,
    browserFailureCount: bridge.failures.length
  }
}

async function applySql(postgres: PrivatePostgres, apiRoot: string): Promise<void> {
  for (const family of ['functions', 'triggers', 'datasets']) {
    await applySqlDirectory(postgres, join(apiRoot, 'prisma', 'sql', family), family)
  }
}

async function applySqlDirectory(postgres: PrivatePostgres, directory: string, label: string): Promise<void> {
  let names: string[]
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort((a, b) => a.localeCompare(b, 'en'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const name of names) await postgres.runSqlFile(join(directory, name), `apply ${label}/${name}`)
}

async function whileRunning<T>(process: SupervisedProcessHandle, operation: Promise<T>): Promise<T> {
  return Promise.race([
    operation,
    process.exited.then((result) => {
      throw new Error(`${result.label} exited before its readiness probe completed (status=${String(result.status)}, signal=${String(result.signal)}).`)
    })
  ])
}

async function whileProcessesRunning<T>(processes: readonly SupervisedProcessHandle[], operation: Promise<T>, activity: string): Promise<T> {
  return Promise.race([
    operation,
    ...processes.map((process) =>
      process.exited.then((result) => {
        throw new Error(`${result.label} exited during ${activity} (status=${String(result.status)}, signal=${String(result.signal)}).`)
      })
    )
  ])
}

async function assertStableAfterReadiness(processes: readonly SupervisedProcessHandle[], durationMs: number, signal?: AbortSignal): Promise<void> {
  if (durationMs <= 0) return
  let timer: NodeJS.Timeout | undefined
  let abortListener: (() => void) | undefined
  const settled = new Promise<void>((resolve, reject) => {
    timer = setTimeout(resolve, durationMs)
    if (signal) {
      abortListener = () => reject(signal.reason instanceof Error ? signal.reason : new Error('Lifecycle stability window was aborted.'))
      if (signal.aborted) abortListener()
      else signal.addEventListener('abort', abortListener, { once: true })
    }
  })
  try {
    await Promise.race([
      settled,
      ...processes.map((process) =>
        process.exited.then((result) => {
          throw new Error(`${result.label} exited during the post-readiness stability window (status=${String(result.status)}, signal=${String(result.signal)}).`)
        })
      )
    ])
  } finally {
    if (timer) clearTimeout(timer)
    if (signal && abortListener) signal.removeEventListener('abort', abortListener)
  }
}

function projectName(manifest?: Record<string, unknown>): string | undefined {
  for (const value of [manifest?.projectName, manifest?.name, (manifest?.project as { name?: unknown } | undefined)?.name]) {
    if (typeof value === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(value)) return value
  }
  return undefined
}

async function isFile(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function validateDistinctPorts(ports: readonly number[]): void {
  if (new Set(ports).size !== ports.length || ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65_535)) {
    throw new Error('Lifecycle PostgreSQL, API, and web ports must be distinct integers between 1 and 65535.')
  }
}

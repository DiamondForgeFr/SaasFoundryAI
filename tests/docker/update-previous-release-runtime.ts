import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { createArtifactSink } from './lifecycle/artifacts'
import { verifyHarnessBrowsers, type BrowserCapability } from './lifecycle/browser'
import { runSupervisedProcess } from './lifecycle/process'
import { startPrivatePostgres, type LifecycleProcessApi, type PrivatePostgres, type PrivatePostgresOptions } from './lifecycle/postgres'
import { runProductPhase, type ProductPhaseResult, type ProductReadyContext } from './lifecycle/product'
import type { LifecycleArtifactDescriptor, LifecycleArtifactSink, LifecyclePhase } from './lifecycle/types'
import { runPreviousReleaseUpdateLifecycle, type PreviousReleaseUpdateLifecycleResult } from './update-previous-release'

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000
const CANARY_NAME = 'SF_LIFECYCLE_CANARY'
const CANARY_VALUE = 'before-update-database-state'
const LEGACY_USER_ID = 'sf_lifecycle_legacy_user'
const LEGACY_ACCOUNT_ID = 'sf_lifecycle_legacy_account'
const LEGACY_USER_EMAIL = 'legacy-user@example.test'
const ARTIFACT_PATHS = [
  'capabilities/browsers.json',
  'logs/before-update-api.log',
  'logs/before-update-web.log',
  'logs/after-update-api.log',
  'logs/after-update-web.log',
  'events/before-update.json',
  'events/after-update.json',
  'events/after-update-e2e.json',
  'events/lifecycle-failure.json',
  'screenshots/before-update-failure.png',
  'screenshots/after-update-failure.png',
  'traces/before-update-failure.zip',
  'traces/after-update-failure.zip'
] as const

export interface PreviousReleaseReadyContext extends ProductReadyContext {
  artifacts: LifecycleArtifactSink
  screenshotPath: `screenshots/${LifecyclePhase}-failure.png`
  tracePath: `traces/${LifecyclePhase}-failure.zip`
}

export interface PreviousReleaseRuntimeOptions {
  fixture: Buffer
  workspace: string
  cliEntry: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  postgresPort?: number
  apiPort?: number
  webPort?: number
  /** Exact new directory, or omit to create a run directory below SF_TEST_ARTIFACTS_DIR. */
  artifactRoot?: string
  harnessRuntimeRoot?: string
  processApi?: LifecycleProcessApi
  signal?: AbortSignal
  browserCapabilities?: readonly BrowserCapability[]
  startPostgres?: (options: PrivatePostgresOptions) => Promise<PrivatePostgres>
  onProductReady?: (context: PreviousReleaseReadyContext) => Promise<void>
}

export interface PreviousReleaseRuntimeResult extends PreviousReleaseUpdateLifecycleResult {
  postgresRoot: string
  phases: Readonly<Record<'before-update' | 'after-update', ProductPhaseResult>>
  browserCapabilities: readonly BrowserCapability[]
  artifactRoot: string
  artifacts: readonly LifecycleArtifactDescriptor[]
}

/** Run #787's immutable transition with real old and updated product processes around it. */
export async function runPreviousReleaseRuntimeLifecycle(options: PreviousReleaseRuntimeOptions): Promise<PreviousReleaseRuntimeResult> {
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const artifactSink = await createRuntimeArtifactSink(options)
  const processApi = options.processApi
  const capabilities = options.browserCapabilities ?? (await verifyHarnessBrowsers(options.harnessRuntimeRoot))
  assertCompleteBrowserSet(capabilities)
  await artifactSink.writeText('capabilities/browsers.json', JSON.stringify({ schemaVersion: 1, browsers: capabilities }, null, 2) + '\n', {
    mediaType: 'application/json'
  })

  const postgres = await (options.startPostgres ?? startPrivatePostgres)({
    workspace: options.workspace,
    deadline,
    port: options.postgresPort,
    processApi,
    signal: options.signal
  })
  const phases = {} as Record<'before-update' | 'after-update', ProductPhaseResult>
  let lifecycle: PreviousReleaseUpdateLifecycleResult | undefined
  let primaryFailure: unknown
  let diagnosticFailure: unknown
  try {
    lifecycle = await runPreviousReleaseUpdateLifecycle({
      fixture: options.fixture,
      workspace: options.workspace,
      cliEntry: options.cliEntry,
      env: options.env,
      timeoutMs: Math.max(1, deadline - Date.now()),
      signal: options.signal,
      executeUpdate: processApi
        ? async (request) => {
            const result = await processApi.run({
              label: `sf update ${request.args.join(' ')}`,
              executable: process.execPath,
              args: [request.cliEntry, 'update', ...request.args],
              cwd: request.cwd,
              env: request.env,
              deadline,
              signal: options.signal,
              maxOutputBytes: request.maxOutputBytes
            })
            return { stdout: result.stdout, stderr: result.stderr }
          }
        : async (request) => {
            const result = await runSupervisedProcess({
              label: `sf update ${request.args.join(' ')}`,
              executable: process.execPath,
              args: [request.cliEntry, 'update', ...request.args],
              cwd: request.cwd,
              env: request.env,
              deadline,
              signal: options.signal,
              maxOutputBytes: request.maxOutputBytes
            })
            return { stdout: result.stdout, stderr: result.stderr }
          },
      beforeUpdate: async (context) => {
        phases['before-update'] = await runProductPhase({
          ...context,
          phase: 'before-update',
          postgres,
          apiPort: options.apiPort,
          webPort: options.webPort,
          processApi,
          browserCapabilities: capabilities,
          signal: options.signal,
          onReady: async (ready) =>
            options.onProductReady?.({
              ...ready,
              artifacts: artifactSink,
              screenshotPath: `screenshots/${ready.phase}-failure.png`,
              tracePath: `traces/${ready.phase}-failure.zip`
            })
        })
        await persistPhase(artifactSink, phases['before-update'])
        await postgres.executeSql(
          `BEGIN;
           INSERT INTO public.module_types(name, description) VALUES ('${CANARY_NAME}', '${CANARY_VALUE}');
           INSERT INTO public.accounts(id, name, updated_at) VALUES ('${LEGACY_ACCOUNT_ID}', 'Lifecycle legacy account', NOW());
           INSERT INTO public.users(id, is_active, email, password, updated_at)
             VALUES ('${LEGACY_USER_ID}', TRUE, '${LEGACY_USER_EMAIL}', 'fixture-password-not-used', NOW());
           INSERT INTO public.users_accounts_links(user_id, account_id, updated_at)
             VALUES ('${LEGACY_USER_ID}', '${LEGACY_ACCOUNT_ID}', NOW());
           INSERT INTO public.users_roles_links(user_id, role_id, updated_at)
             SELECT '${LEGACY_USER_ID}', id, NOW() FROM public.roles WHERE name = 'user';
           UPDATE public.roles SET is_active = FALSE WHERE name = 'guest';
           COMMIT;`,
          'create managed-schema lifecycle canaries'
        )
      },
      afterUpdate: async (context) => {
        phases['after-update'] = await runProductPhase({
          ...context,
          phase: 'after-update',
          postgres,
          apiPort: options.apiPort,
          webPort: options.webPort,
          processApi,
          browserCapabilities: capabilities,
          signal: options.signal,
          onReady: async (ready) => {
            const guestStatus = await postgres.executeSql(
              `SELECT is_active::TEXT
               FROM public.roles
               WHERE name = 'guest' AND account_id IS NULL AND is_system = TRUE;`,
              'verify preserved beta guest status'
            )
            if (guestStatus.stdout.trim() !== 'false') throw new Error('The beta migration reactivated the administrator-disabled guest role.')
            await postgres.executeSql(
              `UPDATE public.roles
               SET is_active = TRUE, updated_at = NOW()
               WHERE name = 'guest' AND account_id IS NULL AND is_system = TRUE;`,
              'restore guest role for after-update product validation'
            )
            await options.onProductReady?.({
              ...ready,
              artifacts: artifactSink,
              screenshotPath: `screenshots/${ready.phase}-failure.png`,
              tracePath: `traces/${ready.phase}-failure.zip`
            })
          }
        })
        await persistPhase(artifactSink, phases['after-update'])
        const canary = await postgres.executeSql(`SELECT description FROM public.module_types WHERE name = '${CANARY_NAME}';`, 'verify lifecycle database canary')
        if (canary.stdout.trim() !== CANARY_VALUE) throw new Error('The updated product did not preserve the pre-update PostgreSQL state.')
        const assignment = await postgres.executeSql(
          `SELECT COUNT(*)
           FROM public.users_roles_assignments assignment
           INNER JOIN public.roles role ON role.id = assignment.role_id
           WHERE assignment.user_id = '${LEGACY_USER_ID}'
             AND assignment.account_id = '${LEGACY_ACCOUNT_ID}'
             AND assignment.entity_id IS NULL
             AND role.name = 'account-user';`,
          'verify migrated beta role assignment'
        )
        if (assignment.stdout.trim() !== '1') throw new Error('The beta user role assignment was not preserved as one scoped account assignment.')
        const guestAssignments = await postgres.executeSql(
          `SELECT COUNT(*)
           FROM public.users_roles_assignments assignment
           INNER JOIN public.users user_account ON user_account.id = assignment.user_id
           INNER JOIN public.roles role ON role.id = assignment.role_id
           WHERE user_account.email = 'user@appguest.com'
             AND role.name = 'guest'
             AND assignment.account_id IS NULL
             AND assignment.entity_id IS NULL;`,
          'verify idempotent guest role assignment'
        )
        if (guestAssignments.stdout.trim() !== '1') throw new Error('The beta migration duplicated the seeded guest role assignment.')
        const staging = await postgres.executeSql(`SELECT to_regclass('saasfoundry_migration.beta_user_role_links') IS NULL;`, 'verify migration staging cleanup')
        if (staging.stdout.trim() !== 't') throw new Error('The beta role migration staging table remained after a successful update.')
      }
    })
  } catch (error) {
    primaryFailure = error
    try {
      await artifactSink.writeText('events/lifecycle-failure.json', JSON.stringify({ schemaVersion: 1, error: formatErrorTree(error) }, null, 2) + '\n', {
        mediaType: 'application/json'
      })
    } catch (artifactError) {
      diagnosticFailure = artifactError
    }
  }

  const cleanupFailures: unknown[] = diagnosticFailure === undefined ? [] : [diagnosticFailure]
  try {
    await postgres.stop()
  } catch (error) {
    cleanupFailures.push(error)
  }
  try {
    await artifactSink.writeManifest()
  } catch (error) {
    cleanupFailures.push(error)
  }
  if (primaryFailure !== undefined || cleanupFailures.length > 0) {
    const failures = [...(primaryFailure === undefined ? [] : [primaryFailure]), ...cleanupFailures]
    throw failures.length === 1 ? failures[0] : new AggregateError(failures, 'Previous-release runtime lifecycle and cleanup failed.')
  }
  if (!lifecycle || !phases['before-update'] || !phases['after-update']) throw new Error('Previous-release runtime completed without both required product phases.')
  return {
    ...lifecycle,
    postgresRoot: postgres.root,
    phases,
    browserCapabilities: capabilities,
    artifactRoot: artifactSink.root,
    artifacts: artifactSink.descriptors()
  }
}

async function createRuntimeArtifactSink(options: PreviousReleaseRuntimeOptions): Promise<LifecycleArtifactSink> {
  let root = options.artifactRoot
  if (!root) {
    const parent = resolve(process.env.SF_TEST_ARTIFACTS_DIR ?? join(options.workspace, '..', 'artifacts'))
    await mkdir(parent, { recursive: true })
    root = join(parent, `previous-release-${process.pid}-${Date.now()}`)
  } else {
    await mkdir(dirname(resolve(root)), { recursive: true })
  }
  return createArtifactSink({
    root,
    projectRoot: join(options.workspace, 'previous-release'),
    allowedPaths: ARTIFACT_PATHS,
    secrets: ['lifecycle_fixture_auth_secret_000000000000000000', 'ms_fixture_runtime_key_00000000000000000000']
  })
}

async function persistPhase(sink: LifecycleArtifactSink, phase: ProductPhaseResult): Promise<void> {
  await sink.writeText(`logs/${phase.phase}-api.log`, `${phase.apiProcess.stdout}\n${phase.apiProcess.stderr}`, { mediaType: 'text/plain; charset=utf-8' })
  await sink.writeText(`logs/${phase.phase}-web.log`, `${phase.webProcess.stdout}\n${phase.webProcess.stderr}`, { mediaType: 'text/plain; charset=utf-8' })
  await sink.writeText(
    `events/${phase.phase}.json`,
    JSON.stringify(
      {
        schemaVersion: 1,
        phase: phase.phase,
        topology: phase.layout.topology,
        endpoints: { api: phase.apiUrl, web: phase.webUrl },
        probes: { api: phase.apiProbe, web: phase.webProbe },
        browserFailureCount: phase.browserFailureCount
      },
      null,
      2
    ) + '\n',
    { mediaType: 'application/json' }
  )
}

function assertCompleteBrowserSet(capabilities: readonly BrowserCapability[]): void {
  const names = capabilities.map((capability) => capability.name).sort()
  if (names.join(',') !== 'chromium,firefox,webkit') throw new Error(`Lifecycle browser capability check was incomplete: ${names.join(', ') || 'none'}.`)
}

function formatErrorTree(error: unknown): unknown {
  if (error instanceof AggregateError) return { name: error.name, message: error.message, errors: error.errors.map(formatErrorTree) }
  if (error instanceof Error) return { name: error.name, message: error.message, cause: error.cause === undefined ? undefined : formatErrorTree(error.cause) }
  return { message: String(error) }
}

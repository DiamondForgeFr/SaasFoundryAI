#!/usr/bin/env node
// ── Docker Build Test Harness ──────────────────────────────────
// Generates real SaaSFoundryAI projects and validates they build.
// Runs inside Docker via `Dockerfile.test`.
//
// Usage:
//   TEST_SCENARIO=multirepo-minimal node --import tsx generate-and-build.ts
//   TEST_SCENARIO=all node --import tsx generate-and-build.ts
//   node --import tsx generate-and-build.ts  # runs all scenarios

import { execFileSync, execSync, spawnSync } from 'child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { join, resolve } from 'path'

import {
  assertApiBuildOutput,
  assertDirExists,
  assertFileContains,
  assertFileExists,
  assertPwaBuildOutput,
  assertClaudeMdConfigured,
  assertMonorepoBuildOutput,
  assertMonorepoSharedPackages,
  assertMonorepoEmailSharedTypes,
  assertMonorepoStorageSharedConfig,
  assertMonorepoUiPrimitives,
  assertMultirepoEmailInlined,
  assertMultirepoStorageInlined,
  assertMultirepoUiPrimitivesUntouched,
  assertMonorepoSkills,
  assertMultirepoSkills,
  assertWebBuildOutput,
  assertWorkflowSkill,
  AssertionResult,
  reportResults,
  scanForUnreplacedPlaceholders
} from './assertions'
import { auditHighProductionWorkspaces } from './npm-audit'
import { createArtifactSink } from './lifecycle/artifacts'
import { verifyHarnessBrowsers } from './lifecycle/browser'
import { runLiveSuite } from './lifecycle/live-suite'
import { runSupervisedProcess, startSupervisedProcess } from './lifecycle/process'
import { startPrivatePostgres, type PrivatePostgres } from './lifecycle/postgres'
import { runProductPhase } from './lifecycle/product'
import { finishLifecyclePhase, startLifecyclePhase, startLifecycleTiming, writeLifecycleTiming, type LifecycleTimingStart } from './lifecycle/timings'
import { canonicalTreeDigest } from './legacy-release-fixture'
import {
  ALL_SCENARIOS,
  getScenario,
  GenerationScenario,
  UpdateScenario,
  AIScenario,
  MigrationScenario,
  TestScenario,
  CliScenario,
  BootScenario,
  PreviousReleaseScenario,
  CurrentUpdateScenario,
  type BrowserDepth
} from './scenarios'
import type { LifecycleArtifactSink, LifecyclePhase } from './lifecycle/types'
import { runPreviousReleaseRuntimeLifecycle } from './update-previous-release-runtime'

// ── Config ─────────────────────────────────────────────────────

const WORKSPACE = process.env.WORKSPACE_DIR || '/workspace/projects'
const CLI_PATH = process.env.CLI_PATH || '/cli'
const SCENARIO_ENV = process.env.TEST_SCENARIO || 'all'
const LIVE_DEPTH: BrowserDepth = process.env.TEST_LIVE_DEPTH === 'smoke' ? 'smoke' : 'full'
const LIFECYCLE_ABORT = new AbortController()
const TEARDOWN_RESERVE_MS = 30_000
let ACTIVE_SCENARIO_DEADLINE: number | undefined
let ACTIVE_LIFECYCLE_TIMING: LifecycleTimingStart | undefined

function scenarioDeadline(timeoutSeconds: number): number {
  return ACTIVE_SCENARIO_DEADLINE ?? Date.now() + timeoutSeconds * 1_000
}

function boundedScenarioTimeout(requestedMs: number): number {
  if (ACTIVE_SCENARIO_DEADLINE === undefined) return requestedMs
  const remaining = ACTIVE_SCENARIO_DEADLINE - Date.now() - TEARDOWN_RESERVE_MS
  if (remaining <= 0) throw new Error('Lifecycle budget exhausted; teardown reserve reached.')
  return Math.max(1, Math.min(requestedMs, remaining))
}

const LIVE_ARTIFACT_PATHS = ['events/creation-e2e.json', 'events/after-update-e2e.json', 'screenshots/creation-failure.png', 'screenshots/after-update-failure.png'] as const

async function createLiveArtifactSink(scenarioName: string, projectRoot: string): Promise<LifecycleArtifactSink> {
  const parent = resolve(process.env.SF_TEST_ARTIFACTS_DIR ?? join(WORKSPACE, '..', 'artifacts'))
  mkdirSync(parent, { recursive: true })
  return createArtifactSink({
    root: join(parent, `${scenarioName}-${process.pid}-${Date.now()}`),
    projectRoot,
    allowedPaths: LIVE_ARTIFACT_PATHS,
    secrets: ['fixture-only', 'ms_fixture_runtime_key_00000000000000000000']
  })
}

function liveArtifactPaths(phase: Extract<LifecyclePhase, 'creation' | 'after-update'>) {
  return {
    result: `events/${phase}-e2e.json` as const,
    screenshot: `screenshots/${phase}-failure.png` as const
  }
}

// ── Shell Helper ───────────────────────────────────────────────

function run(cmd: string, cwd: string, label?: string, timeoutMs = 300_000): void {
  const displayLabel = label || cmd.slice(0, 80)
  console.log(`  > ${displayLabel}`)
  try {
    execSync(cmd, {
      cwd,
      stdio: 'pipe',
      timeout: boundedScenarioTimeout(timeoutMs),
      env: {
        ...process.env,
        HUSKY: '0',
        CI: 'true',
        npm_config_loglevel: 'error',
        // Prisma needs this even for generate (schema parsing)
        DATABASE_URL: process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test'
      }
    })
    console.log(`    Done`)
  } catch (err: unknown) {
    const error = err as { stdout?: Buffer; stderr?: Buffer }
    const stdout = error.stdout?.toString().slice(-2000) || ''
    const stderr = error.stderr?.toString().slice(-2000) || ''
    console.error(`    FAILED: ${displayLabel}`)
    if (stdout) console.error(`    stdout: ${stdout}`)
    if (stderr) console.error(`    stderr: ${stderr}`)
    throw new Error(`Command failed: ${cmd}`)
  }
}

/**
 * Exercise the committed multirepo locks without touching the scaffold source.
 *
 * Builders run `npm install` while they apply optional modules. That is correct for a
 * generated project, but it can also refresh an out-of-date source lock and make the later
 * build look green. Dry-running `npm ci` against isolated copies first makes manifest/lock
 * drift fail at the source boundary without materializing two disposable dependency trees.
 */
function validateSourceMultirepoLockfiles(): AssertionResult[] {
  const validationRoot = join(WORKSPACE, '.source-lock-validation')
  const sourceRoot = join(CLI_PATH, 'scaffolds', 'overlays', 'multirepo')

  rmSync(validationRoot, { recursive: true, force: true })
  mkdirSync(validationRoot, { recursive: true })

  try {
    for (const app of ['api', 'web']) {
      const destination = join(validationRoot, app)
      mkdirSync(destination, { recursive: true })
      for (const file of ['package.json', 'package-lock.json']) {
        copyFileSync(join(sourceRoot, app, file), join(destination, file))
      }
      run('npm ci --dry-run --ignore-scripts', destination, `source ${app} lock: npm ci --dry-run`)
    }

    const results = auditHighProductionWorkspaces(validationRoot)
    const failures = results.filter((result) => !result.passed)
    if (failures.length > 0) throw new Error(failures.map((failure) => failure.message).join('\n'))
    return results
  } finally {
    rmSync(validationRoot, { recursive: true, force: true })
  }
}

// ── Project Generation (uses CLI builders directly) ────────────

async function generateProject(scenario: GenerationScenario | (UpdateScenario['base'] & { projectName: string })): Promise<string> {
  const projectDir = join(WORKSPACE, scenario.projectName)
  mkdirSync(join(projectDir, 'apps'), { recursive: true })

  const originalCwd = process.cwd()
  process.chdir(projectDir)

  try {
    // Import builders from the built CLI
    const { createApiApp } = await import(join(CLI_PATH, 'dist', 'builders', 'api.builder'))
    const { createWebApp } = await import(join(CLI_PATH, 'dist', 'builders', 'web.builder'))
    const { createMonorepoRoot } = await import(join(CLI_PATH, 'dist', 'builders', 'monorepo.builder'))
    const { createDevServicesCompose } = await import(join(CLI_PATH, 'dist', 'builders', 'dev-services.builder'))
    const { installSkills } = await import(join(CLI_PATH, 'dist', 'installers', 'skills.installer'))

    // Create API
    await createApiApp({
      isMonorepo: scenario.isMonorepo,
      projectName: scenario.projectName,
      projectDescription: `Docker test: ${scenario.projectName}`,
      backendRepoUrl: 'https://github.com/test/test-api.git',
      dbCredentials: scenario.dbSetup !== 'manual' ? { host: 'localhost', port: '5435', user: 'dev', password: 'dev', database: 'dev', dbType: 'postgresql' as const } : undefined,
      mainBranch: 'main',
      emailService: scenario.emailService,
      mailersendApiKey: scenario.emailService === 'mailersend' ? 'ms-test-key' : undefined,
      mailersendSenderEmail: scenario.emailService === 'mailersend' ? 'noreply@test.com' : undefined,
      mailersendSenderName: scenario.emailService === 'mailersend' ? 'Test' : undefined,
      s3Setup: scenario.s3Setup,
      s3Credentials:
        scenario.s3Setup === 'credentials' ? { endpoint: 'http://localhost:9000', accessKey: 'minioadmin', secretKey: 'minioadmin', bucket: 'test-uploads', region: 'us-east-1' } : undefined
    })

    // Dev services (if docker)
    const hasDevServices = scenario.dbSetup === 'docker' || scenario.s3Setup === 'docker'
    if (hasDevServices) {
      const apiPath = scenario.isMonorepo ? 'apps/api' : `apps/${scenario.projectName}-api`
      await createDevServicesCompose({
        apiPath,
        projectName: scenario.projectName,
        dbSetup: scenario.dbSetup,
        s3Setup: scenario.s3Setup
      })
    }

    // Create Web
    await createWebApp({
      isMonorepo: scenario.isMonorepo,
      projectName: scenario.projectName,
      projectDescription: `Docker test: ${scenario.projectName}`,
      frontendRepoUrl: 'https://github.com/test/test-web.git',
      mainBranch: 'main',
      s3Setup: scenario.s3Setup,
      includeAnalytics: scenario.includeAnalytics,
      includePwa: scenario.includePwa === true
    })

    // Monorepo root
    if (scenario.isMonorepo) {
      await createMonorepoRoot({
        projectName: scenario.projectName,
        projectDescription: `Docker test: ${scenario.projectName}`,
        monorepoUrl: 'https://github.com/test/test-mono.git',
        mainBranch: 'main'
      })
    }

    // Install skills
    const apiPath = scenario.isMonorepo ? 'apps/api' : `apps/${scenario.projectName}-api`
    const webPath = scenario.isMonorepo ? 'apps/web' : `apps/${scenario.projectName}-web`
    await installSkills({
      isMonorepo: scenario.isMonorepo,
      apiPath,
      webPath,
      projectName: scenario.projectName,
      version: '1.0.0-beta'
    })

    // Write a minimal .saasfoundry.json manifest
    writeFileSync(
      join(projectDir, '.saasfoundry.json'),
      JSON.stringify(
        {
          version: '1.0.0-beta',
          generatedAt: new Date().toISOString(),
          structure: scenario.isMonorepo ? 'monorepo' : 'multirepo',
          projectName: scenario.projectName,
          modules: {
            email: { provider: scenario.emailService, version: 1 },
            s3Setup: scenario.s3Setup,
            dbSetup: scenario.dbSetup,
            includeAnalytics: scenario.includeAnalytics,
            advancedSkills: [],
            ...(scenario.includePwa === true ? { pwa: { version: 1 } } : {})
          }
        },
        null,
        2
      )
    )

    return projectDir
  } finally {
    process.chdir(originalCwd)
  }
}

// ── Build Commands ─────────────────────────────────────────────

function buildMultirepoApi(projectDir: string, projectName: string): void {
  const apiPath = join(projectDir, 'apps', `${projectName}-api`)
  run('npm ci --dry-run --ignore-scripts', apiPath, 'npm ci --dry-run (API lock verification)')
  run('npx prisma generate', apiPath, 'prisma generate')
  run('npx nest build', apiPath, 'nest build')
}

function buildMultirepoWeb(projectDir: string, projectName: string): void {
  const webPath = join(projectDir, 'apps', `${projectName}-web`)
  run('npm ci --dry-run --ignore-scripts', webPath, 'npm ci --dry-run (Web lock verification)')
  run('npx tsc -b', webPath, 'tsc -b (Web)')
  run('npx vite build', webPath, 'vite build')
}

function buildMonorepo(projectDir: string): void {
  run('npm ci --dry-run --ignore-scripts', projectDir, 'npm ci --dry-run (monorepo lock verification)')
  run('npx prisma generate', join(projectDir, 'apps', 'api'), 'prisma generate')
  run('npm run lint', projectDir, 'lint all monorepo workspaces')
  run('npx turbo run build', projectDir, 'turbo run build')
}

type OpenApiDocument = {
  paths?: Record<string, unknown>
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

/**
 * Recreate the checked-in snapshot through the generated application's real bootstrap.
 * Removing it first prevents the scaffold fixture from satisfying the wait by itself.
 */
async function emitOpenApiDocument(projectDir: string, runtime?: { postgres: PrivatePostgres; deadline: number; signal?: AbortSignal }): Promise<string> {
  const apiDir = join(projectDir, 'apps', 'api')
  const openApiPath = join(apiDir, 'docs', 'openapi.json')
  if (existsSync(openApiPath)) unlinkSync(openApiPath)
  const deadline = Math.min(runtime?.deadline ?? Number.POSITIVE_INFINITY, Date.now() + 60_000)
  const ownsPostgres = runtime === undefined
  const postgres = runtime?.postgres ?? (await startPrivatePostgres({ workspace: join(WORKSPACE, '.openapi-runtime'), deadline }))
  const manifest = JSON.parse(readFileSync(join(projectDir, '.saasfoundry.json'), 'utf8')) as { ports?: { api?: number } }
  const apiPort = manifest.ports?.api ?? 3500
  let child: Awaited<ReturnType<typeof startSupervisedProcess>> | undefined
  let primaryFailure: unknown
  let emitted = false

  try {
    child = await startSupervisedProcess({
      label: 'generated API OpenAPI emission',
      executable: process.execPath,
      args: ['dist/src/main.js'],
      cwd: apiDir,
      deadline,
      ports: [apiPort],
      env: {
        HUSKY: '0',
        CI: 'true',
        NODE_ENV: 'development',
        DATABASE_URL: postgres.databaseUrl,
        DIRECT_URL: postgres.directUrl,
        PORT: String(apiPort)
      },
      signal: runtime?.signal,
      fatalPatterns: [/EADDRINUSE/, /PrismaClientInitializationError/, /Cannot find module/, /UnhandledPromiseRejection/]
    })
    while (!existsSync(openApiPath)) {
      const exit = await Promise.race([child.exited, wait(100).then(() => undefined)])
      if (exit) {
        throw new Error(
          `generated API exited before emitting OpenAPI (exit=${String(exit.status)}, signal=${String(exit.signal)})\n${[exit.stdout, exit.stderr].filter(Boolean).join('\n').slice(-4_096)}`
        )
      }
      if (Date.now() >= deadline) throw new Error('generated API did not emit docs/openapi.json within 60 seconds')
    }
    emitted = true
  } catch (error) {
    primaryFailure = error
  }

  const cleanupFailures: unknown[] = []
  try {
    if (child) await child.stop()
  } catch (error) {
    cleanupFailures.push(error)
  }
  if (ownsPostgres) {
    try {
      await postgres.stop()
    } catch (error) {
      cleanupFailures.push(error)
    }
  }
  if (primaryFailure !== undefined || cleanupFailures.length > 0) {
    const failures = [...(primaryFailure === undefined ? [] : [primaryFailure]), ...cleanupFailures]
    throw failures.length === 1 ? failures[0] : new AggregateError(failures, 'OpenAPI emission and lifecycle teardown failed.')
  }
  if (!emitted) throw new Error('generated API did not emit docs/openapi.json')
  return openApiPath
}

async function validateGeneratedApiContract(projectDir: string, projectName: string, runtime?: { postgres: PrivatePostgres; deadline: number; signal?: AbortSignal }): Promise<AssertionResult[]> {
  console.log('  > emit and validate OpenAPI, regenerate client, type-check client')
  const openApiPath = await emitOpenApiDocument(projectDir, runtime)
  const require = createRequire(join(process.cwd(), 'package.json'))
  const SwaggerParser = require('@apidevtools/swagger-parser') as {
    validate(path: string): Promise<OpenApiDocument>
  }
  const document = await SwaggerParser.validate(openApiPath)

  run('npm run codegen:api-client', projectDir, 'regenerate api-client from emitted OpenAPI')
  run(`npm run type-check -w @${projectName}/api-client`, projectDir, 'type-check regenerated api-client')

  return [
    {
      passed: Object.prototype.hasOwnProperty.call(document.paths || {}, '/api/health'),
      message: Object.prototype.hasOwnProperty.call(document.paths || {}, '/api/health')
        ? 'OK: validated emitted OpenAPI includes /api/health'
        : 'FAIL: validated emitted OpenAPI is missing /api/health'
    }
  ]
}

// ── Scenario Runners ───────────────────────────────────────────

async function runGenerationScenario(scenario: GenerationScenario): Promise<boolean> {
  console.log(`\nGenerating project: ${scenario.projectName} (${scenario.isMonorepo ? 'monorepo' : 'multirepo'})`)

  const sourceLockResults = scenario.validateSourceLocks === true ? validateSourceMultirepoLockfiles() : []
  const projectDir = await generateProject(scenario)

  console.log(`Building...`)
  if (scenario.isMonorepo) {
    buildMonorepo(projectDir)
  } else {
    buildMultirepoApi(projectDir, scenario.projectName)
    buildMultirepoWeb(projectDir, scenario.projectName)
  }

  // Assertions
  const results: AssertionResult[] = [...sourceLockResults]

  if (scenario.validateApiContract === true) {
    results.push(...(await validateGeneratedApiContract(projectDir, scenario.projectName)))
  }

  if (scenario.auditDependencies === true) {
    console.log('  > production npm audit (high) across generated workspaces')
    results.push(...auditHighProductionWorkspaces(projectDir))
  }

  const storageInstalled = scenario.s3Setup !== 'manual'
  const emailInstalled = scenario.emailService === 'mailersend'

  if (scenario.isMonorepo) {
    results.push(...assertMonorepoBuildOutput(projectDir))
    results.push(...assertMonorepoSharedPackages(projectDir, scenario.projectName))
    results.push(...assertMonorepoUiPrimitives(projectDir, scenario.projectName))
    if (storageInstalled) results.push(...assertMonorepoStorageSharedConfig(projectDir, scenario.projectName))
    if (emailInstalled) results.push(...assertMonorepoEmailSharedTypes(projectDir, scenario.projectName))
  } else {
    const apiPath = join(projectDir, 'apps', `${scenario.projectName}-api`)
    results.push(...assertApiBuildOutput(apiPath))
    results.push(...assertWebBuildOutput(join(projectDir, 'apps', `${scenario.projectName}-web`)))
    results.push(...assertMultirepoUiPrimitivesUntouched(join(projectDir, 'apps', `${scenario.projectName}-web`)))
    if (storageInstalled) results.push(...assertMultirepoStorageInlined(apiPath))
    if (emailInstalled) results.push(...assertMultirepoEmailInlined(apiPath))
  }

  // The PWA module ships build artefacts, not just source config — assert what actually
  // reaches dist/, since that is all the browser ever sees.
  if (scenario.includePwa === true) {
    const webPath = scenario.isMonorepo ? join(projectDir, 'apps', 'web') : join(projectDir, 'apps', `${scenario.projectName}-web`)
    results.push(...assertPwaBuildOutput(webPath))
  }

  results.push(scanForUnreplacedPlaceholders(projectDir))

  return reportResults(scenario.name, results)
}

async function runUpdateScenario(scenario: UpdateScenario): Promise<boolean> {
  console.log(`\nGenerating base project: ${scenario.base.projectName}`)

  const projectDir = await generateProject({ ...scenario.base })

  // Build base project first to verify it works
  console.log(`Building base project...`)
  if (scenario.base.isMonorepo) {
    buildMonorepo(projectDir)
  } else {
    buildMultirepoApi(projectDir, scenario.base.projectName)
    buildMultirepoWeb(projectDir, scenario.base.projectName)
  }

  // Apply module updates
  const originalCwd = process.cwd()
  process.chdir(projectDir)

  try {
    const apiPath = scenario.base.isMonorepo ? 'apps/api' : `apps/${scenario.base.projectName}-api`
    const webPath = scenario.base.isMonorepo ? 'apps/web' : `apps/${scenario.base.projectName}-web`

    if (scenario.addModules.email) {
      console.log(`Installing email module...`)
      const { installEmailModule } = await import(join(CLI_PATH, 'dist', 'installers', 'email.installer'))
      await installEmailModule({
        apiPath,
        isMonorepo: scenario.base.isMonorepo,
        projectName: scenario.base.projectName,
        mailersendApiKey: 'ms-test-key',
        mailersendSenderEmail: 'noreply@test.com',
        mailersendSenderName: 'Test'
      })
    }

    if (scenario.addModules.storage) {
      console.log(`Installing storage module...`)
      const { installStorageModule } = await import(join(CLI_PATH, 'dist', 'installers', 'storage.installer'))
      await installStorageModule({
        apiPath,
        webPath,
        isMonorepo: scenario.base.isMonorepo,
        projectName: scenario.base.projectName,
        s3Setup: 'docker',
        skipNpmInstall: true
      })
    }

    if (scenario.addModules.analytics) {
      console.log(`Installing analytics module...`)
      const { installAnalyticsModule } = await import(join(CLI_PATH, 'dist', 'installers', 'analytics.installer'))
      await installAnalyticsModule({ webPath })
    }
  } finally {
    process.chdir(originalCwd)
  }

  // Rebuild after module installation
  console.log(`Rebuilding after module installation...`)
  if (scenario.base.isMonorepo) {
    // Reinstall to get new deps (e.g., @aws-sdk/client-s3)
    run('npm install --ignore-scripts', projectDir, 'npm install (post-update)')
    run('npx prisma generate', join(projectDir, 'apps', 'api'), 'prisma generate (post-update)')
    run('npx turbo run build --force', projectDir, 'turbo run build --force')
  } else {
    const apiPath = join(projectDir, 'apps', `${scenario.base.projectName}-api`)
    const webPath = join(projectDir, 'apps', `${scenario.base.projectName}-web`)
    run('npm install --ignore-scripts', apiPath, 'npm install (API post-update)')
    run('npx prisma generate', apiPath, 'prisma generate (post-update)')
    run('npx nest build', apiPath, 'nest build (post-update)')
    run('npm install --ignore-scripts', webPath, 'npm install (Web post-update)')
    run('npx tsc -b', webPath, 'tsc -b (Web post-update)')
    run('npx vite build', webPath, 'vite build (post-update)')
  }

  // Assertions
  const results: AssertionResult[] = []

  if (scenario.base.isMonorepo) {
    results.push(...assertMonorepoBuildOutput(projectDir))
    results.push(...assertMonorepoSharedPackages(projectDir, scenario.base.projectName))
    results.push(...assertMonorepoUiPrimitives(projectDir, scenario.base.projectName))
    if (scenario.addModules.storage) results.push(...assertMonorepoStorageSharedConfig(projectDir, scenario.base.projectName))
    if (scenario.addModules.email) results.push(...assertMonorepoEmailSharedTypes(projectDir, scenario.base.projectName))
  } else {
    const apiPath = join(projectDir, 'apps', `${scenario.base.projectName}-api`)
    results.push(...assertApiBuildOutput(apiPath))
    results.push(...assertWebBuildOutput(join(projectDir, 'apps', `${scenario.base.projectName}-web`)))
    results.push(...assertMultirepoUiPrimitivesUntouched(join(projectDir, 'apps', `${scenario.base.projectName}-web`)))
    if (scenario.addModules.storage) results.push(...assertMultirepoStorageInlined(apiPath))
    if (scenario.addModules.email) results.push(...assertMultirepoEmailInlined(apiPath))
  }

  results.push(scanForUnreplacedPlaceholders(projectDir))

  return reportResults(scenario.name, results)
}

async function runAIScenario(scenario: AIScenario): Promise<boolean> {
  console.log(`\nGenerating project for AI checks: ${scenario.projectName}`)

  // Generate a minimal project (no build needed)
  const genConfig: GenerationScenario = {
    type: 'generation',
    name: scenario.name,
    projectName: scenario.projectName,
    isMonorepo: scenario.isMonorepo,
    dbSetup: 'manual',
    s3Setup: 'manual',
    emailService: 'none',
    includeAnalytics: false
  }

  const projectDir = await generateProject(genConfig)

  // For workflow checks, also install workflow skill
  if (scenario.checks.includes('workflow')) {
    const originalCwd = process.cwd()
    process.chdir(projectDir)
    try {
      const { installWorkflowSkill } = await import(join(CLI_PATH, 'dist', 'installers', 'workflow-skill.installer'))
      const targetPath = scenario.isMonorepo ? '.' : `apps/${scenario.projectName}-api`
      await installWorkflowSkill({
        targetPath,
        workflow: {
          tool: 'github-projects',
          projectUrl: 'https://github.com/test/test-project/projects/1',
          workingBranch: 'develop',
          prTargetBranch: 'develop',
          statuses: [
            { name: 'Backlog', color: 'GRAY' },
            { name: 'Ready', color: 'YELLOW' },
            { name: 'In Progress', color: 'BLUE' },
            { name: 'Done', color: 'GREEN' }
          ],
          branchNaming: { feature: 'feature/{ticket}-{description}', fix: 'fix/{ticket}-{description}' },
          template: 'saasfoundry-ai'
        },
        projectUrl: 'https://github.com/test/test-project/projects/1'
      })
    } finally {
      process.chdir(originalCwd)
    }
  }

  const results: AssertionResult[] = []

  // Skills checks
  if (scenario.checks.includes('skills')) {
    if (scenario.isMonorepo) {
      results.push(...assertMonorepoSkills(projectDir))
    } else {
      const apiPath = join(projectDir, 'apps', `${scenario.projectName}-api`)
      const webPath = join(projectDir, 'apps', `${scenario.projectName}-web`)
      results.push(...assertMultirepoSkills(apiPath, webPath))
    }
  }

  // CLAUDE.md checks
  if (scenario.checks.includes('claude-md')) {
    if (scenario.isMonorepo) {
      results.push(...assertClaudeMdConfigured(join(projectDir, 'CLAUDE.md'), scenario.projectName))
    } else {
      const apiPath = join(projectDir, 'apps', `${scenario.projectName}-api`)
      const webPath = join(projectDir, 'apps', `${scenario.projectName}-web`)
      results.push(...assertClaudeMdConfigured(join(apiPath, 'CLAUDE.md'), scenario.projectName))
      results.push(...assertClaudeMdConfigured(join(webPath, 'CLAUDE.md'), scenario.projectName))
    }
  }

  // Workflow checks
  if (scenario.checks.includes('workflow')) {
    if (scenario.isMonorepo) {
      results.push(...assertWorkflowSkill(join(projectDir, '.claude', 'skills', 'sf-workflow')))
    } else {
      results.push(...assertWorkflowSkill(join(projectDir, 'apps', `${scenario.projectName}-api`, '.claude', 'skills', 'sf-workflow')))
    }

    // Verify CLAUDE.md has workflow section
    const wfClaudeMdPath = scenario.isMonorepo ? join(projectDir, 'CLAUDE.md') : join(projectDir, 'apps', `${scenario.projectName}-api`, 'CLAUDE.md')
    results.push(...assertClaudeMdConfigured(wfClaudeMdPath, scenario.projectName))
  }

  // Placeholder scan (no build dirs to worry about)
  results.push(scanForUnreplacedPlaceholders(projectDir))

  return reportResults(scenario.name, results)
}

async function runMigrationScenario(scenario: MigrationScenario): Promise<boolean> {
  console.log(`\nGenerating project for migration check: ${scenario.projectName}`)

  // Reuse generateProject's minimal generation; we don't need a build for this scenario.
  const projectDir = await generateProject({
    projectName: scenario.projectName,
    isMonorepo: scenario.isMonorepo,
    dbSetup: 'manual',
    s3Setup: 'manual',
    emailService: 'none',
    includeAnalytics: false
  })

  // Overwrite the manifest with a v0-shape (legacy) version: no $schema, no
  // manifestVersion. This simulates a project scaffolded before Epic #310
  // shipped, which is the input the migration framework must rescue.
  const manifestPath = join(projectDir, '.saasfoundry.json')
  const legacyManifest = {
    version: '0.9.0',
    generatedAt: '2026-01-15T00:00:00.000Z',
    structure: scenario.isMonorepo ? 'monorepo' : 'multirepo',
    projectName: scenario.projectName,
    modules: {
      emailService: 'none',
      s3Setup: 'manual',
      dbSetup: 'manual',
      includeAnalytics: false,
      advancedSkills: []
    }
  }
  writeFileSync(manifestPath, JSON.stringify(legacyManifest, null, 2))

  // Invoke the update command programmatically against the legacy manifest.
  // Non-interactive + no module additions so the run hits the migration
  // step then early-returns at the "no modules to install" branch — this is
  // exactly the path that previously dropped the $schema stamp on the floor.
  const originalCwd = process.cwd()
  process.chdir(projectDir)
  try {
    const { updateCommand } = await import(join(CLI_PATH, 'dist', 'commands', 'update'))
    // addModules='' → parseAddModules returns [] → prefill.selectedModules = []
    // (an empty CSV is the contract for "non-interactive run that adds nothing")
    await updateCommand({ nonInteractive: true, acceptTemplateUpdates: false, addModules: '' })
  } finally {
    process.chdir(originalCwd)
  }

  // Read back the manifest and check the dispatcher did its job.
  const after = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>

  const expectedSchema = 'https://raw.githubusercontent.com/DiamondForgeFr/SaasFoundryAI/master/schemas/saasfoundry-manifest.schema.json'

  const schemaOk = after.$schema === expectedSchema
  const versionOk = typeof after.manifestVersion === 'number' && after.manifestVersion >= 1
  const fieldsOk = after.projectName === scenario.projectName && after.version === '0.9.0'
  const firstKeyOk = Object.keys(after)[0] === '$schema'

  // Migration 002 must have lifted the legacy flat `emailService` enum into
  // the nested `email.{provider, version}` object — this catches a chain
  // that stops mid-way (e.g. registry not appended-to when adding migrations).
  const modules = (after.modules ?? {}) as Record<string, unknown>
  const emailShape = (modules.email ?? null) as { provider?: unknown; version?: unknown } | null
  const emailMigrated = emailShape !== null && emailShape.provider === 'none' && typeof emailShape.version === 'number' && !('emailService' in modules)

  const results: AssertionResult[] = [
    {
      passed: schemaOk,
      message: schemaOk ? `OK: $schema stamped (${expectedSchema})` : `FAIL: expected $schema=${expectedSchema}, got ${String(after.$schema)}`
    },
    {
      passed: versionOk,
      message: versionOk ? `OK: manifestVersion=${after.manifestVersion} (>= 1)` : `FAIL: expected manifestVersion >= 1, got ${String(after.manifestVersion)}`
    },
    {
      passed: fieldsOk,
      message: fieldsOk ? `OK: original fields preserved (projectName + version)` : `FAIL: projectName=${String(after.projectName)} version=${String(after.version)}`
    },
    {
      passed: firstKeyOk,
      message: firstKeyOk ? `OK: $schema is first key (sf new parity)` : `FAIL: first key=${Object.keys(after)[0]}`
    },
    {
      passed: emailMigrated,
      message: emailMigrated
        ? `OK: modules.email migrated to {provider, version} and legacy emailService dropped`
        : `FAIL: expected modules.email={provider,version} and no emailService, got ${JSON.stringify(modules)}`
    }
  ]

  return reportResults(scenario.name, results)
}

// Kept temporarily as non-routable reference implementations while the executable
// replacement map protects signal parity. ALL_SCENARIOS cannot select these runners.
void runGenerationScenario
void runUpdateScenario
void runAIScenario
void runMigrationScenario

// ── CLI Scenario (runs the real binary as a subprocess) ────────

/**
 * The only scenario type that executes `bin/sf.js`.
 *
 * Everything else reaches past it: the generation scenarios call the builders and create
 * the project directory themselves, and the migration one imports `updateCommand`. So the
 * bin entrypoint, Commander, the non-interactive flag validation, and everything `sf new`
 * does before delegating were covered by nothing — which is why a criterion as plain as
 * "the project folder is created alongside, not inside" (#537) had to be checked by hand.
 *
 * The workspace is seeded with pre-existing content on purpose. `alongside` only means
 * something when there is something to be alongside of, and it is the cheapest way to
 * catch a command that scaffolds over a user's files.
 */
async function runCliScenario(scenario: CliScenario): Promise<boolean> {
  const workspace = join(WORKSPACE, `cli-${scenario.name}`)
  mkdirSync(join(workspace, 'existing-src'), { recursive: true })
  writeFileSync(join(workspace, 'PREEXISTING.md'), 'this file existed before sf new ran\n')
  writeFileSync(join(workspace, 'existing-src', 'poc.js'), 'console.log("poc")\n')

  // The harness profile deposits onto an existing repository, so give it one.
  run('git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm seed', workspace, 'seed a repository')

  console.log(`\nRunning the CLI for real: sf new --profile ${scenario.profile}`)

  const bin = join(CLI_PATH, 'bin', 'sf.js')
  const flags = [
    'new',
    '--non-interactive',
    `--project-name ${scenario.projectName}`,
    `--project-description "docker cli scenario: ${scenario.name}"`,
    `--structure ${scenario.isMonorepo ? 'monorepo' : 'multirepo'}`,
    '--main-branch main',
    '--setup-repo local',
    `--profile ${scenario.profile}`,
    '--db-setup manual',
    '--email-service none',
    '--s3-setup manual',
    '--start-apps none',
    '--no-analytics'
  ].join(' ')

  run(`node ${bin} ${flags}`, workspace, `sf new --profile ${scenario.profile}`)

  const projectDir = join(workspace, scenario.projectName)
  const results: AssertionResult[] = []

  if (scenario.profile === 'harness') {
    // The damaging failure mode: harness must scaffold nothing. Getting this wrong lays a
    // full stack over a repository the user intends to keep (#510).
    results.push({
      passed: !existsSync(projectDir),
      message: !existsSync(projectDir) ? 'OK: harness created no project directory' : `FAIL: harness created ${scenario.projectName}/ — it must deposit into the cwd and scaffold nothing`
    })
    results.push(assertFileExists(join(workspace, '.saasfoundry.json')))
    results.push(assertFileContains(join(workspace, '.saasfoundry.json'), '"structure": "cli"'))
    results.push(assertDirExists(join(workspace, '.claude')))
    results.push(assertFileExists(join(workspace, 'CLAUDE.md')))

    // Exercise multi-agent setup in this existing quick Linux scenario rather than adding
    // another scaffold/build to the matrix. The generated harness has no workflow in
    // non-interactive mode, so install the same bounded fixture used by ai-workflow-config
    // before asking the real CLI to project it into the shared agent directory.
    const { installWorkflowSkill } = await import(join(CLI_PATH, 'dist', 'installers', 'workflow-skill.installer'))
    await installWorkflowSkill({
      targetPath: workspace,
      workflow: {
        tool: 'github-projects',
        projectUrl: 'https://github.com/test/test-project/projects/1',
        workingBranch: 'develop',
        prTargetBranch: 'develop',
        statuses: [
          { name: 'Backlog', color: 'GRAY' },
          { name: 'Ready', color: 'YELLOW' },
          { name: 'In Progress', color: 'BLUE' },
          { name: 'Done', color: 'GREEN' }
        ],
        branchNaming: { feature: 'feature/{ticket}-{description}', fix: 'fix/{ticket}-{description}' },
        template: 'saasfoundry-ai'
      },
      projectUrl: 'https://github.com/test/test-project/projects/1'
    })

    const agentHome = join(WORKSPACE, `.home-${scenario.name}`)
    const agentTmp = join(WORKSPACE, `.tmp-${scenario.name}`)
    mkdirSync(agentHome, { recursive: true })
    mkdirSync(agentTmp, { recursive: true })
    writeFileSync(join(agentHome, '.gitconfig'), '')
    const agentEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      HOME: agentHome,
      TMPDIR: agentTmp,
      TEMP: agentTmp,
      TMP: agentTmp,
      LANG: process.env.LANG ?? 'C.UTF-8',
      CI: 'true',
      HUSKY: '0',
      SF_SKILL_NO_WARN: '1',
      GIT_CONFIG_GLOBAL: join(agentHome, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1'
    }
    const agentsJson = (...args: string[]) =>
      JSON.parse(
        execFileSync(process.execPath, [bin, 'agents', ...args, '--json'], {
          cwd: workspace,
          encoding: 'utf8',
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
          env: agentEnv
        })
      ) as { configuredAgents: string[]; sharedAgents: string[]; localAgents: string[] }

    const shared = agentsJson('enable', 'codex', 'gemini-cli', '--scope', 'shared')
    results.push({
      passed: ['claude-code', 'codex', 'gemini-cli'].every((agent) => shared.sharedAgents.includes(agent)),
      message: `Shared agent coexistence: ${shared.sharedAgents.join(', ')}`
    })

    const sharedWorkflow = join(workspace, '.agents', 'skills', 'sf-workflow')
    const sharedCli = join(sharedWorkflow, 'workflow-cli.sh')
    const sharedSkill = join(sharedWorkflow, 'SKILL.md')
    for (const path of [join(workspace, 'CLAUDE.md'), join(workspace, 'AGENTS.md'), join(workspace, 'GEMINI.md'), sharedCli, sharedSkill]) {
      const regular = existsSync(path) && lstatSync(path).isFile()
      results.push({ passed: regular, message: regular ? `OK: ${path} is a regular file` : `FAIL: ${path} is missing, linked, or not a regular file` })
    }
    const guardExecutable = existsSync(sharedCli) && (lstatSync(sharedCli).mode & 0o111) !== 0
    results.push({ passed: guardExecutable, message: guardExecutable ? `OK: ${sharedCli} is executable` : `FAIL: ${sharedCli} is not executable` })
    if (existsSync(sharedCli) && existsSync(sharedSkill)) {
      const sharedSkillContent = readFileSync(sharedSkill, 'utf8')
      results.push({
        passed:
          readFileSync(sharedCli).equals(readFileSync(join(workspace, '.claude', 'skills', 'sf-workflow', 'workflow-cli.sh'))) &&
          /workflow/i.test(sharedSkillContent) &&
          sharedSkillContent.includes('../../../.claude/docs/manifest-schema.md'),
        message: 'Shared workflow CLI is copied exactly and SKILL.md has its shared-directory documentation links'
      })
    }

    // These negative assertions only add signal on Docker's case-sensitive Linux
    // filesystem. They catch adapters that happen to work on a default macOS checkout.
    for (const wrongCase of ['agents.md', 'gemini.md', '.Agents', '.agents/Skills']) {
      const absent = !existsSync(join(workspace, wrongCase))
      results.push({ passed: absent, message: absent ? `OK: wrong-case path ${wrongCase} is absent` : `FAIL: wrong-case path ${wrongCase} exists` })
    }

    execFileSync('git', ['add', '-A'], { cwd: workspace, env: agentEnv, timeout: 30_000, maxBuffer: 1024 * 1024 })
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'shared agent support'], {
      cwd: workspace,
      env: agentEnv,
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    })
    const sharedManifest = readFileSync(join(workspace, '.saasfoundry.json'))
    const local = agentsJson('enable', 'kimi', '--scope', 'local')
    const inventory = agentsJson('list')
    const cleanAfterLocal = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: workspace, encoding: 'utf8', env: agentEnv, timeout: 30_000, maxBuffer: 1024 * 1024 }) === ''
    results.push({ passed: local.localAgents.includes('kimi'), message: `Local agents after enable: ${local.localAgents.join(', ') || '(none)'}` })
    results.push({
      passed: inventory.localAgents.includes('kimi') && ['claude-code', 'codex', 'gemini-cli'].every((agent) => inventory.sharedAgents.includes(agent)),
      message: `Isolated inventory — shared: ${inventory.sharedAgents.join(', ')}; local: ${inventory.localAgents.join(', ') || '(none)'}`
    })
    results.push({
      passed: readFileSync(join(workspace, '.saasfoundry.json')).equals(sharedManifest) && cleanAfterLocal,
      message: cleanAfterLocal ? 'Local enable preserved the shared manifest and tracked tree' : 'FAIL: local enable changed the tracked tree'
    })

    const guardBefore = [readFileSync(sharedCli), readFileSync(sharedSkill), readFileSync(join(workspace, '.saasfoundry.json'))]
    const guard = spawnSync(sharedCli, ['help'], { cwd: workspace, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024, env: agentEnv })
    const guardAfter = [readFileSync(sharedCli), readFileSync(sharedSkill), readFileSync(join(workspace, '.saasfoundry.json'))]
    const guardReadOnly =
      guardBefore.every((content, index) => content.equals(guardAfter[index])) &&
      execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: workspace, encoding: 'utf8', env: agentEnv, timeout: 30_000, maxBuffer: 1024 * 1024 }) === ''
    const guardPassed = guard.status === 0 && /workflow/i.test(guard.stdout) && guardReadOnly
    const guardFailure = guard.error ? 'spawn-error' : guard.status === null ? 'terminated' : guard.status !== 0 ? 'nonzero-exit' : !guardReadOnly ? 'fixture-changed' : 'unexpected-output'
    results.push({
      passed: guardPassed,
      message: guardPassed
        ? 'Shared guarded workflow CLI help executed read-only'
        : `FAIL: shared guarded workflow CLI help category=${guardFailure} exit=${String(guard.status)} signal=${guard.signal ?? 'none'}`
    })
  } else {
    // The placement criterion #537 could not lean on any test for.
    results.push(assertDirExists(projectDir))
    results.push(assertFileExists(join(projectDir, '.saasfoundry.json')))
    results.push({
      passed: !existsSync(join(workspace, '.saasfoundry.json')),
      message: !existsSync(join(workspace, '.saasfoundry.json'))
        ? 'OK: the manifest is inside the project, not in the working directory'
        : 'FAIL: a manifest was written into the working directory — the full profile must scaffold into its own directory'
    })
    results.push({
      passed: !existsSync(join(workspace, 'existing-src', scenario.projectName)),
      message: !existsSync(join(workspace, 'existing-src', scenario.projectName))
        ? 'OK: the project was not created inside pre-existing content'
        : 'FAIL: the project landed inside existing-src/ — it must be a sibling'
    })
  }

  // True of both profiles: the command may add, never trample.
  results.push(assertFileContains(join(workspace, 'PREEXISTING.md'), 'this file existed before sf new ran'))
  results.push(assertFileContains(join(workspace, 'existing-src', 'poc.js'), 'console.log("poc")'))

  return reportResults(scenario.name, results)
}

// ── Boot Scenario ──────────────────────────────────────────────

/**
 * A step whose failure says which step it was.
 *
 * "scenario failed" after eight minutes is not usable. Every stage of this scenario runs
 * through here so the report names install, database setup, boot, audit or the unit suite.
 */
async function runStep<T>(label: string, fn: () => Promise<T> | T): Promise<T> {
  const phase = startLifecyclePhase(label)
  console.log(`  > ${label}`)
  try {
    const value = await fn()
    ACTIVE_LIFECYCLE_TIMING?.phases.push(finishLifecyclePhase(phase, 'passed'))
    console.log(`    Done`)
    return value
  } catch (err) {
    ACTIVE_LIFECYCLE_TIMING?.phases.push(finishLifecyclePhase(phase, 'failed'))
    const detail = formatErrorDetails(err)
    throw new Error(`step "${label}" failed: ${detail}`)
  }
}

function formatErrorDetails(error: unknown): string {
  if (error instanceof AggregateError) {
    return [error.message, ...error.errors.map(formatErrorDetails)].filter(Boolean).join('\n')
  }
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause
    return cause === undefined ? error.message : `${error.message}\n${formatErrorDetails(cause)}`
  }
  return String(error)
}

/**
 * The scenario that starts the project.
 *
 * `--db-setup credentials` against the local cluster is not a shortcut around the docker
 * path: `initAndStartDb` runs `db:setup:dev` for `credentials` exactly as it does for
 * `docker`, skipping only `docker compose up` — which has no meaning inside a container
 * that already has its database. Prisma generate, `prisma db push` and the SQL under
 * `prisma/sql/` all run for real.
 */
async function runBootScenario(scenario: BootScenario): Promise<boolean> {
  const workspace = join(WORKSPACE, `boot-${scenario.name}`)
  mkdirSync(join(workspace, 'existing-src'), { recursive: true })
  writeFileSync(join(workspace, 'PREEXISTING.md'), 'this file existed before sf new ran\n')
  writeFileSync(join(workspace, 'existing-src', 'poc.js'), 'console.log("poc")\n')

  const projectDir = join(workspace, scenario.projectName)
  const structure = scenario.structure
  const profile = scenario.profile
  const apiDir = structure === 'monorepo' ? join(projectDir, 'apps', 'api') : join(projectDir, 'apps', `${scenario.projectName}-api`)
  const deadline = scenarioDeadline(scenario.timeoutSeconds)
  const results: AssertionResult[] = []
  let postgres: PrivatePostgres | undefined
  let artifacts: LifecycleArtifactSink | undefined

  try {
    artifacts = await createLiveArtifactSink(scenario.name, projectDir)
    if (structure === 'monorepo') {
      const harnessPassed = await runStep('real CLI harness on a non-empty repository', () =>
        runCliScenario({ type: 'cli', name: 'lifecycle-harness', projectName: 'must-not-exist', profile: 'harness', isMonorepo: true })
      )
      results.push({ passed: harnessPassed, message: 'OK: the compiled CLI harness preserved a non-empty repository' })
    }
    postgres = await runStep('start isolated postgres', () => startPrivatePostgres({ workspace, deadline, signal: LIFECYCLE_ABORT.signal }))

    await runStep('sf new --start-services', async () => {
      const bin = join(CLI_PATH, 'bin', 'sf.js')
      await runSupervisedProcess({
        label: 'sf new (real install, db setup, prisma generate)',
        executable: process.execPath,
        args: [
          bin,
          'new',
          '--non-interactive',
          '--project-name',
          scenario.projectName,
          '--project-description',
          'docker boot scenario',
          '--structure',
          structure,
          '--main-branch',
          'main',
          '--setup-repo',
          'local',
          '--profile',
          profile,
          '--db-setup',
          'credentials',
          '--db-host',
          '127.0.0.1',
          '--db-port',
          String(postgres!.port),
          '--db-user',
          'sf_lifecycle',
          '--db-password',
          'fixture-only',
          '--db-name',
          'sf_lifecycle',
          '--email-service',
          profile === 'full' ? 'mailersend' : 'none',
          ...(profile === 'full'
            ? ['--mailersend-api-key', 'ms_fixture_runtime_key_00000000000000000000', '--mailersend-sender-email', 'noreply@example.test', '--mailersend-sender-name', 'Fixture']
            : []),
          '--s3-setup',
          'credentials',
          '--s3-endpoint',
          'http://127.0.0.1:9000',
          '--s3-access-key',
          'fixture-access-key',
          '--s3-secret-key',
          'fixture-only',
          '--s3-bucket',
          'sf-lifecycle',
          '--s3-region',
          'us-east-1',
          profile === 'full' ? '--analytics' : '--no-analytics',
          '--no-workflow',
          '--no-srs-enable',
          '--start-services',
          '--start-apps',
          'none'
        ],
        cwd: workspace,
        deadline,
        env: {
          npm_config_loglevel: 'error',
          PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
          ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
          ...(process.env.USERPROFILE ? { USERPROFILE: process.env.USERPROFILE } : {})
        },
        secrets: ['fixture-only'],
        signal: LIFECYCLE_ABORT.signal
      })
    })

    // The ports the project chose. Anything else would be assuming what #584 made variable.
    const manifest = JSON.parse(readFileSync(join(projectDir, '.saasfoundry.json'), 'utf8')) as Record<string, unknown> & { ports?: { api?: number; web?: number } }
    const ports = manifest.ports || { api: 3500, web: 5173 }
    console.log(`  · the project resolved api=${ports.api} web=${ports.web}`)

    const browserCapabilities = await runStep('verify harness browser capabilities', () => verifyHarnessBrowsers('/workspace'))
    const phase = await runStep('production API/web boot, strict readiness and verified teardown', () =>
      runProductPhase({
        phase: 'creation',
        projectRoot: projectDir,
        manifest,
        postgres: postgres!,
        deadline,
        readinessTimeoutMs: scenario.bootTimeoutSeconds * 1_000,
        apiPort: ports.api,
        webPort: ports.web,
        browserCapabilities,
        signal: LIFECYCLE_ABORT.signal,
        onReady: (context) =>
          runLiveSuite(context, {
            depth: LIVE_DEPTH,
            runtimeRoot: '/workspace',
            artifacts,
            artifactPaths: liveArtifactPaths('creation')
          }).then(() => undefined)
      })
    )
    results.push({ passed: phase.apiProbe.status === 200, message: `OK: the API answered strict /api/health on ${ports.api}` })
    results.push({ passed: phase.webProbe.status === 200, message: `OK: the production web app answered on ${ports.web}` })
    results.push({ passed: true, message: 'OK: API and web process groups stopped through supervised teardown' })
    results.push(assertFileContains(join(workspace, 'PREEXISTING.md'), 'this file existed before sf new ran'))
    results.push(assertFileContains(join(workspace, 'existing-src', 'poc.js'), 'console.log("poc")'))
    results.push(scanForUnreplacedPlaceholders(projectDir))

    const webDir = structure === 'monorepo' ? join(projectDir, 'apps', 'web') : join(projectDir, 'apps', `${scenario.projectName}-web`)
    if (structure === 'monorepo') {
      results.push(...assertMonorepoBuildOutput(projectDir))
      results.push(...assertMonorepoSharedPackages(projectDir, scenario.projectName))
      results.push(...assertMonorepoEmailSharedTypes(projectDir, scenario.projectName))
      results.push(...assertMonorepoStorageSharedConfig(projectDir, scenario.projectName))
      results.push(...assertMonorepoUiPrimitives(projectDir, scenario.projectName))
    } else {
      const web = join(projectDir, 'apps', `${scenario.projectName}-web`)
      results.push(...assertApiBuildOutput(apiDir))
      results.push(...assertWebBuildOutput(web))
      results.push(...assertMultirepoEmailInlined(apiDir))
      results.push(...assertMultirepoStorageInlined(apiDir))
      results.push(...assertMultirepoUiPrimitivesUntouched(web))
      results.push(...validateSourceMultirepoLockfiles())
    }
    results.push(...assertPwaBuildOutput(webDir))
    if (structure === 'monorepo') {
      results.push(
        ...(await runStep('emitted OpenAPI and generated client contract', () =>
          validateGeneratedApiContract(projectDir, scenario.projectName, { postgres: postgres!, deadline, signal: LIFECYCLE_ABORT.signal })
        ))
      )
    }

    await runStep('production npm audit (high)', () => {
      results.push(
        ...auditHighProductionWorkspaces(projectDir, (cwd, args) => {
          execFileSync('npm', args, { cwd, stdio: 'pipe', timeout: boundedScenarioTimeout(120_000) })
        })
      )
    })

    await runStep('api npm run test:unit', () => {
      try {
        execSync('npm run test:unit', { cwd: apiDir, stdio: 'pipe', timeout: boundedScenarioTimeout(600_000) })
        results.push({ passed: true, message: 'OK: the api unit suite the project ships passes' })
      } catch (err) {
        const error = err as { stdout?: Buffer; stderr?: Buffer }
        const output = `${error.stdout?.toString().slice(-2000) || ''}${error.stderr?.toString().slice(-2000) || ''}`
        results.push({ passed: false, message: `FAIL: the api unit suite is red\n${output}` })
      }
    })
  } catch (err) {
    results.push({ passed: false, message: `FAIL: ${err instanceof Error ? err.message : String(err)}` })
  } finally {
    if (postgres) {
      try {
        await runStep('teardown isolated postgres', () => postgres!.stop())
      } catch (error) {
        results.push({ passed: false, message: `FAIL: isolated postgres teardown: ${error instanceof Error ? error.message : String(error)}` })
      }
    }
    if (artifacts) {
      try {
        await artifacts.writeManifest()
      } catch (error) {
        results.push({ passed: false, message: `FAIL: lifecycle artifact manifest: ${formatErrorDetails(error)}` })
      }
    }
  }

  return reportResults(scenario.name, results)
}

async function runPreviousReleaseScenario(scenario: PreviousReleaseScenario): Promise<boolean> {
  const workspace = join(WORKSPACE, scenario.name)
  mkdirSync(workspace, { recursive: true })
  const fixture = readFileSync(join('/workspace', 'fixtures', 'previous-release', '1.0.0-beta', 'multirepo.fixture.json.gz'))
  const results: AssertionResult[] = []

  try {
    const lifecycle = await runStep('materialize, update and boot previous release', () =>
      runPreviousReleaseRuntimeLifecycle({
        fixture,
        workspace,
        cliEntry: join(CLI_PATH, 'bin', 'sf.js'),
        timeoutMs: Math.max(1, scenarioDeadline(scenario.timeoutSeconds) - Date.now()),
        harnessRuntimeRoot: '/workspace',
        env: {
          PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
          npm_config_loglevel: 'error'
        },
        onProductReady: async (context) => {
          if (context.phase !== 'after-update') return
          await runLiveSuite(context, {
            depth: LIVE_DEPTH,
            runtimeRoot: '/workspace',
            artifacts: context.artifacts,
            artifactPaths: {
              result: 'events/after-update-e2e.json',
              screenshot: context.screenshotPath
            }
          })
        },
        signal: LIFECYCLE_ABORT.signal
      })
    )
    const before = lifecycle.phases['before-update']
    const after = lifecycle.phases['after-update']
    results.push({ passed: before?.apiProbe.status === 200 && before.webProbe.status === 200, message: 'OK: authentic beta API and web booted against isolated PostgreSQL' })
    results.push({ passed: after?.apiProbe.status === 200 && after.webProbe.status === 200, message: 'OK: updated API and web booted against the preserved PostgreSQL state' })
    results.push({ passed: lifecycle.browserCapabilities.length === 3, message: 'OK: Chromium, Firefox and WebKit launched from the pinned harness runtime' })
    results.push({ passed: lifecycle.artifacts.some((artifact) => artifact.path === 'manifest.json'), message: `OK: sanitized diagnostic manifest written under ${lifecycle.artifactRoot}` })
    results.push({ passed: /^[0-9a-f]{64}$/.test(lifecycle.stableDigest), message: 'OK: the second identical update remained byte-idempotent' })
  } catch (error) {
    results.push({ passed: false, message: `FAIL: ${formatErrorDetails(error)}` })
  }
  return reportResults(scenario.name, results)
}

const CURRENT_UPDATE_DIGEST_EXCLUSIONS = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'logs',
  '.turbo',
  'apps/api/node_modules',
  'apps/api/dist',
  'apps/api/logs',
  'apps/web/node_modules',
  'apps/web/dist',
  'packages/api-client/node_modules',
  'packages/api-client/dist',
  'packages/shared-config/node_modules',
  'packages/shared-config/dist',
  'packages/shared-types/node_modules',
  'packages/shared-types/dist',
  'packages/ui/node_modules',
  'packages/ui/dist'
] as const
const CURRENT_UPDATE_DIGEST_LIMITS = {
  // A generated full-profile npm lock currently exceeds the fixture-oriented 1 MiB
  // default. Keep the idempotence snapshot bounded while admitting real lockfiles.
  maxEntryBytes: 4 * 1024 * 1024,
  maxAggregateBytes: 32 * 1024 * 1024
} as const

async function runCurrentUpdateScenario(scenario: CurrentUpdateScenario): Promise<boolean> {
  const workspace = join(WORKSPACE, scenario.name)
  const projectDir = join(workspace, scenario.projectName)
  const deadline = scenarioDeadline(scenario.timeoutSeconds)
  const bin = join(CLI_PATH, 'bin', 'sf.js')
  const results: AssertionResult[] = []
  let postgres: PrivatePostgres | undefined
  let artifacts: LifecycleArtifactSink | undefined

  const update = async (args: readonly string[], label: string) => {
    await runSupervisedProcess({
      label,
      executable: process.execPath,
      args: [bin, 'update', ...args],
      cwd: projectDir,
      deadline,
      env: {
        npm_config_loglevel: 'error',
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
        SF_UPDATE_MAILERSEND_API_KEY: 'ms_fixture_runtime_key_00000000000000000000',
        ...(process.env.HOME ? { HOME: process.env.HOME } : {})
      },
      secrets: ['ms_fixture_runtime_key_00000000000000000000'],
      signal: LIFECYCLE_ABORT.signal
    })
  }
  const profileArgs = ['--non-interactive', '--accept-template-updates', '--target-profile', 'full', '--workflow', 'solo'] as const
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

  try {
    mkdirSync(workspace, { recursive: true })
    artifacts = await createLiveArtifactSink(scenario.name, projectDir)
    postgres = await runStep('start isolated postgres for current update', () => startPrivatePostgres({ workspace, deadline, signal: LIFECYCLE_ABORT.signal }))
    await runStep('generate current minimal monorepo through the real CLI', () =>
      runSupervisedProcess({
        label: 'sf new current update base',
        executable: process.execPath,
        args: [
          bin,
          'new',
          '--non-interactive',
          '--project-name',
          scenario.projectName,
          '--project-description',
          'current update lifecycle',
          '--structure',
          scenario.structure,
          '--main-branch',
          'main',
          '--setup-repo',
          'local',
          '--profile',
          'stack',
          '--db-setup',
          'credentials',
          '--db-host',
          '127.0.0.1',
          '--db-port',
          String(postgres!.port),
          '--db-user',
          'sf_lifecycle',
          '--db-password',
          'fixture-only',
          '--db-name',
          'sf_lifecycle',
          '--email-service',
          'none',
          '--s3-setup',
          'manual',
          '--no-analytics',
          '--no-pwa',
          '--no-workflow',
          '--no-srs-enable',
          '--start-services',
          '--start-apps',
          'none'
        ],
        cwd: workspace,
        deadline,
        env: { npm_config_loglevel: 'error', PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1', ...(process.env.HOME ? { HOME: process.env.HOME } : {}) },
        secrets: ['fixture-only'],
        signal: LIFECYCLE_ABORT.signal
      })
    )

    const beforeManifest = JSON.parse(readFileSync(join(projectDir, '.saasfoundry.json'), 'utf8')) as Record<string, unknown> & { ports?: { api?: number; web?: number } }
    const ports = beforeManifest.ports ?? { api: 3500, web: 5173 }
    await runStep('boot current monorepo before update', () =>
      runProductPhase({
        phase: 'before-update',
        projectRoot: projectDir,
        manifest: beforeManifest,
        postgres: postgres!,
        deadline,
        readinessTimeoutMs: scenario.bootTimeoutSeconds * 1_000,
        apiPort: ports.api,
        webPort: ports.web,
        signal: LIFECYCLE_ABORT.signal
      })
    )
    writeFileSync(join(projectDir, 'USER-CANARY.md'), 'current lifecycle user canary\n', { flag: 'wx' })
    await postgres.executeSql("INSERT INTO public.module_types(name, description) VALUES ('SF_CURRENT_UPDATE_CANARY', 'preserve-me');", 'create current update database canary')
    await postgres.executeSql(
      `
        INSERT INTO public.accounts (id, name, updated_at)
        VALUES ('sf-rbac-canary-account', 'RBAC lifecycle canary', NOW());

        INSERT INTO public.roles (name, description, scope, is_system, is_active, account_id, updated_at)
        VALUES ('account-admin', 'Custom role sharing a system-role name', 'ACCOUNT', FALSE, TRUE, 'sf-rbac-canary-account', NOW());

        UPDATE public.roles
        SET is_active = FALSE
        WHERE name = 'platform-user' AND account_id IS NULL AND is_system = TRUE;

        INSERT INTO public.users (id, is_active, email, password, updated_at)
        VALUES ('sf-rbac-canary-user', TRUE, 'rbac-canary@example.test', 'not-used', NOW());

        INSERT INTO public.users_roles_assignments (id, user_id, role_id, updated_at)
        VALUES (
          'sf-rbac-canary-assignment',
          'sf-rbac-canary-user',
          (SELECT id FROM public.roles WHERE name = 'platform-user' AND account_id IS NULL AND is_system = TRUE),
          NOW()
        );

        DELETE FROM public.roles_permissions_links
        WHERE role_id = (
          SELECT id FROM public.roles
          WHERE name = 'platform-user' AND account_id IS NULL AND is_system = TRUE
        )
        AND permission_id = (
          SELECT id FROM public.module_permissions WHERE name = 'PROFILE_UPDATE_OWN'
        );

        DELETE FROM public.roles_sub_modules_links
        WHERE role_id = (
          SELECT id FROM public.roles
          WHERE name = 'platform-user' AND account_id IS NULL AND is_system = TRUE
        )
        AND sub_module_id IN (
          SELECT sub_module.id
          FROM public.sub_modules sub_module
          JOIN public.modules module ON module.id = sub_module.module_id
          WHERE module.name = 'ACCOUNT_ADMINISTRATION'
        );

        DELETE FROM public.roles_modules_links
        WHERE role_id = (
          SELECT id FROM public.roles
          WHERE name = 'platform-user' AND account_id IS NULL AND is_system = TRUE
        )
        AND module_id = (
          SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION'
        );
      `,
      'create current update RBAC preservation canaries'
    )

    await runStep('transition current monorepo to managed full profile', () => update(profileArgs, 'sf update target profile full'))
    await runStep('install late modules through the real update command', () => update(moduleArgs, 'sf update late modules'))

    const afterManifest = JSON.parse(readFileSync(join(projectDir, '.saasfoundry.json'), 'utf8')) as Record<string, unknown>
    const capabilities = await verifyHarnessBrowsers('/workspace')
    await runStep('boot updated monorepo and run full live inventory', () =>
      runProductPhase({
        phase: 'after-update',
        projectRoot: projectDir,
        manifest: afterManifest,
        postgres: postgres!,
        deadline,
        readinessTimeoutMs: scenario.bootTimeoutSeconds * 1_000,
        apiPort: ports.api,
        webPort: ports.web,
        browserCapabilities: capabilities,
        signal: LIFECYCLE_ABORT.signal,
        onReady: (context) =>
          runLiveSuite(context, {
            depth: LIVE_DEPTH,
            runtimeRoot: '/workspace',
            artifacts,
            artifactPaths: liveArtifactPaths('after-update')
          }).then(() => undefined)
      })
    )

    const databaseCanary = await postgres.executeSql("SELECT description FROM public.module_types WHERE name = 'SF_CURRENT_UPDATE_CANARY';", 'verify current update database canary')
    results.push({ passed: databaseCanary.stdout.trim() === 'preserve-me', message: 'OK: current update preserved PostgreSQL state' })
    const firstRbacCanary = await postgres.executeSql(
      `
        SELECT
          (SELECT COUNT(*) FROM public.roles WHERE name = 'account-admin' AND account_id = 'sf-rbac-canary-account' AND is_system = FALSE)
          || '|' ||
          (SELECT is_active::TEXT FROM public.roles WHERE name = 'platform-user' AND account_id IS NULL AND is_system = TRUE)
          || '|' ||
          (SELECT COUNT(*)
           FROM public.roles_permissions_links link
           JOIN public.roles role ON role.id = link.role_id
           JOIN public.module_permissions permission ON permission.id = link.permission_id
           WHERE role.name = 'platform-user' AND role.account_id IS NULL AND role.is_system = TRUE
             AND permission.name = 'PROFILE_UPDATE_OWN')
          || '|' ||
          (SELECT COUNT(*)
           FROM public.roles_modules_links link
           JOIN public.roles role ON role.id = link.role_id
           JOIN public.modules module ON module.id = link.module_id
           WHERE role.name = 'platform-user' AND role.account_id IS NULL AND role.is_system = TRUE
             AND module.name = 'ACCOUNT_ADMINISTRATION')
          || '|' ||
          (SELECT COUNT(*)
           FROM public.roles_sub_modules_links link
           JOIN public.roles role ON role.id = link.role_id
           JOIN public.sub_modules sub_module ON sub_module.id = link.sub_module_id
           JOIN public.modules module ON module.id = sub_module.module_id
           WHERE role.name = 'platform-user' AND role.account_id IS NULL AND role.is_system = TRUE
             AND module.name = 'ACCOUNT_ADMINISTRATION')
          || '|' ||
          (SELECT is_active::TEXT FROM public.users WHERE id = 'sf-rbac-canary-user');
      `,
      'verify RBAC state after first forward update'
    )
    results.push({
      passed: firstRbacCanary.stdout.trim() === '1|false|0|0|0|true',
      message: 'OK: first forward update preserved custom role collision, role/user state and removed grants'
    })
    results.push(assertFileContains(join(projectDir, 'USER-CANARY.md'), 'current lifecycle user canary'))
    results.push(scanForUnreplacedPlaceholders(projectDir))
    results.push(...assertMonorepoBuildOutput(projectDir))
    results.push(...assertMonorepoSharedPackages(projectDir, scenario.projectName))
    results.push(...assertMonorepoEmailSharedTypes(projectDir, scenario.projectName))
    results.push(...assertMonorepoStorageSharedConfig(projectDir, scenario.projectName))
    results.push(...assertMonorepoUiPrimitives(projectDir, scenario.projectName))
    results.push(...assertPwaBuildOutput(join(projectDir, 'apps', 'web')))
    results.push(...(await validateGeneratedApiContract(projectDir, scenario.projectName, { postgres: postgres!, deadline, signal: LIFECYCLE_ABORT.signal })))

    const stableDigest = await canonicalTreeDigest(projectDir, {
      exclude: CURRENT_UPDATE_DIGEST_EXCLUSIONS,
      excludeDirectoryNames: ['node_modules'],
      limits: CURRENT_UPDATE_DIGEST_LIMITS
    })
    await update(profileArgs, 'repeat current target profile update')
    await update(moduleArgs, 'repeat current late module update')
    await runStep('run a second forward database update', () =>
      runSupervisedProcess({
        label: 'repeat db:update:dev',
        executable: 'npm',
        args: ['run', 'db:update:dev'],
        cwd: join(projectDir, 'apps', 'api'),
        deadline,
        env: {
          CI: 'true',
          HUSKY: '0',
          PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: 'yes',
          ...(process.env.HOME ? { HOME: process.env.HOME } : {})
        },
        signal: LIFECYCLE_ABORT.signal
      })
    )
    const secondRbacCanary = await postgres.executeSql(
      `
        SELECT
          (SELECT COUNT(*) FROM public.roles WHERE name = 'account-admin' AND account_id = 'sf-rbac-canary-account' AND is_system = FALSE)
          || '|' ||
          (SELECT is_active::TEXT FROM public.roles WHERE name = 'platform-user' AND account_id IS NULL AND is_system = TRUE)
          || '|' ||
          (SELECT COUNT(*)
           FROM public.roles_permissions_links link
           JOIN public.roles role ON role.id = link.role_id
           JOIN public.module_permissions permission ON permission.id = link.permission_id
           WHERE role.name = 'platform-user' AND role.account_id IS NULL AND role.is_system = TRUE
             AND permission.name = 'PROFILE_UPDATE_OWN')
          || '|' ||
          (SELECT COUNT(*)
           FROM public.roles_modules_links link
           JOIN public.roles role ON role.id = link.role_id
           JOIN public.modules module ON module.id = link.module_id
           WHERE role.name = 'platform-user' AND role.account_id IS NULL AND role.is_system = TRUE
             AND module.name = 'ACCOUNT_ADMINISTRATION')
          || '|' ||
          (SELECT COUNT(*)
           FROM public.roles_sub_modules_links link
           JOIN public.roles role ON role.id = link.role_id
           JOIN public.sub_modules sub_module ON sub_module.id = link.sub_module_id
           JOIN public.modules module ON module.id = sub_module.module_id
           WHERE role.name = 'platform-user' AND role.account_id IS NULL AND role.is_system = TRUE
             AND module.name = 'ACCOUNT_ADMINISTRATION')
          || '|' ||
          (SELECT is_active::TEXT FROM public.users WHERE id = 'sf-rbac-canary-user');
      `,
      'verify RBAC state after repeated forward update'
    )
    results.push({
      passed: secondRbacCanary.stdout.trim() === '1|false|0|0|0|true',
      message: 'OK: repeated forward database update preserved administrator-managed RBAC state'
    })
    const repeatedDigest = await canonicalTreeDigest(projectDir, {
      exclude: CURRENT_UPDATE_DIGEST_EXCLUSIONS,
      excludeDirectoryNames: ['node_modules'],
      limits: CURRENT_UPDATE_DIGEST_LIMITS
    })
    results.push({ passed: stableDigest === repeatedDigest, message: 'OK: repeated current monorepo update is byte-idempotent' })
  } catch (error) {
    results.push({ passed: false, message: `FAIL: ${formatErrorDetails(error)}` })
  } finally {
    if (postgres) {
      try {
        await runStep('teardown current update postgres', () => postgres!.stop())
      } catch (error) {
        results.push({ passed: false, message: `FAIL: current update postgres teardown: ${formatErrorDetails(error)}` })
      }
    }
    if (artifacts) {
      try {
        await artifacts.writeManifest()
      } catch (error) {
        results.push({ passed: false, message: `FAIL: current update artifact manifest: ${formatErrorDetails(error)}` })
      }
    }
  }
  return reportResults(scenario.name, results)
}

// ── Scenario Dispatcher ────────────────────────────────────────

async function runScenario(scenario: TestScenario): Promise<boolean> {
  switch (scenario.type) {
    case 'boot':
      return runBootScenario(scenario)
    case 'previous-release':
      return runPreviousReleaseScenario(scenario)
    case 'current-update':
      return runCurrentUpdateScenario(scenario)
  }
}

// ── Main ───────────────────────────────────────────────────────

async function main() {
  console.log('SaaSFoundryAI Docker Build Tests')
  console.log('==============================')

  // Ensure workspace exists
  mkdirSync(WORKSPACE, { recursive: true })

  // TEST_SCENARIO supports all lifecycle scenarios or an explicit comma-separated list.
  let scenarios: TestScenario[]

  if (SCENARIO_ENV === 'all') {
    scenarios = [...ALL_SCENARIOS]
  } else {
    scenarios = SCENARIO_ENV.split(',')
      .map((s) => s.trim())
      .map(getScenario)
  }

  console.log(`\nRunning ${scenarios.length} scenario(s): ${scenarios.map((s) => s.name).join(', ')}`)

  const results: { name: string; passed: boolean }[] = []

  const abort = (signal: NodeJS.Signals) => LIFECYCLE_ABORT.abort(new Error(`Lifecycle received ${signal}; completing supervised teardown.`))
  const onSigint = () => abort('SIGINT')
  const onSigterm = () => abort('SIGTERM')
  process.once('SIGINT', onSigint)
  process.once('SIGTERM', onSigterm)

  for (const [index, scenario] of scenarios.entries()) {
    if (LIFECYCLE_ABORT.signal.aborted) break
    // [sf-progress] markers are the greppable progress contract for agent
    // harnesses streaming this run (tail -f | grep) — see workflow SKILL.md
    // "ANNOUNCE + STREAM LONG COMMANDS" (#436). Keep the format stable.
    console.log(`[sf-progress] scenario ${index + 1}/${scenarios.length} ${scenario.name} — started`)
    const timing = startLifecycleTiming()
    const deadline = Date.now() + scenario.timeoutSeconds * 1_000
    ACTIVE_SCENARIO_DEADLINE = deadline
    ACTIVE_LIFECYCLE_TIMING = timing
    const budgetTimer = setTimeout(
      () => {
        LIFECYCLE_ABORT.abort(new Error(`Lifecycle scenario ${scenario.name} reached its teardown reserve within the ${scenario.timeoutSeconds}s budget.`))
      },
      Math.max(1, deadline - Date.now() - TEARDOWN_RESERVE_MS)
    )
    try {
      const passed = await runScenario(scenario)
      results.push({ name: scenario.name, passed })
      const status = LIFECYCLE_ABORT.signal.aborted ? 'aborted' : passed ? 'passed' : 'failed'
      await writeLifecycleTiming(scenario.name, LIVE_DEPTH, timing, status, {
        budgetMs: scenario.timeoutSeconds * 1_000,
        teardownReserveMs: TEARDOWN_RESERVE_MS
      })
      console.log(`[sf-progress] scenario ${index + 1}/${scenarios.length} ${scenario.name} — ${passed ? 'passed' : 'failed'}`)
    } catch (error) {
      console.error(`\nScenario "${scenario.name}" crashed:`, error instanceof Error ? error.message : error)
      results.push({ name: scenario.name, passed: false })
      await writeLifecycleTiming(scenario.name, LIVE_DEPTH, timing, LIFECYCLE_ABORT.signal.aborted ? 'aborted' : 'crashed', {
        budgetMs: scenario.timeoutSeconds * 1_000,
        teardownReserveMs: TEARDOWN_RESERVE_MS
      })
      console.log(`[sf-progress] scenario ${index + 1}/${scenarios.length} ${scenario.name} — crashed`)
    } finally {
      clearTimeout(budgetTimer)
      ACTIVE_SCENARIO_DEADLINE = undefined
      ACTIVE_LIFECYCLE_TIMING = undefined
    }
  }

  // Final report
  console.log(`\n${'='.repeat(60)}`)
  console.log('FINAL RESULTS')
  console.log(`${'='.repeat(60)}`)

  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length

  for (const result of results) {
    console.log(`  ${result.passed ? 'PASS' : 'FAIL'} ${result.name}`)
  }

  console.log(`\n${passed} passed, ${failed} failed out of ${results.length} scenarios`)

  if (failed > 0 || LIFECYCLE_ABORT.signal.aborted || results.length !== scenarios.length) {
    if (LIFECYCLE_ABORT.signal.aborted) console.error(`  FAIL lifecycle interrupted: ${formatErrorDetails(LIFECYCLE_ABORT.signal.reason)}`)
    process.exitCode = 1
  }
  process.off('SIGINT', onSigint)
  process.off('SIGTERM', onSigterm)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exitCode = 1
})

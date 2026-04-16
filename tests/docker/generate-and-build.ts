#!/usr/bin/env node
// ── Docker Build Test Harness ──────────────────────────────────
// Generates real SaaSFoundry projects and validates they build.
// Runs inside Docker via `Dockerfile.test`.
//
// Usage:
//   TEST_SCENARIO=multirepo-minimal node --import tsx generate-and-build.ts
//   TEST_SCENARIO=all node --import tsx generate-and-build.ts
//   node --import tsx generate-and-build.ts  # runs all scenarios

import { execSync } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

import {
  assertApiBuildOutput,
  assertClaudeMdConfigured,
  assertMonorepoBuildOutput,
  assertMonorepoSkills,
  assertMultirepoSkills,
  assertWebBuildOutput,
  assertWorkflowSkill,
  AssertionResult,
  reportResults,
  scanForUnreplacedPlaceholders
} from './assertions'
import { ALL_SCENARIOS, getScenario, getTopScenarios, GenerationScenario, UpdateScenario, AIScenario, TestScenario } from './scenarios'

// ── Config ─────────────────────────────────────────────────────

const WORKSPACE = process.env.WORKSPACE_DIR || '/workspace/projects'
const CLI_PATH = process.env.CLI_PATH || '/cli'
const SCENARIO_ENV = process.env.TEST_SCENARIO || 'all'

// ── Shell Helper ───────────────────────────────────────────────

function run(cmd: string, cwd: string, label?: string): void {
  const displayLabel = label || cmd.slice(0, 80)
  console.log(`  > ${displayLabel}`)
  try {
    execSync(cmd, {
      cwd,
      stdio: 'pipe',
      timeout: 300_000, // 5 min per command
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
      includeAnalytics: scenario.includeAnalytics
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
            emailService: scenario.emailService,
            s3Setup: scenario.s3Setup,
            dbSetup: scenario.dbSetup,
            includeAnalytics: scenario.includeAnalytics,
            advancedSkills: []
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
  run('npm install --ignore-scripts', apiPath, 'npm install (API)')
  run('npx prisma generate', apiPath, 'prisma generate')
  run('npx nest build', apiPath, 'nest build')
}

function buildMultirepoWeb(projectDir: string, projectName: string): void {
  const webPath = join(projectDir, 'apps', `${projectName}-web`)
  run('npm install --ignore-scripts', webPath, 'npm install (Web)')
  run('npx tsc -b', webPath, 'tsc -b (Web)')
  run('npx vite build', webPath, 'vite build')
}

function buildMonorepo(projectDir: string): void {
  run('npm install --ignore-scripts', projectDir, 'npm install (monorepo root)')
  run('npx prisma generate', join(projectDir, 'apps', 'api'), 'prisma generate')
  run('npx turbo run build', projectDir, 'turbo run build')
}

// ── Scenario Runners ───────────────────────────────────────────

async function runGenerationScenario(scenario: GenerationScenario): Promise<boolean> {
  console.log(`\nGenerating project: ${scenario.projectName} (${scenario.isMonorepo ? 'monorepo' : 'multirepo'})`)

  const projectDir = await generateProject(scenario)

  console.log(`Building...`)
  if (scenario.isMonorepo) {
    buildMonorepo(projectDir)
  } else {
    buildMultirepoApi(projectDir, scenario.projectName)
    buildMultirepoWeb(projectDir, scenario.projectName)
  }

  // Assertions
  const results: AssertionResult[] = []

  if (scenario.isMonorepo) {
    results.push(...assertMonorepoBuildOutput(projectDir))
  } else {
    results.push(...assertApiBuildOutput(join(projectDir, 'apps', `${scenario.projectName}-api`)))
    results.push(...assertWebBuildOutput(join(projectDir, 'apps', `${scenario.projectName}-web`)))
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
  } else {
    results.push(...assertApiBuildOutput(join(projectDir, 'apps', `${scenario.base.projectName}-api`)))
    results.push(...assertWebBuildOutput(join(projectDir, 'apps', `${scenario.base.projectName}-web`)))
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

// ── Scenario Dispatcher ────────────────────────────────────────

async function runScenario(scenario: TestScenario): Promise<boolean> {
  switch (scenario.type) {
    case 'generation':
      return runGenerationScenario(scenario)
    case 'update':
      return runUpdateScenario(scenario)
    case 'ai':
      return runAIScenario(scenario)
  }
}

// ── Main ───────────────────────────────────────────────────────

async function main() {
  console.log('SaaSFoundry Docker Build Tests')
  console.log('==============================')

  // Ensure workspace exists
  mkdirSync(WORKSPACE, { recursive: true })

  // Determine which scenarios to run
  // TEST_SCENARIO supports: "all", a number (top N by priority), or scenario name(s)
  let scenarios: TestScenario[]
  const countEnv = process.env.TEST_COUNT

  if (SCENARIO_ENV === 'all' && !countEnv) {
    scenarios = ALL_SCENARIOS
  } else if (/^\d+$/.test(SCENARIO_ENV)) {
    scenarios = getTopScenarios(parseInt(SCENARIO_ENV, 10))
  } else if (countEnv && /^\d+$/.test(countEnv)) {
    scenarios = getTopScenarios(parseInt(countEnv, 10))
  } else {
    // Single scenario or comma-separated list
    scenarios = SCENARIO_ENV.split(',')
      .map((s) => s.trim())
      .map(getScenario)
  }

  console.log(`\nRunning ${scenarios.length} scenario(s): ${scenarios.map((s) => s.name).join(', ')}`)

  const results: { name: string; passed: boolean }[] = []

  for (const scenario of scenarios) {
    try {
      const passed = await runScenario(scenario)
      results.push({ name: scenario.name, passed })
    } catch (error) {
      console.error(`\nScenario "${scenario.name}" crashed:`, error instanceof Error ? error.message : error)
      results.push({ name: scenario.name, passed: false })
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

  if (failed > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})

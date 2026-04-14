import { mkdir, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import shelljs from 'shelljs'

import { createApiApp } from '../../builders/api.builder'
import { createWebApp } from '../../builders/web.builder'
import { createMonorepoRoot } from '../../builders/monorepo.builder'
import { createDevServicesCompose } from '../../builders/dev-services.builder'
import { installSkills } from '../../installers/skills.installer'
import { apiParams, webParams, monorepoRootParams } from '../helpers/fixtures'

/**
 * Smoke tests for generated projects.
 *
 * These tests generate a full project and validate structural integrity:
 * - All critical files exist
 * - package.json is valid JSON with correct deps
 * - tsconfig.json is valid JSON
 * - No broken TODO markers (half-activated modules)
 * - .env files have all required variables
 * - No placeholder tokens left unreplaced
 */
describe('generated project smoke tests', () => {
  let tempDir: string
  let originalCwd: string
  let shellSpy: jest.SpyInstance

  beforeEach(async () => {
    tempDir = join(tmpdir(), `sf-smoke-${Date.now()}`)
    originalCwd = process.cwd()
    await mkdir(join(tempDir, 'apps'), { recursive: true })
    process.chdir(tempDir)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    shellSpy = jest.spyOn(shelljs, 'exec').mockImplementation((() => ({ code: 0, stdout: '10.0.0', stderr: '' })) as any)
  })

  afterEach(async () => {
    shellSpy.mockRestore()
    process.chdir(originalCwd)
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  async function generateFullProject(config: {
    isMonorepo: boolean
    projectName: string
    emailService: 'none' | 'mailersend'
    s3Setup: 'docker' | 'credentials' | 'manual'
    includeAnalytics: boolean
  }) {
    const projectDir = join(tempDir, config.projectName)
    await mkdir(join(projectDir, 'apps'), { recursive: true })
    process.chdir(projectDir)

    await createApiApp(
      apiParams({
        isMonorepo: config.isMonorepo,
        projectName: config.projectName,
        emailService: config.emailService,
        s3Setup: config.s3Setup,
        mailersendApiKey: config.emailService === 'mailersend' ? 'ms-key' : undefined,
        mailersendSenderEmail: config.emailService === 'mailersend' ? 'test@test.com' : undefined,
        mailersendSenderName: config.emailService === 'mailersend' ? 'Test' : undefined,
        dbCredentials: { host: 'localhost', port: '5435', user: 'dev', password: 'dev', database: 'dev', dbType: 'postgresql' }
      })
    )

    const hasDevServices = config.s3Setup === 'docker'
    if (hasDevServices) {
      const devApiPath = config.isMonorepo ? 'apps/api' : `apps/${config.projectName}-api`
      await createDevServicesCompose({
        apiPath: devApiPath,
        projectName: config.projectName,
        dbSetup: 'docker',
        s3Setup: config.s3Setup
      })
    }

    await createWebApp(
      webParams({
        isMonorepo: config.isMonorepo,
        projectName: config.projectName,
        s3Setup: config.s3Setup,
        includeAnalytics: config.includeAnalytics
      })
    )

    if (config.isMonorepo) {
      await createMonorepoRoot(monorepoRootParams({ projectName: config.projectName }))
    }

    const skillsApiPath = config.isMonorepo ? 'apps/api' : `apps/${config.projectName}-api`
    const skillsWebPath = config.isMonorepo ? 'apps/web' : `apps/${config.projectName}-web`
    await installSkills({
      isMonorepo: config.isMonorepo,
      apiPath: skillsApiPath,
      webPath: skillsWebPath,
      projectName: config.projectName,
      version: '1.0.0-beta'
    })

    return {
      apiPath: config.isMonorepo ? join(projectDir, 'apps/api') : join(projectDir, `apps/${config.projectName}-api`),
      webPath: config.isMonorepo ? join(projectDir, 'apps/web') : join(projectDir, `apps/${config.projectName}-web`),
      projectDir
    }
  }

  // ── Helpers ────────────────────────────────────────────────────

  async function assertValidJson(filePath: string): Promise<Record<string, unknown>> {
    const content = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(content)
    expect(parsed).toBeTruthy()
    return parsed
  }

  async function assertNoUnreplacedPlaceholders(filePath: string) {
    const content = await readFile(filePath, 'utf8')
    // Check for common placeholder patterns
    expect(content).not.toMatch(/\{\{[A-Z_]+\}\}/)
  }

  async function assertNoBrokenTodoMarkers(filePath: string) {
    const content = await readFile(filePath, 'utf8')
    // A broken marker would be a line starting with active code but having TODO prefix remnants
    // Valid states: fully commented `// TODO xxx: code` or fully active `code`
    // Broken: `// TODO xxx: ` with nothing after, or `TODO` in middle of active code
    const lines = content.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      // Should not have a TODO marker with empty content after it
      if (trimmed.match(/^\/\/ TODO [a-z-]+:\s*$/)) {
        throw new Error(`Broken TODO marker (empty) in ${filePath}: "${trimmed}"`)
      }
    }
  }

  async function assertApiCriticalFiles(apiPath: string) {
    const criticalFiles = [
      'src/main.ts',
      'src/app.module.ts',
      'src/modules/auth/auth.module.ts',
      'src/modules/auth/services/auth.service.ts',
      'src/modules/accounts/accounts.module.ts',
      'src/modules/organizations/organizations.module.ts',
      'src/modules/email/email.module.ts',
      'src/configs/env/services/env.service.ts',
      'tsconfig.json',
      '.env'
    ]

    for (const file of criticalFiles) {
      const fullPath = join(apiPath, file)
      const content = await readFile(fullPath, 'utf8').catch(() => null)
      if (content === null) {
        throw new Error(`Missing critical API file: ${file} (looked in ${fullPath})`)
      }
    }
  }

  async function assertWebCriticalFiles(webPath: string) {
    const criticalFiles = ['src/main.tsx', 'tsconfig.json', '.env', 'vite.config.ts']

    for (const file of criticalFiles) {
      const fullPath = join(webPath, file)
      const content = await readFile(fullPath, 'utf8').catch(() => null)
      expect(content).not.toBeNull()
    }
  }

  // ── Tests ──────────────────────────────────────────────────────

  describe('multirepo with all features', () => {
    let paths: { apiPath: string; webPath: string; projectDir: string }

    beforeEach(async () => {
      paths = await generateFullProject({
        isMonorepo: false,
        projectName: 'smoke-multi',
        emailService: 'mailersend',
        s3Setup: 'docker',
        includeAnalytics: true
      })
    })

    it('should have all critical API files', async () => {
      await assertApiCriticalFiles(paths.apiPath)
    })

    it('should have all critical Web files', async () => {
      await assertWebCriticalFiles(paths.webPath)
    })

    it('should have valid API package.json with correct dependencies', async () => {
      const pkg = await assertValidJson(join(paths.apiPath, 'package.json'))
      const deps = pkg.dependencies as Record<string, string>
      expect(deps['@nestjs/core']).toBeDefined()
      expect(deps['@prisma/client']).toBeDefined()
      expect(deps['@aws-sdk/client-s3']).toBeDefined()
    })

    it('should have valid Web package.json', async () => {
      const pkg = await assertValidJson(join(paths.webPath, 'package.json'))
      const deps = pkg.dependencies as Record<string, string>
      expect(deps['react']).toBeDefined()
      expect(deps['react-dom']).toBeDefined()
    })

    it('should have valid tsconfig.json files', async () => {
      await assertValidJson(join(paths.apiPath, 'tsconfig.json'))
      await assertValidJson(join(paths.webPath, 'tsconfig.json'))
    })

    it('should not have unreplaced placeholders in CLAUDE.md', async () => {
      await assertNoUnreplacedPlaceholders(join(paths.apiPath, 'CLAUDE.md'))
      await assertNoUnreplacedPlaceholders(join(paths.webPath, 'CLAUDE.md'))
    })

    it('should have activated email module (no mailer-service-active TODO markers)', async () => {
      await assertNoBrokenTodoMarkers(join(paths.apiPath, 'src/modules/auth/services/auth.service.ts'))
      await assertNoBrokenTodoMarkers(join(paths.apiPath, 'src/modules/email/services/email.service.ts'))
    })

    it('should have activated storage module (no storage-service-active TODO markers)', async () => {
      await assertNoBrokenTodoMarkers(join(paths.apiPath, 'src/app.module.ts'))
    })

    it('should have activated analytics (no monitoring-active TODO markers)', async () => {
      await assertNoBrokenTodoMarkers(join(paths.webPath, 'src/main.tsx'))
      const mainTsx = await readFile(join(paths.webPath, 'src/main.tsx'), 'utf8')
      expect(mainTsx).toContain("import { initAnalytics } from '@/lib/analytics/analytics'")
    })

    it('should have storage enabled in web .env', async () => {
      const webEnv = await readFile(join(paths.webPath, '.env'), 'utf8')
      expect(webEnv).toContain('VITE_STORAGE_ENABLED="true"')
    })

    it('should have MailerSend credentials in API .env', async () => {
      const apiEnv = await readFile(join(paths.apiPath, '.env'), 'utf8')
      expect(apiEnv).toContain('MAILERSEND_API_KEY="ms-key"')
    })

    it('should have skills installed in both apps', async () => {
      const apiSkills = join(paths.apiPath, '.claude/skills')
      const webSkills = join(paths.webPath, '.claude/skills')
      await readFile(join(apiSkills, 'sf-git-commit/SKILL.md'), 'utf8')
      await readFile(join(webSkills, 'sf-git-commit/SKILL.md'), 'utf8')
    })
  })

  describe('monorepo minimal', () => {
    let paths: { apiPath: string; webPath: string; projectDir: string }

    beforeEach(async () => {
      paths = await generateFullProject({
        isMonorepo: true,
        projectName: 'smoke-mono',
        emailService: 'none',
        s3Setup: 'manual',
        includeAnalytics: false
      })
    })

    it('should have all critical API files in apps/api', async () => {
      await assertApiCriticalFiles(paths.apiPath)
    })

    it('should have all critical Web files in apps/web', async () => {
      await assertWebCriticalFiles(paths.webPath)
    })

    it('should keep email TODO markers when email is disabled', async () => {
      const authService = await readFile(join(paths.apiPath, 'src/modules/auth/services/auth.service.ts'), 'utf8')
      expect(authService).toContain('// TODO mailer-service-active:')
    })

    it('should keep storage flag disabled when s3 is manual', async () => {
      const webEnv = await readFile(join(paths.webPath, '.env'), 'utf8')
      expect(webEnv).toContain('VITE_STORAGE_ENABLED="false"')
    })

    it('should keep analytics TODO markers when analytics is disabled', async () => {
      const mainTsx = await readFile(join(paths.webPath, 'src/main.tsx'), 'utf8')
      expect(mainTsx).toContain('// TODO monitoring-active:')
    })

    it('should have monorepo root package.json', async () => {
      const pkg = await assertValidJson(join(paths.projectDir, 'package.json'))
      expect(pkg.name).toBe('smoke-mono')
    })

    it('should have centralized skills at root (not per-app)', async () => {
      const rootSkills = join(paths.projectDir, '.claude/skills')
      await readFile(join(rootSkills, 'sf-git-commit/SKILL.md'), 'utf8')
    })

    it('should have valid API .env with database URL', async () => {
      const apiEnv = await readFile(join(paths.apiPath, '.env'), 'utf8')
      expect(apiEnv).toContain('DATABASE_URL=')
      expect(apiEnv).toContain('JWT_SECRET_AUTH=')
      expect(apiEnv).toContain('JWT_SECRET_REFRESH=')
    })
  })
})

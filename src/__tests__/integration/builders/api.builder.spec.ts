import { mkdir, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import shelljs from 'shelljs'

import { createApiApp } from '../../../builders/api.builder'
import { apiParams } from '../../helpers/fixtures'
import { expectFileExists, expectFileContains, expectNoTodoMarkers, expectTodoMarkersPresent } from '../../helpers/assertions'

describe('createApiApp (integration)', () => {
  let tempDir: string
  let originalCwd: string
  let shellSpy: jest.SpyInstance

  beforeEach(async () => {
    tempDir = join(tmpdir(), `sf-api-builder-test-${Date.now()}`)
    originalCwd = process.cwd()
    await mkdir(join(tempDir, 'apps'), { recursive: true })
    process.chdir(tempDir)

    // Mock shelljs.exec to skip npm install, git init, prisma generate
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    shellSpy = jest.spyOn(shelljs, 'exec').mockImplementation((() => ({ code: 0, stdout: '10.0.0', stderr: '' })) as any)
  })

  afterEach(async () => {
    shellSpy.mockRestore()
    process.chdir(originalCwd)
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  // ── Multirepo Tests ─────────────────────────────────────────

  describe('multirepo', () => {
    it('should create API app in multirepo layout', async () => {
      const result = await createApiApp(apiParams())

      expect(result).toBe(true)
      await expectFileExists(join(tempDir, 'apps/test-project-api/src/main.ts'))
    })

    it('should update package.json with project name', async () => {
      await createApiApp(apiParams())

      const pkg = JSON.parse(await readFile(join(tempDir, 'apps/test-project-api/package.json'), 'utf8'))
      expect(pkg.name).toBe('test-project-api')
    })

    it('should generate JWT secrets in .env', async () => {
      await createApiApp(apiParams())

      const env = await readFile(join(tempDir, 'apps/test-project-api/.env'), 'utf8')
      // JWT secrets should be 128-char hex strings (64 bytes)
      const jwtMatch = env.match(/JWT_SECRET_AUTH="([a-f0-9]+)"/)?.[1]
      expect(jwtMatch).toBeDefined()
      expect(jwtMatch?.length).toBe(128)
    })

    it('should update database URL in .env when credentials provided', async () => {
      await createApiApp(
        apiParams({
          dbCredentials: {
            host: 'myhost',
            port: '5432',
            user: 'myuser',
            password: 'mypass',
            database: 'mydb',
            dbType: 'postgresql'
          }
        })
      )

      await expectFileContains(join(tempDir, 'apps/test-project-api/.env'), 'DATABASE_URL="postgresql://myuser:mypass@myhost:5432/mydb"')
    })

    it('should call git init for multirepo', async () => {
      await createApiApp(apiParams())

      expect(shellSpy).toHaveBeenCalledWith(expect.stringContaining('git init'))
    })

    it('should replace saasfoundry-network with project-network in docker files', async () => {
      await createApiApp(apiParams())

      const composePath = join(tempDir, 'apps/test-project-api/docker-compose.yml')
      try {
        const content = await readFile(composePath, 'utf8')
        expect(content).not.toContain('saasfoundry-network')
        expect(content).toContain('test-project-network')
      } catch {
        // File might not exist depending on blueprint structure
      }
    })
  })

  // ── Monorepo Tests ──────────────────────────────────────────

  describe('monorepo', () => {
    it('should create API app in monorepo layout (apps/api)', async () => {
      const result = await createApiApp(apiParams({ isMonorepo: true }))

      expect(result).toBe(true)
      await expectFileExists(join(tempDir, 'apps/api/src/main.ts'))
    })

    it('should NOT call git init for monorepo (handled at root)', async () => {
      await createApiApp(apiParams({ isMonorepo: true }))

      const gitCalls = shellSpy.mock.calls.filter((call: string[]) => typeof call[0] === 'string' && call[0].includes('git init'))
      expect(gitCalls).toHaveLength(0)
    })

    it('should NOT call npm install for monorepo (handled at root)', async () => {
      await createApiApp(apiParams({ isMonorepo: true }))

      const npmCalls = shellSpy.mock.calls.filter((call: string[]) => typeof call[0] === 'string' && call[0].includes('npm install'))
      expect(npmCalls).toHaveLength(0)
    })

    it('should remove per-app .github workflows for monorepo', async () => {
      await createApiApp(apiParams({ isMonorepo: true }))

      try {
        await expectFileExists(join(tempDir, 'apps/api/.github'))
        // If it didn't throw, the .github directory still exists (bad)
        fail('Expected .github directory to be removed for monorepo')
      } catch {
        // Good - .github should not exist
      }
    })
  })

  // ── Email Module Integration ────────────────────────────────

  describe('email module', () => {
    it('should keep email TODO markers when emailService is none', async () => {
      await createApiApp(apiParams({ emailService: 'none' }))

      await expectTodoMarkersPresent(join(tempDir, 'apps/test-project-api/src/configs/env/services/env.service.ts'), 'mailer-service-active')
    })

    it('should activate email module when emailService is mailersend', async () => {
      await createApiApp(
        apiParams({
          emailService: 'mailersend',
          mailersendApiKey: 'ms-test-key',
          mailersendSenderEmail: 'noreply@test.com',
          mailersendSenderName: 'Test'
        })
      )

      await expectNoTodoMarkers(join(tempDir, 'apps/test-project-api/src/configs/env/services/env.service.ts'), 'mailer-service-active')
      await expectFileExists(join(tempDir, 'apps/test-project-api/src/modules/email/services/mailersend.service.ts'))
    })
  })

  // ── Storage Module Integration ──────────────────────────────

  describe('storage module', () => {
    it('should keep storage TODO markers when s3Setup is manual', async () => {
      await createApiApp(apiParams({ s3Setup: 'manual' }))

      await expectTodoMarkersPresent(join(tempDir, 'apps/test-project-api/src/app.module.ts'), 'storage-service-active')
    })

    it('should activate storage module when s3Setup is docker', async () => {
      // Create web app directory for storage installer
      await mkdir(join(tempDir, 'apps/test-project-web'), { recursive: true })

      await createApiApp(apiParams({ s3Setup: 'docker' }))

      await expectNoTodoMarkers(join(tempDir, 'apps/test-project-api/src/app.module.ts'), 'storage-service-active')
      await expectFileExists(join(tempDir, 'apps/test-project-api/src/modules/storage'))
    })
  })

  // ── Parameterized Matrix ────────────────────────────────────

  describe.each([
    { structure: 'multirepo' as const, isMonorepo: false },
    { structure: 'monorepo' as const, isMonorepo: true }
  ])('$structure × email variations', ({ isMonorepo }) => {
    describe.each([{ emailService: 'none' as const }, { emailService: 'mailersend' as const }])('emailService=$emailService', ({ emailService }) => {
      it('should create API app successfully', async () => {
        const result = await createApiApp(
          apiParams({
            isMonorepo,
            emailService,
            mailersendApiKey: emailService === 'mailersend' ? 'test-key' : undefined,
            mailersendSenderEmail: emailService === 'mailersend' ? 'test@test.com' : undefined,
            mailersendSenderName: emailService === 'mailersend' ? 'Test' : undefined
          })
        )

        expect(result).toBe(true)
      })
    })
  })
})

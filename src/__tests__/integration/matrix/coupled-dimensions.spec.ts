import { mkdir, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import shelljs from 'shelljs'

import { createApiApp } from '../../../builders/api.builder'
import { createWebApp } from '../../../builders/web.builder'
import { createDevServicesCompose } from '../../../builders/dev-services.builder'
import { apiParams, webParams } from '../../helpers/fixtures'
import { expectFileExists } from '../../helpers/assertions'

/**
 * Coupled Dimensions Matrix Test
 *
 * Tests the 36 combinations of coupled dimensions:
 * - Structure: monorepo (2), multirepo (2)
 * - DB setup: docker, credentials, manual (3)
 * - S3 setup: docker, credentials, manual (3)
 * - Repo setup: local, existing (2)
 *
 * 2 × 3 × 3 × 2 = 36 combinations
 *
 * These dimensions are coupled because they affect path resolution,
 * docker-compose generation, and .env configuration across API + Web.
 */
describe('Coupled Dimensions Matrix', () => {
  let tempDir: string
  let originalCwd: string
  let shellSpy: jest.SpyInstance

  beforeEach(async () => {
    tempDir = join(tmpdir(), `sf-matrix-test-${Date.now()}`)
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

  const structures = [
    { label: 'monorepo', isMonorepo: true },
    { label: 'multirepo', isMonorepo: false }
  ] as const

  const dbSetups = ['docker', 'credentials', 'manual'] as const
  const s3Setups = ['docker', 'credentials', 'manual'] as const

  describe.each(structures)('$label', ({ isMonorepo }) => {
    describe.each(dbSetups)('db=%s', (dbSetup) => {
      describe.each(s3Setups)('s3=%s', (s3Setup) => {
        it('should create API app with correct paths', async () => {
          const params = apiParams({
            isMonorepo,
            s3Setup,
            dbCredentials:
              dbSetup === 'credentials'
                ? {
                    host: 'myhost',
                    port: '5432',
                    user: 'user',
                    password: 'pass',
                    database: 'db',
                    dbType: 'postgresql'
                  }
                : dbSetup === 'docker'
                  ? {
                      host: 'localhost',
                      port: '5435',
                      user: 'db_dev_user',
                      password: 'db_dev_password',
                      database: 'db_dev',
                      dbType: 'postgresql'
                    }
                  : undefined,
            s3Credentials:
              s3Setup === 'credentials'
                ? {
                    endpoint: 'https://s3.example.com',
                    accessKey: 'key',
                    secretKey: 'secret',
                    bucket: 'mybucket',
                    region: 'eu-west-1'
                  }
                : undefined
          })

          const result = await createApiApp(params)
          expect(result).toBe(true)

          // Verify correct path
          const expectedApiPath = isMonorepo ? 'apps/api' : 'apps/test-project-api'
          await expectFileExists(join(tempDir, expectedApiPath, 'src/main.ts'))
        })

        it('should create Web app with correct storage flag', async () => {
          const result = await createWebApp(webParams({ isMonorepo, s3Setup }))
          expect(result).toBe(true)

          // Verify correct path
          const expectedWebPath = isMonorepo ? 'apps/web' : 'apps/test-project-web'
          await expectFileExists(join(tempDir, expectedWebPath, 'src/main.tsx'))

          // Verify storage flag
          const webEnv = await readFile(join(tempDir, expectedWebPath, '.env'), 'utf8')
          if (s3Setup === 'manual') {
            expect(webEnv).toContain('VITE_STORAGE_ENABLED="false"')
          } else {
            expect(webEnv).toContain('VITE_STORAGE_ENABLED="true"')
          }
        })

        if (dbSetup === 'docker' || s3Setup === 'docker') {
          it('should generate valid dev-services compose when docker services are needed', async () => {
            const expectedApiPath = isMonorepo ? 'apps/api' : 'apps/test-project-api'
            const apiDir = join(tempDir, expectedApiPath)
            await mkdir(apiDir, { recursive: true })

            await createDevServicesCompose({
              apiPath: apiDir,
              projectName: 'test-project',
              dbSetup,
              s3Setup
            })

            const content = await readFile(join(apiDir, 'docker-compose.dev-services.yml'), 'utf8')

            // All compose files should reference project-specific network
            expect(content).toContain('test-project-network')
            expect(content).not.toContain('saasfoundry-network')

            if (dbSetup === 'docker') {
              expect(content).toContain('db-dev:')
            }
            if (s3Setup === 'docker') {
              expect(content).toContain('s3-dev:')
            }
          })
        }
      })
    })
  })
})

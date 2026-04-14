import { mkdir, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import yaml from 'js-yaml'

import { createDevServicesCompose } from '../../../builders/dev-services.builder'

/**
 * Real file output integration tests for dev-services builder.
 * Unlike the unit test in unit/builders/, this tests the full template pipeline
 * with actual YAML validation.
 */
describe('createDevServicesCompose (integration - real file output)', () => {
  let tempDir: string
  let apiPath: string

  beforeEach(async () => {
    tempDir = join(tmpdir(), `sf-dev-services-integ-${Date.now()}`)
    apiPath = join(tempDir, 'apps/test-project-api')
    await mkdir(apiPath, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  // ── DB × S3 Matrix ─────────────────────────────────────────

  describe.each([
    { dbSetup: 'docker' as const, s3Setup: 'docker' as const, expectDb: true, expectS3: true },
    { dbSetup: 'docker' as const, s3Setup: 'manual' as const, expectDb: true, expectS3: false },
    { dbSetup: 'manual' as const, s3Setup: 'docker' as const, expectDb: false, expectS3: true },
    { dbSetup: 'docker' as const, s3Setup: 'credentials' as const, expectDb: true, expectS3: false }
  ])('dbSetup=$dbSetup, s3Setup=$s3Setup', ({ dbSetup, s3Setup, expectDb, expectS3 }) => {
    it(`should produce valid YAML with ${expectDb ? 'DB' : 'no DB'} and ${expectS3 ? 'S3' : 'no S3'}`, async () => {
      await createDevServicesCompose({
        apiPath,
        projectName: 'test-project',
        dbSetup,
        s3Setup
      })

      const content = await readFile(join(apiPath, 'docker-compose.dev-services.yml'), 'utf8')

      // Must be valid YAML
      const parsed = yaml.load(content) as Record<string, unknown>
      expect(parsed).toBeTruthy()

      // Verify expected services
      if (expectDb) {
        expect(content).toContain('db-dev:')
      } else {
        expect(content).not.toContain('db-dev:')
      }

      if (expectS3) {
        expect(content).toContain('s3-dev:')
        expect(content).toContain('s3-init:')
      } else {
        expect(content).not.toContain('s3-dev:')
      }

      // Network should always reference project name
      expect(content).toContain('test-project-network')
      expect(content).not.toContain('saasfoundry-network')
    })
  })
})

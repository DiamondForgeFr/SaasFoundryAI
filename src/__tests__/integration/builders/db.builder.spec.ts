import { mkdir, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { createDbApp } from '../../../builders/db.builder'
import { expectFileExists, expectFileContains, expectFileNotContains } from '../../helpers/assertions'

describe('createDbApp (integration)', () => {
  let tempDir: string
  let originalCwd: string

  beforeEach(async () => {
    tempDir = join(tmpdir(), `sf-db-builder-integ-${Date.now()}`)
    originalCwd = process.cwd()
    await mkdir(join(tempDir, 'apps'), { recursive: true })
    process.chdir(tempDir)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  // ── Monorepo Path ─────────────────────────────────────────

  it('should create DB app at apps/db for monorepo', async () => {
    const result = await createDbApp({
      isMonorepo: true,
      projectName: 'test-project'
    })

    expect(result).toBe(true)
    await expectFileExists(join(tempDir, 'apps/db/docker-compose.db.yml'))
  })

  // ── Multirepo Path ────────────────────────────────────────

  it('should create DB app at apps/{name}-db for multirepo', async () => {
    const result = await createDbApp({
      isMonorepo: false,
      projectName: 'test-project'
    })

    expect(result).toBe(true)
    await expectFileExists(join(tempDir, 'apps/test-project-db/docker-compose.db.yml'))
  })

  // ── Default Credentials ───────────────────────────────────

  it('should use default credentials when none provided', async () => {
    await createDbApp({
      isMonorepo: false,
      projectName: 'test-project'
    })

    const composePath = join(tempDir, 'apps/test-project-db/docker-compose.db.yml')
    await expectFileContains(composePath, 'POSTGRES_USER: db_dev_user')
    await expectFileContains(composePath, 'POSTGRES_PASSWORD: db_dev_password')
    await expectFileContains(composePath, 'POSTGRES_DB: db_dev')
  })

  // ── Custom Credentials ────────────────────────────────────

  it('should replace values with custom credentials', async () => {
    await createDbApp({
      isMonorepo: false,
      projectName: 'my-app',
      dbCredentials: {
        host: 'localhost',
        port: '5435',
        user: 'custom_user',
        password: 'custom_pass',
        database: 'custom_db',
        dbType: 'postgresql'
      }
    })

    const composePath = join(tempDir, 'apps/my-app-db/docker-compose.db.yml')
    await expectFileContains(composePath, 'POSTGRES_USER: custom_user')
    await expectFileContains(composePath, 'POSTGRES_PASSWORD: custom_pass')
    await expectFileContains(composePath, 'POSTGRES_DB: custom_db')
    await expectFileContains(composePath, 'pg_isready -U custom_user -d custom_db')
  })

  // ── Network Name ──────────────────────────────────────────

  it('should replace saasfoundry-network with project network name', async () => {
    await createDbApp({
      isMonorepo: false,
      projectName: 'my-app'
    })

    const composePath = join(tempDir, 'apps/my-app-db/docker-compose.db.yml')
    await expectFileContains(composePath, 'my-app-network')
    await expectFileNotContains(composePath, 'saasfoundry-network')
  })

  // ── Container Name ────────────────────────────────────────

  it('should set container_name with project name', async () => {
    await createDbApp({
      isMonorepo: false,
      projectName: 'my-app'
    })

    const composePath = join(tempDir, 'apps/my-app-db/docker-compose.db.yml')
    await expectFileContains(composePath, 'container_name: my-app-db-dev')
  })

  // ── Healthcheck ───────────────────────────────────────────

  it('should update healthcheck with correct user and database', async () => {
    await createDbApp({
      isMonorepo: false,
      projectName: 'test-project',
      dbCredentials: {
        host: 'localhost',
        port: '5435',
        user: 'health_user',
        password: 'health_pass',
        database: 'health_db',
        dbType: 'postgresql'
      }
    })

    const composePath = join(tempDir, 'apps/test-project-db/docker-compose.db.yml')
    const content = await readFile(composePath, 'utf8')
    expect(content).toContain('pg_isready -U health_user -d health_db')
  })

  // ── Valid YAML Output ─────────────────────────────────────

  it('should produce valid YAML', async () => {
    const yaml = require('js-yaml')

    await createDbApp({
      isMonorepo: false,
      projectName: 'test-project'
    })

    const composePath = join(tempDir, 'apps/test-project-db/docker-compose.db.yml')
    const content = await readFile(composePath, 'utf8')
    const parsed = yaml.load(content) as Record<string, unknown>
    expect(parsed).toBeTruthy()
    expect(parsed).toHaveProperty('services')
  })
})

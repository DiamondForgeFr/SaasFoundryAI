import { mkdir, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { createS3App } from '../../../builders/s3.builder'
import { expectFileExists, expectFileContains, expectFileNotContains } from '../../helpers/assertions'

describe('createS3App (integration)', () => {
  let tempDir: string
  let originalCwd: string

  beforeEach(async () => {
    tempDir = join(tmpdir(), `sf-s3-builder-integ-${Date.now()}`)
    originalCwd = process.cwd()
    await mkdir(join(tempDir, 'apps'), { recursive: true })
    process.chdir(tempDir)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  // ── Monorepo Path ─────────────────────────────────────────

  it('should create S3 app at apps/s3 for monorepo', async () => {
    const result = await createS3App({
      isMonorepo: true,
      projectName: 'test-project'
    })

    expect(result).toBe(true)
    await expectFileExists(join(tempDir, 'apps/s3/docker-compose.s3.yml'))
  })

  // ── Multirepo Path ────────────────────────────────────────

  it('should create S3 app at apps/{name}-s3 for multirepo', async () => {
    const result = await createS3App({
      isMonorepo: false,
      projectName: 'test-project'
    })

    expect(result).toBe(true)
    await expectFileExists(join(tempDir, 'apps/test-project-s3/docker-compose.s3.yml'))
  })

  // ── Default Credentials ───────────────────────────────────

  it('should use default credentials when none provided', async () => {
    await createS3App({
      isMonorepo: false,
      projectName: 'test-project'
    })

    const composePath = join(tempDir, 'apps/test-project-s3/docker-compose.s3.yml')
    await expectFileContains(composePath, 'MINIO_ROOT_USER: minioadmin')
    await expectFileContains(composePath, 'MINIO_ROOT_PASSWORD: minioadmin')
  })

  // ── Default Bucket Name ───────────────────────────────────

  it('should use project-name-uploads as default bucket name', async () => {
    await createS3App({
      isMonorepo: false,
      projectName: 'my-app'
    })

    const composePath = join(tempDir, 'apps/my-app-s3/docker-compose.s3.yml')
    await expectFileContains(composePath, 'myminio/my-app-uploads')
  })

  // ── Custom Credentials ────────────────────────────────────

  it('should replace values with custom credentials', async () => {
    await createS3App({
      isMonorepo: false,
      projectName: 'my-app',
      s3Credentials: {
        endpoint: 'https://s3.amazonaws.com',
        accessKey: 'AKIAIOSFODNN7EXAMPLE',
        secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        bucket: 'custom-bucket',
        region: 'eu-west-1'
      }
    })

    const composePath = join(tempDir, 'apps/my-app-s3/docker-compose.s3.yml')
    await expectFileContains(composePath, 'MINIO_ROOT_USER: AKIAIOSFODNN7EXAMPLE')
    await expectFileContains(composePath, 'MINIO_ROOT_PASSWORD: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')
    await expectFileContains(composePath, 'myminio/custom-bucket')
  })

  // ── S3 Init Script Credentials ────────────────────────────

  it('should update mc alias set command with custom credentials', async () => {
    await createS3App({
      isMonorepo: false,
      projectName: 'my-app',
      s3Credentials: {
        endpoint: 'https://s3.amazonaws.com',
        accessKey: 'CUSTOM_KEY',
        secretKey: 'CUSTOM_SECRET',
        bucket: 'my-bucket',
        region: 'us-west-2'
      }
    })

    const composePath = join(tempDir, 'apps/my-app-s3/docker-compose.s3.yml')
    const content = await readFile(composePath, 'utf8')
    expect(content).toContain('myminio http://s3-dev:9000 CUSTOM_KEY CUSTOM_SECRET')
  })

  // ── Network Name ──────────────────────────────────────────

  it('should replace saasfoundry-network with project network name', async () => {
    await createS3App({
      isMonorepo: false,
      projectName: 'my-app'
    })

    const composePath = join(tempDir, 'apps/my-app-s3/docker-compose.s3.yml')
    await expectFileContains(composePath, 'my-app-network')
    await expectFileNotContains(composePath, 'saasfoundry-network')
  })

  // ── Container Name ────────────────────────────────────────

  it('should set container_name with project name', async () => {
    await createS3App({
      isMonorepo: false,
      projectName: 'my-app'
    })

    const composePath = join(tempDir, 'apps/my-app-s3/docker-compose.s3.yml')
    await expectFileContains(composePath, 'container_name: my-app-s3-dev')
  })

  // ── Valid YAML Output ─────────────────────────────────────

  it('should produce valid YAML', async () => {
    const yaml = require('js-yaml')

    await createS3App({
      isMonorepo: false,
      projectName: 'test-project'
    })

    const composePath = join(tempDir, 'apps/test-project-s3/docker-compose.s3.yml')
    const content = await readFile(composePath, 'utf8')
    const parsed = yaml.load(content) as Record<string, unknown>
    expect(parsed).toBeTruthy()
    expect(parsed).toHaveProperty('services')
  })
})

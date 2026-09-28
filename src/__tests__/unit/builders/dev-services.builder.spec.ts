import { mkdir, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import yaml from 'js-yaml'

import { createDevServicesCompose } from '../../../builders/dev-services.builder'

describe('createDevServicesCompose', () => {
  let tempDir: string
  let apiPath: string

  beforeEach(async () => {
    tempDir = join(tmpdir(), `sf-dev-services-test-${Date.now()}`)
    apiPath = join(tempDir, 'apps/test-project-api')
    await mkdir(apiPath, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  it('should generate a compose file with DB service only', async () => {
    const result = await createDevServicesCompose({
      apiPath,
      projectName: 'test-project',
      dbSetup: 'docker',
      s3Setup: 'manual'
    })

    expect(result).toBe(true)

    const content = await readFile(join(apiPath, 'docker-compose.dev-services.yml'), 'utf8')

    // Valid YAML
    expect(() => yaml.load(content)).not.toThrow()

    // Contains DB service
    expect(content).toContain('db-dev:')
    expect(content).toContain('test-project-db-dev')
    expect(content).toContain('postgres:16-alpine')

    // Does NOT contain S3 service
    expect(content).not.toContain('s3-dev:')
    expect(content).not.toContain('minio')

    // Correct network name
    expect(content).toContain('test-project-network')
    expect(content).not.toContain('saasfoundry-network')

    // Has volumes section
    expect(content).toContain('db-dev-data')
  })

  it('should generate a compose file with S3 service only', async () => {
    const result = await createDevServicesCompose({
      apiPath,
      projectName: 'test-project',
      dbSetup: 'manual',
      s3Setup: 'docker'
    })

    expect(result).toBe(true)

    const content = await readFile(join(apiPath, 'docker-compose.dev-services.yml'), 'utf8')

    // Valid YAML
    expect(() => yaml.load(content)).not.toThrow()

    // Contains S3 service
    expect(content).toContain('s3-dev:')
    expect(content).toContain('minio/minio')
    expect(content).toContain('s3-init:')

    // Does NOT contain DB service
    expect(content).not.toContain('db-dev:')
    expect(content).not.toContain('postgres')

    // Correct network name
    expect(content).toContain('test-project-network')

    // Has S3 volume
    expect(content).toContain('s3-dev-data')
  })

  it('should generate a compose file with both DB and S3 services', async () => {
    const result = await createDevServicesCompose({
      apiPath,
      projectName: 'test-project',
      dbSetup: 'docker',
      s3Setup: 'docker'
    })

    expect(result).toBe(true)

    const content = await readFile(join(apiPath, 'docker-compose.dev-services.yml'), 'utf8')

    // Valid YAML
    expect(() => yaml.load(content)).not.toThrow()

    // Both services present
    expect(content).toContain('db-dev:')
    expect(content).toContain('s3-dev:')
    expect(content).toContain('s3-init:')

    // Both volumes
    expect(content).toContain('db-dev-data')
    expect(content).toContain('s3-dev-data')
  })

  it('should use custom DB credentials', async () => {
    await createDevServicesCompose({
      apiPath,
      projectName: 'test-project',
      dbSetup: 'docker',
      dbCredentials: {
        host: 'localhost',
        port: '5435',
        user: 'myuser',
        password: 'mypass',
        database: 'mydb',
        dbType: 'postgresql'
      },
      s3Setup: 'manual'
    })

    const content = await readFile(join(apiPath, 'docker-compose.dev-services.yml'), 'utf8')

    expect(content).toContain('POSTGRES_USER: myuser')
    expect(content).toContain('POSTGRES_PASSWORD: mypass')
    expect(content).toContain('POSTGRES_DB: mydb')
    expect(content).toContain('pg_isready -U myuser -d mydb')
  })

  it('should use custom S3 credentials', async () => {
    await createDevServicesCompose({
      apiPath,
      projectName: 'test-project',
      dbSetup: 'manual',
      s3Setup: 'docker',
      s3Credentials: {
        endpoint: 'http://localhost:9000',
        accessKey: 'myaccesskey',
        secretKey: 'mysecretkey',
        bucket: 'mybucket',
        region: 'us-east-1'
      }
    })

    const content = await readFile(join(apiPath, 'docker-compose.dev-services.yml'), 'utf8')

    expect(content).toContain('MINIO_ROOT_USER: myaccesskey')
    expect(content).toContain('MINIO_ROOT_PASSWORD: mysecretkey')
    expect(content).toContain('myminio/mybucket')
  })

  it('should use project name in compose "name" field', async () => {
    await createDevServicesCompose({
      apiPath,
      projectName: 'my-app',
      dbSetup: 'docker',
      s3Setup: 'manual'
    })

    const content = await readFile(join(apiPath, 'docker-compose.dev-services.yml'), 'utf8')

    expect(content).toMatch(/^name: my-app$/m)
  })
})

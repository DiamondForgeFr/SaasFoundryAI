import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDevServicesCompose } from '../../../builders/dev-services.builder'

/**
 * #583 — `--db-port 5444` wrote 5444 into the API's .env and published 5435 in the compose.
 *
 * `createDevServicesCompose` destructured `{ user, password, database }` from the
 * credentials and substituted container_name, POSTGRES_*, the healthcheck and the network.
 * It never touched `ports:`, so the template's '5435:5432' went through untouched and the
 * generated project dialled a port nothing listened on. It started clean and nothing
 * worked — the same shape as #510, a flag parsed and then dropped.
 */

describe('the compose publishes the port the project was given (#583)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sf-compose-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const compose = (): string => readFileSync(join(dir, 'docker-compose.dev-services.yml'), 'utf8')

  const build = async (port?: string): Promise<void> => {
    await createDevServicesCompose({
      apiPath: dir,
      projectName: 'demo',
      dbSetup: 'docker',
      dbCredentials: { user: 'u', password: 'p', database: 'd', ...(port ? { port } : {}) },
      s3Setup: 'manual'
    } as Parameters<typeof createDevServicesCompose>[0])
  }

  it('publishes the requested port', async () => {
    await build('5444')
    expect(compose()).toContain("'5444:5432'")
    expect(compose()).not.toContain("'5435:5432'")
  })

  it('keeps 5435 when nothing was asked for', async () => {
    await build()
    expect(compose()).toContain("'5435:5432'")
  })

  it('moves only the host side — 5432 is postgres inside its own container', async () => {
    await build('5444')
    expect(compose()).toContain(':5432')
    expect(compose()).not.toContain("'5444:5444'")
  })

  it('still substitutes everything it substituted before', async () => {
    await build('5444')
    const yml = compose()
    expect(yml).toContain('demo-db-dev')
    expect(yml).toContain('POSTGRES_USER: u')
    expect(yml).toContain('POSTGRES_DB: d')
    expect(yml).toContain('demo-network')
  })
})

/**
 * #623 — the db block above has rewritten its host port since #583. The S3 block never did,
 * so `9000:9000` and `9001:9001` went through from the template verbatim and a machine
 * already running another MinIO got a container that could not bind.
 */
describe('the compose publishes the storage ports the project was given (#623)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sf-compose-s3-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const compose = (): string => readFileSync(join(dir, 'docker-compose.dev-services.yml'), 'utf8')

  const buildS3 = async (s3Ports?: { api?: number; console?: number }): Promise<void> => {
    await createDevServicesCompose({
      apiPath: dir,
      projectName: 'port-check',
      dbSetup: 'manual',
      s3Setup: 'docker',
      s3Credentials: { accessKey: 'k', secretKey: 's', bucket: 'b', endpoint: '', region: 'us-east-1' },
      s3Ports
    })
  }

  it('publishes the resolved ports on the host side', async () => {
    await buildS3({ api: 9002, console: 9003 })
    expect(compose()).toContain("- '9002:9000'")
    expect(compose()).toContain("- '9003:9001'")
  })

  it('never moves the container side — 9000 and 9001 are MinIO’s own, and s3-init dials them over the network', async () => {
    await buildS3({ api: 9002, console: 9003 })
    expect(compose()).toContain('http://s3-dev:9000')
    expect(compose()).not.toContain("- '9002:9002'")
  })

  it('falls back to the defaults when no port was resolved, which is what older projects run', async () => {
    await buildS3(undefined)
    expect(compose()).toContain("- '9000:9000'")
    expect(compose()).toContain("- '9001:9001'")
  })
})

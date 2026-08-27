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

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'

import { createDevServicesCompose, ensureMailCatcherService, insertMailCatcherService, MAIL_CATCHER_SERVICE } from '../../../builders/dev-services.builder'

/**
 * #976 — a generated project could not complete a signup or an invitation locally: the dev
 * services started Postgres and MinIO and nothing that could read an email. The email module now
 * brings Mailpit, in the same compose file, whether or not the database or the storage run there.
 */

type Compose = {
  services: Record<string, { image?: string; container_name?: string; ports?: string[]; healthcheck?: { test: string[] }; networks?: string[] }>
  volumes?: Record<string, unknown>
  networks: Record<string, unknown>
}

describe('the dev-services compose carries the mail catcher (#976)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sf-compose-mail-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const file = (): string => join(dir, 'docker-compose.dev-services.yml')
  const compose = (): string => readFileSync(file(), 'utf8')
  const parsed = (): Compose => yaml.load(compose()) as Compose

  const build = (options: Partial<Parameters<typeof createDevServicesCompose>[0]> = {}) =>
    createDevServicesCompose({ apiPath: dir, projectName: 'demo', dbSetup: 'manual', s3Setup: 'manual', ...options })

  it('creates a file with the catcher alone when neither the database nor the storage runs in Docker', async () => {
    await build({ mailCatcher: { port: 8025 } })

    const { services, volumes, networks } = parsed()
    expect(Object.keys(services)).toEqual([MAIL_CATCHER_SERVICE])
    // An empty `volumes:` key is not something every Compose version accepts
    expect(volumes).toBeUndefined()
    expect(Object.keys(networks)).toEqual(['demo-network'])
  })

  it('runs a pinned Mailpit named after the project, on the project network', async () => {
    await build({ mailCatcher: { port: 8025 } })

    const service = parsed().services[MAIL_CATCHER_SERVICE]
    // A tag, never `latest`: the send API this project talks to must not change under it
    expect(service.image).toMatch(/^axllent\/mailpit:v\d+\.\d+\.\d+$/)
    expect(service.container_name).toBe('demo-mail-dev')
    expect(service.networks).toEqual(['demo-network'])
    expect(service.healthcheck?.test).toEqual(['CMD', '/mailpit', 'readyz'])
    expect(compose()).not.toContain('saasfoundry')
  })

  it('publishes the web port it was given on the host side only, and never the SMTP port', async () => {
    await build({ mailCatcher: { port: 8031 } })

    expect(parsed().services[MAIL_CATCHER_SERVICE].ports).toEqual(['8031:8025'])
    // The API sends over the HTTP API: publishing 1025 would only make two projects fight over it
    expect(compose()).not.toMatch(/^\s*- .*1025/m)
  })

  it('sits after the database and the storage, and adds no volume of its own', async () => {
    await build({ dbSetup: 'docker', s3Setup: 'docker', mailCatcher: { port: 8025 } })

    const { services, volumes } = parsed()
    expect(Object.keys(services)).toEqual(['db-dev', 's3-dev', 's3-init', MAIL_CATCHER_SERVICE])
    expect(Object.keys(volumes ?? {})).toEqual(['db-dev-data', 's3-dev-data'])
  })

  it('writes the file it always wrote when the project has no email module', async () => {
    await build({ dbSetup: 'docker', s3Setup: 'docker' })

    expect(Object.keys(parsed().services)).toEqual(['db-dev', 's3-dev', 's3-init'])
    expect(compose()).not.toContain('mailpit')
  })
})

describe('adding the catcher to a compose file a project already has (#976)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sf-compose-mail-add-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const file = (): string => join(dir, 'docker-compose.dev-services.yml')
  const compose = (): string => readFileSync(file(), 'utf8')

  const SETUPS = [
    { label: 'database and storage', options: { dbSetup: 'docker', s3Setup: 'docker' } },
    { label: 'database only', options: { dbSetup: 'docker', s3Setup: 'manual' } },
    { label: 'storage only', options: { dbSetup: 'manual', s3Setup: 'docker' } }
  ] as const

  // The property the update relies on: a project that received the catcher through `sf update` and a
  // project generated with it hold the same bytes, or the template update that follows reads a
  // difference nobody made.
  it.each(SETUPS)('gives a project with $label the bytes a fresh render of it has', async ({ options }) => {
    await createDevServicesCompose({ apiPath: dir, projectName: 'demo', ...options })
    expect(await ensureMailCatcherService({ apiPath: dir, projectName: 'demo', port: 8026 })).toBe('added')
    const migrated = compose()

    await createDevServicesCompose({ apiPath: dir, projectName: 'demo', ...options, mailCatcher: { port: 8026 } })
    expect(migrated).toBe(compose())
  })

  it('creates the file when the project has none', async () => {
    expect(await ensureMailCatcherService({ apiPath: dir, projectName: 'demo', port: 8025 })).toBe('created')
    expect(Object.keys((yaml.load(compose()) as Compose).services)).toEqual([MAIL_CATCHER_SERVICE])
  })

  it('does nothing the second time', async () => {
    await createDevServicesCompose({ apiPath: dir, projectName: 'demo', dbSetup: 'docker', s3Setup: 'manual' })
    await ensureMailCatcherService({ apiPath: dir, projectName: 'demo', port: 8025 })
    const once = compose()

    expect(await ensureMailCatcherService({ apiPath: dir, projectName: 'demo', port: 8025 })).toBe('present')
    expect(compose()).toBe(once)
  })

  it('leaves a service the project declared itself alone, whatever its port', async () => {
    const own = 'name: demo\nservices:\n  mail-dev:\n    image: mailhog/mailhog\n    ports:\n      - 8025:8025\n'
    writeFileSync(file(), own)

    expect(await ensureMailCatcherService({ apiPath: dir, projectName: 'demo', port: 8040 })).toBe('present')
    expect(compose()).toBe(own)
  })

  it('appends to a file with no top-level key after its services', async () => {
    const own = 'name: demo\nservices:\n  cache:\n    image: redis:7\n'
    writeFileSync(file(), own)

    expect(await ensureMailCatcherService({ apiPath: dir, projectName: 'demo', port: 8025 })).toBe('added')
    const { services } = yaml.load(compose()) as Compose
    expect(Object.keys(services)).toEqual(['cache', MAIL_CATCHER_SERVICE])
  })

  it.each([
    ['a file with no services', 'name: demo\n'],
    ['services indented by four spaces, which a block indented by two cannot join', 'name: demo\nservices:\n    cache:\n        image: redis:7\n']
  ])('refuses %s instead of writing a file Compose would reject', async (_label, own) => {
    writeFileSync(file(), own)

    expect(await insertMailCatcherService(own, 'demo', 8025)).toBeNull()
    expect(await ensureMailCatcherService({ apiPath: dir, projectName: 'demo', port: 8025 })).toBe('manual')
    expect(compose()).toBe(own)
  })
})

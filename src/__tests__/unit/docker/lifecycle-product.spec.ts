import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import type { LifecycleProcessApi, PrivatePostgres } from '../../../../tests/docker/lifecycle/postgres'
import { resolveProductLayout, runProductPhase } from '../../../../tests/docker/lifecycle/product'
import type { SupervisedCommandSpec, SupervisedProcessHandle, SupervisedProcessResult } from '../../../../tests/docker/lifecycle/types'

function result(label: string): SupervisedProcessResult {
  return {
    label,
    pid: 123,
    status: 0,
    signal: null,
    stdout: '',
    stderr: '',
    outputBytes: 0,
    outputTruncated: false,
    fatalEvents: [],
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(1).toISOString()
  }
}

describe('previous-release product runtime', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sf-product-'))
    for (const app of ['previous-release-api', 'previous-release-web']) {
      await mkdir(join(root, 'apps', app), { recursive: true })
      await writeFile(join(root, 'apps', app, 'package.json'), '{}')
    }
    await mkdir(join(root, 'apps', 'previous-release-api', 'prisma', 'sql', 'functions'), { recursive: true })
    await mkdir(join(root, 'apps', 'previous-release-api', 'prisma', 'sql', 'migrations', 'pre-schema'), { recursive: true })
    await mkdir(join(root, 'apps', 'previous-release-api', 'prisma', 'sql', 'migrations', 'post-schema'), { recursive: true })
    await writeFile(join(root, 'apps', 'previous-release-api', 'prisma', 'sql', 'functions', 'b.sql'), 'select 2;')
    await writeFile(join(root, 'apps', 'previous-release-api', 'prisma', 'sql', 'functions', 'a.sql'), 'select 1;')
    await writeFile(join(root, 'apps', 'previous-release-api', 'prisma', 'sql', 'migrations', 'pre-schema', '001-stage.sql'), 'select 3;')
    await writeFile(join(root, 'apps', 'previous-release-api', 'prisma', 'sql', 'migrations', 'post-schema', '001-migrate.sql'), 'select 4;')
  })

  afterEach(async () => rm(root, { recursive: true, force: true }))

  it('resolves the historical multirepo layout without trusting the current manifest shape', async () => {
    await expect(resolveProductLayout(root)).resolves.toEqual({
      topology: 'multirepo',
      apiRoot: join(root, 'apps', 'previous-release-api'),
      webRoot: join(root, 'apps', 'previous-release-web')
    })
  })

  it('uses direct argv, keeps post-update db push non-destructive, probes both services, and tears them down', async () => {
    const specs: SupervisedCommandSpec[] = []
    const stopped: string[] = []
    const sequence: string[] = []
    const processApi: LifecycleProcessApi = {
      run: jest.fn(async (spec) => {
        specs.push(spec)
        sequence.push(spec.label)
        return result(spec.label)
      }),
      start: jest.fn(async (spec) => {
        specs.push(spec)
        return {
          label: spec.label,
          pid: 123,
          child: {} as never,
          exited: new Promise(() => undefined),
          wait: async () => result(spec.label),
          stop: async () => {
            stopped.push(spec.label)
            return result(spec.label)
          }
        } satisfies SupervisedProcessHandle
      })
    }
    const sql: string[] = []
    const postgres = {
      root: '/tmp/postgres',
      port: 55432,
      databaseUrl: 'postgresql://sf@127.0.0.1:55432/sf',
      directUrl: 'postgresql://sf@127.0.0.1:55432/sf',
      executeSql: jest.fn(),
      runSqlFile: jest.fn(async (path: string) => {
        sql.push(path)
        sequence.push(path.split('/').pop()!)
        return result(path)
      }),
      stop: jest.fn()
    } as unknown as PrivatePostgres
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      return url.endsWith('/api/health')
        ? new Response('{"status":"ok","info":{"app":{"status":"up"}}}', { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response('<html><div id="root"></div></html>', { status: 200, headers: { 'content-type': 'text/html' } })
    })
    try {
      await runProductPhase({
        phase: 'after-update',
        projectRoot: root,
        manifest: { structure: 'multirepo', name: 'previous-release' },
        postgres,
        deadline: Date.now() + 10_000,
        settleWindowMs: 0,
        processApi
      })
    } finally {
      fetchSpy.mockRestore()
    }

    const dbPush = specs.find((spec) => spec.label.endsWith('prisma db push'))!
    const apiInstall = specs.find((spec) => spec.label.endsWith('api npm ci'))!
    const apiRuntime = specs.find((spec) => spec.label.endsWith(' api'))!
    expect(dbPush.executable).toBe(join(root, 'apps', 'previous-release-api', 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma'))
    expect(dbPush.args).toEqual(['db', 'push'])
    expect(dbPush.args).not.toContain('--force-reset')
    expect(apiInstall.env?.NODE_ENV).toBeUndefined()
    expect(apiRuntime.env?.NODE_ENV).toBe('production')
    expect(specs.every((spec) => !spec.args.some((arg) => /(?:&&|\|\||;)/.test(arg)))).toBe(true)
    expect(specs.find((spec) => spec.label.endsWith(' web'))?.args).toEqual(['run', 'preview', '--', '--host', '127.0.0.1', '--port', '5173', '--strictPort'])
    expect(sql.map((path) => path.split('/').pop())).toEqual(['001-stage.sql', 'a.sql', 'b.sql', '001-migrate.sql'])
    expect(sequence.indexOf('001-stage.sql')).toBeLessThan(sequence.indexOf('after-update prisma db push'))
    expect(sequence.indexOf('001-migrate.sql')).toBeGreaterThan(sequence.indexOf('b.sql'))
    expect(stopped).toEqual(['after-update web', 'after-update api'])
  })

  it('fails when a product process exits during live validation', async () => {
    let crashApi!: (value: SupervisedProcessResult) => void
    const apiExited = new Promise<SupervisedProcessResult>((resolve) => (crashApi = resolve))
    const processApi: LifecycleProcessApi = {
      run: jest.fn(async (spec) => result(spec.label)),
      start: jest.fn(async (spec) => ({
        label: spec.label,
        pid: 123,
        child: {} as never,
        exited: spec.label.endsWith(' api') ? apiExited : new Promise<SupervisedProcessResult>(() => undefined),
        wait: async () => result(spec.label),
        stop: async () => result(spec.label)
      }))
    }
    const postgres = {
      root: '/tmp/postgres',
      port: 55432,
      databaseUrl: 'postgresql://sf@127.0.0.1:55432/sf',
      directUrl: 'postgresql://sf@127.0.0.1:55432/sf',
      executeSql: jest.fn(),
      runSqlFile: jest.fn(async (path: string) => result(path)),
      stop: jest.fn()
    } as unknown as PrivatePostgres
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      return url.endsWith('/api/health')
        ? new Response('{"status":"ok","info":{"app":{"status":"up"}}}', { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response('<html><div id="root"></div></html>', { status: 200, headers: { 'content-type': 'text/html' } })
    })
    try {
      let failure: unknown
      try {
        await runProductPhase({
          phase: 'after-update',
          projectRoot: root,
          manifest: { structure: 'multirepo', name: 'previous-release' },
          postgres,
          deadline: Date.now() + 10_000,
          settleWindowMs: 0,
          processApi,
          onReady: async () => {
            crashApi({ ...result('after-update api'), status: 1 })
            await new Promise<void>((resolve) => setImmediate(resolve))
          }
        })
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(AggregateError)
      expect((failure as AggregateError).errors[0]).toHaveProperty('message', expect.stringMatching(/after-update api exited during live product validation/))
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

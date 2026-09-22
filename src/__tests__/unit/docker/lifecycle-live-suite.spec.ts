import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { LIVE_SUITE_CONTRACT_ENV, type LiveSuiteContract } from '../../../../tests/docker/e2e/contracts'
import { BrowserFailureBridge } from '../../../../tests/docker/lifecycle/browser'
import { runLiveSuite } from '../../../../tests/docker/lifecycle/live-suite'
import type { ProductReadyContext } from '../../../../tests/docker/lifecycle/product'
import type { LifecycleProcessApi } from '../../../../tests/docker/lifecycle/postgres'
import type { SupervisedProcessResult } from '../../../../tests/docker/lifecycle/types'
import type { LifecycleArtifactSink } from '../../../../tests/docker/lifecycle/types'

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

describe('live suite runner', () => {
  let runtimeRoot: string

  beforeEach(async () => {
    runtimeRoot = await mkdtemp(join(tmpdir(), 'sf-live-runtime-'))
    await mkdir(join(runtimeRoot, 'node_modules', '@playwright', 'test'), { recursive: true })
    await mkdir(join(runtimeRoot, 'e2e'), { recursive: true })
    await writeFile(join(runtimeRoot, 'package.json'), '{}')
    await writeFile(join(runtimeRoot, 'node_modules', '@playwright', 'test', 'package.json'), JSON.stringify({ name: '@playwright/test', version: '1.0.0' }))
    await writeFile(join(runtimeRoot, 'node_modules', '@playwright', 'test', 'cli.js'), '')
    await writeFile(join(runtimeRoot, 'e2e', 'live.config.ts'), '')
  })

  afterEach(async () => rm(runtimeRoot, { recursive: true, force: true }))

  it('passes one validated contract through argv and reads bounded JSON stats', async () => {
    let observed: LiveSuiteContract | undefined
    const processApi: LifecycleProcessApi = {
      run: jest.fn(async (spec) => {
        observed = JSON.parse(spec.env?.[LIVE_SUITE_CONTRACT_ENV] ?? '') as LiveSuiteContract
        await writeFile(observed.resultPath, JSON.stringify({ stats: { expected: 7, unexpected: 0, skipped: 0, duration: 42 } }))
        return result(spec.label)
      }),
      start: jest.fn()
    }
    const context: ProductReadyContext = {
      phase: 'creation',
      topology: 'monorepo',
      projectRoot: '/tmp/generated-project',
      webUrl: 'http://127.0.0.1:5173',
      apiUrl: 'http://127.0.0.1:3500',
      databaseUrl: 'postgresql://sf@127.0.0.1:55432/sf',
      deadline: Date.now() + 60_000,
      processApi,
      mailbox: { url: 'http://127.0.0.1:54321', capability: 'c'.repeat(64) },
      browserCapabilities: [{ name: 'chromium', version: '123.0.0', executablePath: '/browser/chromium', headless: true }],
      browserFailures: new BrowserFailureBridge()
    }

    await expect(runLiveSuite(context, { depth: 'full', runtimeRoot })).resolves.toEqual({ depth: 'full', expected: 7, unexpected: 0, skipped: 0, durationMs: 42 })
    expect(observed).toMatchObject({ schemaVersion: 1, topology: 'monorepo', phase: 'creation', depth: 'full' })
    expect(processApi.run).toHaveBeenCalledWith(expect.objectContaining({ executable: process.execPath, cwd: runtimeRoot, secrets: [context.mailbox.capability, context.databaseUrl] }))
    expect((processApi.run as jest.Mock).mock.calls[0][0].env.PLAYWRIGHT_BROWSERS_PATH).toBe('/browser')
  })

  it('requires Chromium and rejects empty or malformed results', async () => {
    const context = {
      phase: 'creation',
      topology: 'monorepo',
      projectRoot: '/tmp/generated-project',
      webUrl: 'http://127.0.0.1:5173',
      apiUrl: 'http://127.0.0.1:3500',
      databaseUrl: 'postgresql://sf@127.0.0.1:55432/sf',
      deadline: Date.now() + 60_000,
      mailbox: { url: 'http://127.0.0.1:54321', capability: 'c'.repeat(64) },
      browserFailures: new BrowserFailureBridge()
    } as const

    await expect(runLiveSuite({ ...context, processApi: {} as LifecycleProcessApi, browserCapabilities: [] }, { depth: 'smoke', runtimeRoot })).rejects.toThrow(/Chromium/)

    const processApi: LifecycleProcessApi = {
      run: jest.fn(async (spec) => {
        const parsed = JSON.parse(spec.env?.[LIVE_SUITE_CONTRACT_ENV] ?? '') as LiveSuiteContract
        await writeFile(parsed.resultPath, JSON.stringify({ stats: { expected: 0, unexpected: 0, skipped: 2, duration: 1 } }))
        return result(spec.label)
      }),
      start: jest.fn()
    }
    await expect(
      runLiveSuite({ ...context, processApi, browserCapabilities: [{ name: 'chromium', version: '123.0.0', executablePath: '/browser/chromium', headless: true }] }, { depth: 'smoke', runtimeRoot })
    ).rejects.toThrow(/expected exactly 3/)
  })

  it('rejects skipped journeys and preserves the primary failure when artifact retention also fails', async () => {
    const processApi: LifecycleProcessApi = {
      run: jest.fn(async (spec) => {
        const parsed = JSON.parse(spec.env?.[LIVE_SUITE_CONTRACT_ENV] ?? '') as LiveSuiteContract
        await writeFile(parsed.resultPath, JSON.stringify({ stats: { expected: 3, unexpected: 0, skipped: 1, duration: 1 } }))
        return result(spec.label)
      }),
      start: jest.fn()
    }
    const context: ProductReadyContext = {
      phase: 'creation',
      topology: 'monorepo',
      projectRoot: '/tmp/generated-project',
      webUrl: 'http://127.0.0.1:5173',
      apiUrl: 'http://127.0.0.1:3500',
      databaseUrl: 'postgresql://sf@127.0.0.1:55432/sf',
      deadline: Date.now() + 60_000,
      processApi,
      mailbox: { url: 'http://127.0.0.1:54321', capability: 'c'.repeat(64) },
      browserCapabilities: [{ name: 'chromium', version: '123.0.0', executablePath: '/browser/chromium', headless: true }],
      browserFailures: new BrowserFailureBridge()
    }
    const artifacts = {
      writeText: jest.fn(async () => {
        throw new Error('artifact write failed')
      })
    } as unknown as LifecycleArtifactSink

    let failure: unknown
    try {
      await runLiveSuite(context, { depth: 'smoke', runtimeRoot, artifacts, artifactPaths: { result: 'events/failure.json' } })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors.map((error) => (error as Error).message)).toEqual(['The live suite reported 1 skipped result(s).', 'artifact write failed'])
  })
})

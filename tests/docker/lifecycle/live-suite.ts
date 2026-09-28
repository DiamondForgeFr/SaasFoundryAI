import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import { LIVE_SUITE_CONTRACT_ENV, parseLiveSuiteContract, type LiveSuiteContract, type LiveSuiteDepth } from '../e2e/contracts'
import type { ProductReadyContext } from './product'
import type { LifecycleArtifactSink } from './types'

export interface LiveSuiteArtifactPaths {
  result: `events/${string}.json`
  screenshot?: `screenshots/${string}.png`
}

export interface LiveSuiteOptions {
  depth: LiveSuiteDepth
  runtimeRoot?: string
  artifacts?: LifecycleArtifactSink
  artifactPaths?: LiveSuiteArtifactPaths
}

export interface LiveSuiteResult {
  depth: LiveSuiteDepth
  expected: number
  unexpected: number
  skipped: number
  durationMs: number
}

interface PlaywrightJsonReport {
  stats?: {
    expected?: number
    unexpected?: number
    skipped?: number
    duration?: number
  }
}

const EXPECTED_TESTS: Readonly<Record<LiveSuiteDepth, number>> = { smoke: 3, full: 7 }

export async function runLiveSuite(context: ProductReadyContext, options: LiveSuiteOptions): Promise<LiveSuiteResult> {
  const runtimeRoot = options.runtimeRoot ?? '/workspace'
  const chromium = context.browserCapabilities.find((capability) => capability.name === 'chromium')
  if (!chromium) throw new Error('The live suite requires a verified Chromium capability.')
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'sf-live-suite-'))
  const outputDir = join(temporaryRoot, 'output')
  const resultPath = join(outputDir, 'result.json')
  await mkdir(outputDir)
  const contract = parseLiveSuiteContract(
    JSON.stringify({
      schemaVersion: 1,
      topology: context.topology,
      phase: context.phase,
      depth: options.depth,
      projectRoot: context.projectRoot,
      webUrl: context.webUrl,
      apiUrl: context.apiUrl,
      databaseUrl: context.databaseUrl,
      mailboxUrl: context.mailbox.url,
      mailboxCapability: context.mailbox.capability,
      resultPath,
      outputDir,
      deadline: context.deadline
    } satisfies LiveSuiteContract)
  )
  let primaryFailure: unknown
  const diagnosticFailures: unknown[] = []
  let result: LiveSuiteResult | undefined
  try {
    const requireFromRuntime = createRequire(join(runtimeRoot, 'package.json'))
    const playwrightCli = requireFromRuntime.resolve('@playwright/test/cli')
    await context.processApi.run({
      label: `${context.phase} Playwright ${options.depth}`,
      executable: process.execPath,
      args: [playwrightCli, 'test', '--config', join(runtimeRoot, 'e2e', 'live.config.ts')],
      cwd: runtimeRoot,
      env: {
        [LIVE_SUITE_CONTRACT_ENV]: JSON.stringify(contract),
        PLAYWRIGHT_BROWSERS_PATH: browserCacheRoot(chromium.executablePath),
        NODE_OPTIONS: `--require=${join(runtimeRoot, 'lifecycle', 'egress-guard.cjs')}`
      },
      deadline: context.deadline,
      signal: context.signal,
      maxOutputBytes: 4 * 1024 * 1024,
      secrets: [context.mailbox.capability, context.databaseUrl]
    })
    result = await readResult(resultPath, options.depth)
    if (result.expected !== EXPECTED_TESTS[options.depth]) {
      throw new Error(`The ${options.depth} live selection executed ${result.expected} test(s); expected exactly ${EXPECTED_TESTS[options.depth]}.`)
    }
    if (result.unexpected !== 0) throw new Error(`The live suite reported ${result.unexpected} unexpected result(s).`)
    if (result.skipped !== 0) throw new Error(`The live suite reported ${result.skipped} skipped result(s).`)
    if (options.artifacts && options.artifactPaths) {
      await options.artifacts.writeText(options.artifactPaths.result, `${JSON.stringify({ schemaVersion: 1, phase: context.phase, topology: context.topology, ...result }, null, 2)}\n`, {
        mediaType: 'application/json'
      })
    }
  } catch (error) {
    primaryFailure = error
    try {
      await retainFailureArtifacts(outputDir, resultPath, options)
    } catch (artifactError) {
      diagnosticFailures.push(artifactError)
    }
  } finally {
    try {
      await rm(temporaryRoot, { recursive: true, force: true })
    } catch (cleanupError) {
      diagnosticFailures.push(cleanupError)
    }
  }
  const failures = [...(primaryFailure === undefined ? [] : [primaryFailure]), ...diagnosticFailures]
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'The live suite failed and its diagnostic cleanup was incomplete.')
  return result!
}

function browserCacheRoot(executablePath: string): string {
  const segments = executablePath.split('/')
  const browserDirectory = segments.findIndex((segment) => /^chromium(?:_headless_shell)?-/.test(segment))
  if (browserDirectory > 0) return `/${segments.slice(1, browserDirectory).join('/')}`
  return dirname(executablePath)
}

async function readResult(path: string, depth: LiveSuiteDepth): Promise<LiveSuiteResult> {
  let document: PlaywrightJsonReport
  try {
    document = JSON.parse(await readFile(path, 'utf8')) as PlaywrightJsonReport
  } catch (error) {
    const failure = new Error('Playwright did not write one valid JSON result.') as Error & { cause?: unknown }
    failure.cause = error
    throw failure
  }
  const stats = document.stats
  if (!stats || ![stats.expected, stats.unexpected, stats.skipped, stats.duration].every((value) => Number.isFinite(value) && Number(value) >= 0)) {
    throw new Error('Playwright JSON result is missing bounded numeric stats.')
  }
  return { depth, expected: Number(stats.expected), unexpected: Number(stats.unexpected), skipped: Number(stats.skipped), durationMs: Number(stats.duration) }
}

async function retainFailureArtifacts(outputDir: string, resultPath: string, options: LiveSuiteOptions): Promise<void> {
  if (!options.artifacts || !options.artifactPaths) return
  let result: string | undefined
  try {
    result = await readFile(resultPath, 'utf8')
  } catch {
    // A missing/malformed result is already represented by the primary failure.
  }
  if (result !== undefined) await options.artifacts.writeText(options.artifactPaths.result, result, { mediaType: 'application/json' })
  const entries = await readdir(outputDir, { recursive: true }).catch(() => [] as string[])
  if (options.artifactPaths.screenshot) {
    const screenshot = entries.find((entry) => entry.endsWith('.png'))
    if (screenshot) await options.artifacts.writeBinary(options.artifactPaths.screenshot, await readFile(join(outputDir, screenshot)), { mediaType: 'image/png', sensitivity: 'browser-capture' })
  }
}

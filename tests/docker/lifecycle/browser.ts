export type BrowserFailureKind = 'page-error' | 'console-error' | 'request-failed' | 'http-error' | 'browser-disconnected'

export interface BrowserFailure {
  kind: BrowserFailureKind
  message: string
  url?: string
  method?: string
  status?: number
}

export interface BrowserCapability {
  name: 'chromium' | 'firefox' | 'webkit'
  version: string
  executablePath: string
  headless: boolean
}

interface PlaywrightBrowser {
  version(): string
  close(): Promise<void>
}

interface PlaywrightBrowserType {
  executablePath(): string
  launch(options: { headless: boolean }): Promise<PlaywrightBrowser>
}

interface PlaywrightRuntime {
  chromium: PlaywrightBrowserType
  firefox: PlaywrightBrowserType
  webkit: PlaywrightBrowserType
}

export interface BrowserFailurePolicy {
  allowedHttpStatuses?: readonly number[]
  allowedUrlPatterns?: readonly RegExp[]
  ignoredConsolePatterns?: readonly RegExp[]
}

function matches(value: string | undefined, patterns: readonly RegExp[] | undefined): boolean {
  return Boolean(value && patterns?.some((pattern) => pattern.test(value)))
}

/** Failure collector consumed by #789's Playwright listeners; it contains no product journey. */
export class BrowserFailureBridge {
  readonly failures: BrowserFailure[] = []

  constructor(private readonly policy: BrowserFailurePolicy = {}) {}

  record(failure: BrowserFailure): void {
    if (matches(failure.url, this.policy.allowedUrlPatterns)) return
    if (failure.kind === 'console-error' && matches(failure.message, this.policy.ignoredConsolePatterns)) return
    if (failure.kind === 'http-error' && failure.status !== undefined && this.policy.allowedHttpStatuses?.includes(failure.status)) return
    this.failures.push({ ...failure })
  }

  assertClean(): void {
    if (this.failures.length === 0) return
    const detail = this.failures.map((failure) => `${failure.kind}: ${failure.method ? `${failure.method} ` : ''}${failure.url ?? ''} ${failure.message}`.trim()).join('\n')
    throw new Error(`Browser/runtime failures were observed:\n${detail}`)
  }
}

export function assertBrowserCapability(capability: BrowserCapability): BrowserCapability {
  if (!capability.name.trim()) throw new Error('Browser capability requires a name.')
  if (!/^\d+(?:\.\d+){1,3}(?:[-+].+)?$/.test(capability.version)) throw new Error(`Browser capability has an invalid version: ${capability.version}`)
  if (!capability.executablePath.startsWith('/')) throw new Error('Browser executable path must be absolute inside the lifecycle image.')
  if (!capability.headless) throw new Error('Lifecycle browser capability must be headless.')
  return Object.freeze({ ...capability })
}

/**
 * Load only the harness-owned Playwright package. Generated projects may carry
 * an older test runner and must never choose the browser protocol used here.
 */
export async function verifyHarnessBrowsers(runtimeRoot = '/workspace'): Promise<readonly BrowserCapability[]> {
  const requireFromHarness = createRequire(join(runtimeRoot, 'package.json'))
  const resolved = requireFromHarness.resolve('@playwright/test')
  const playwright = requireFromHarness(resolved) as PlaywrightRuntime
  const capabilities: BrowserCapability[] = []
  for (const name of ['chromium', 'firefox', 'webkit'] as const) {
    const type = playwright[name]
    const browser = await type.launch({ headless: true })
    try {
      capabilities.push(assertBrowserCapability({ name, version: browser.version(), executablePath: type.executablePath(), headless: true }))
    } finally {
      await browser.close()
    }
  }
  return capabilities
}
import { createRequire } from 'node:module'
import { join } from 'node:path'

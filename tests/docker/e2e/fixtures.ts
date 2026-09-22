import { expect, test as base, type Page } from '@playwright/test'

import { parseLiveSuiteContract, type LiveSuiteContract } from './contracts'

interface LiveFixtures {
  contract: LiveSuiteContract
  livePage: Page
}

export const test = base.extend<LiveFixtures>({
  contract: [async ({}, use) => use(parseLiveSuiteContract()), { scope: 'test' }],
  livePage: async ({ page, contract }, use, testInfo) => {
    const failures = await observeLivePage(page, contract)

    await use(page)
    if (failures.length > 0) {
      await testInfo.attach('runtime-failures', { body: Buffer.from(`${failures.join('\n')}\n`), contentType: 'text/plain' })
    }
    expect(failures, 'Browser/runtime failures were observed').toEqual([])
  }
})

export async function observeLivePage(page: Page, contract: LiveSuiteContract): Promise<string[]> {
  const failures: string[] = []
  const webOrigin = new URL(contract.webUrl)
  const apiOrigin = new URL(contract.apiUrl)
  const allowedHosts = new Set([webOrigin.host, apiOrigin.host])
  await page.routeWebSocket(/.*/, async (webSocket) => {
    const url = new URL(webSocket.url())
    if (!allowedHosts.has(url.host)) {
      failures.push(`non-loopback-websocket: ${url.origin}${url.pathname}`)
      await webSocket.close({ code: 1008, reason: 'Lifecycle egress guard' })
      return
    }
    webSocket.connectToServer()
  })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    // The production bundle intentionally calls same-origin /api paths and
    // relies on the deployment ingress. Vite preview serves the static build
    // only, so the live harness supplies that single reverse-proxy boundary.
    if (url.host === webOrigin.host && url.pathname.startsWith('/api/')) {
      const target = new URL(`${url.pathname}${url.search}`, apiOrigin)
      await route.continue({ url: target.href })
      return
    }
    if ((url.protocol === 'http:' || url.protocol === 'https:') && !allowedHosts.has(url.host)) {
      failures.push(`non-loopback-request: ${route.request().method()} ${url.origin}${url.pathname}`)
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  })
  page.on('pageerror', (error) => failures.push(`page-error: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error' && !/^Failed to load resource: the server responded with a status of \d+/.test(message.text())) failures.push(`console-error: ${message.text()}`)
  })
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? ''
    if (['document', 'fetch', 'xhr'].includes(request.resourceType()) && reason !== 'net::ERR_ABORTED') failures.push(`request-failed: ${request.method()} ${request.url()} ${reason}`)
  })
  page.on('response', (response) => {
    if (response.status() >= 500 && ['document', 'fetch', 'xhr'].includes(response.request().resourceType())) {
      failures.push(`http-error: ${response.status()} ${response.request().method()} ${response.url()}`)
    }
  })
  page.on('crash', () => failures.push('browser-crashed'))
  return failures
}

export { expect }

import { assertBrowserCapability, BrowserFailureBridge } from '../../../../tests/docker/lifecycle/browser'

describe('lifecycle browser bridge', () => {
  it('collects browser, console, network, and HTTP failures for #789', () => {
    const bridge = new BrowserFailureBridge({ allowedHttpStatuses: [404], ignoredConsolePatterns: [/known warning/] })
    bridge.record({ kind: 'console-error', message: 'known warning' })
    bridge.record({ kind: 'http-error', message: 'optional icon', url: 'http://app/favicon.ico', status: 404 })
    bridge.record({ kind: 'page-error', message: 'render crashed', url: 'http://app/' })
    bridge.record({ kind: 'request-failed', message: 'ECONNRESET', method: 'GET', url: 'http://api/users' })

    expect(() => bridge.assertClean()).toThrow(/render crashed[\s\S]*ECONNRESET/)
    expect(bridge.failures).toHaveLength(2)
  })

  it('requires one absolute headless browser capability', () => {
    expect(assertBrowserCapability({ name: 'chromium', version: '140.0.1', executablePath: '/ms-playwright/chromium/chrome', headless: true })).toEqual({
      name: 'chromium',
      version: '140.0.1',
      executablePath: '/ms-playwright/chromium/chrome',
      headless: true
    })
    expect(() => assertBrowserCapability({ name: 'chromium', version: 'latest', executablePath: 'chrome', headless: false })).toThrow()
  })
})

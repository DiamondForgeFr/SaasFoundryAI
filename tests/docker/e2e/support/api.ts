import { expect, type APIRequestContext, type APIResponse, type Locator, type Page } from '@playwright/test'

import type { LiveSuiteContract } from '../contracts'

/**
 * Bound for one browser-issued API call to answer. It matches `navigationTimeout` in
 * live.config.ts: a server round trip, not a UI reaction.
 */
const LIVE_API_RESPONSE_TIMEOUT = 30_000

export async function apiJson<T>(
  request: APIRequestContext,
  contract: LiveSuiteContract,
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  data?: unknown
): Promise<{ response: APIResponse; body: T }> {
  const response = await request[method](`${contract.apiUrl}/api${path}`, data === undefined ? undefined : { data })
  const text = await response.text()
  let body: T
  try {
    body = JSON.parse(text) as T
  } catch {
    throw new Error(`${method.toUpperCase()} ${path} returned non-JSON status ${response.status()}: ${text.slice(0, 500)}`)
  }
  return { response, body }
}

export async function assertApiStatus(response: APIResponse, expected: number): Promise<void> {
  if (response.status() === expected) return
  throw new Error(`Expected API status ${expected}, received ${response.status()}: ${(await response.text()).slice(0, 1_000)}`)
}

export async function signInBrowser(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/signin')
  await page.getByLabel(/Email/i).fill(email)
  await page.getByLabel(/^Password/i).fill(password)
  await page.getByRole('button', { name: /^Sign in$/i }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
}

/**
 * Clicks a submit control and waits for the API call it sends to answer with a 2xx.
 *
 * A dialog that closes on its mutation's success stays open for as long as the request runs.
 * `POST /invitations` hashes a password, writes a transaction and delivers the mail before it
 * answers, which a loaded host can stretch past the 5 s default of `expect(...).toBeHidden()`
 * (#1200). Waiting for the response first keeps the server time out of the UI assertion, and a
 * failure names the side that was late: the request, its status, or the close itself.
 */
export async function submitAndWaitForApi(page: Page, submit: Locator, method: 'POST' | 'PATCH' | 'DELETE', path: string): Promise<void> {
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.request().method() === method && new URL(candidate.url()).pathname === `/api${path}`, { timeout: LIVE_API_RESPONSE_TIMEOUT }),
    submit.click()
  ])
  if (response.ok()) return
  throw new Error(`${method} /api${path} answered ${response.status()}: ${(await response.text()).slice(0, 1_000)}`)
}

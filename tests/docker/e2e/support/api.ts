import { expect, type APIRequestContext, type APIResponse, type Page } from '@playwright/test'

import type { LiveSuiteContract } from '../contracts'

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

import type { Page } from '@playwright/test'

import { test, expect, observeLivePage } from '../fixtures'
import { signInBrowser } from '../support/api'
import { queryRows } from '../support/assertions'
import { LIVE_NEW_PASSWORD, LIVE_PASSWORD, liveIdentity, liveName } from '../support/data'

test.describe.serial('live account reactivation', () => {
  test('account-owner requests are approved and rejected by a platform admin @full', async ({ browser, livePage: ownerPage, contract }) => {
    const owner = liveIdentity(contract, 'owner')
    const admin = liveIdentity(contract, 'admin')
    const accountName = liveName(contract, 'owner account')
    const accounts = await queryRows<{ id: string }>(contract, 'SELECT id FROM public.accounts WHERE name = $1', [accountName])
    const accountId = accounts[0]?.id
    expect(accountId).toBeTruthy()

    await signInBrowser(ownerPage, owner.email, LIVE_PASSWORD)
    await ownerPage.goto('/account')
    await deactivateOwnAccount(ownerPage)
    await ownerPage.goto('/dashboard')
    await expect(ownerPage).toHaveURL(/\/account\/reactivation$/)
    await expect(ownerPage.getByTestId('reactivation-request-form')).toBeVisible()
    await ownerPage.getByTestId('reactivation-message').fill('Please reactivate this lifecycle account after the approval check.')
    await ownerPage.getByTestId('reactivation-submit').click()
    await expect(ownerPage.getByTestId('reactivation-pending')).toBeVisible()
    await expect.poll(() => latestRequestStatus(contract, accountId!)).toBe('PENDING')

    const adminContext = await browser.newContext({ baseURL: contract.webUrl })
    try {
      const adminPage = await adminContext.newPage()
      const failures = await observeLivePage(adminPage, contract)
      await signInBrowser(adminPage, admin.email, LIVE_NEW_PASSWORD)
      await openPendingReview(adminPage, accountId!)
      await adminPage.getByTestId('reactivation-approve').click()
      await expect(adminPage.getByTestId('reactivation-review-sheet')).toBeHidden()
      await expect.poll(() => accountActivation(contract, accountId!)).toBe(true)
      await expect.poll(() => latestRequestStatus(contract, accountId!)).toBe('APPROVED')

      await ownerPage.goto('/account')
      await expect(ownerPage.getByTestId('account-status-switch')).toBeChecked()
      await deactivateOwnAccount(ownerPage)
      await ownerPage.goto('/dashboard')
      await expect(ownerPage).toHaveURL(/\/account\/reactivation$/)
      await ownerPage.getByTestId('reactivation-message').fill('Please review this second lifecycle reactivation request.')
      await ownerPage.getByTestId('reactivation-submit').click()
      await expect(ownerPage.getByTestId('reactivation-pending')).toBeVisible()
      await expect.poll(() => latestRequestStatus(contract, accountId!)).toBe('PENDING')

      await openPendingReview(adminPage, accountId!)
      await adminPage.getByTestId('reactivation-reject').click()
      await adminPage.getByTestId('reactivation-reject-note').fill('Rejected by the lifecycle validation journey.')
      await adminPage.getByTestId('reactivation-reject-submit').click()
      await expect.poll(() => latestRequestStatus(contract, accountId!)).toBe('REJECTED')
      await expect.poll(() => accountActivation(contract, accountId!)).toBe(false)

      await ownerPage.reload()
      await expect(ownerPage.getByTestId('reactivation-rejected')).toContainText('Rejected by the lifecycle validation journey.')
      await expect(ownerPage.getByTestId('reactivation-request-form')).toBeVisible()
      expect(failures, 'Reactivation admin browser/runtime failures were observed').toEqual([])
    } finally {
      await adminContext.close()
    }
  })
})

async function deactivateOwnAccount(page: Page): Promise<void> {
  await page.getByTestId('account-status-switch').click()
  await page.getByTestId('confirm-dialog-confirm').click()
  await expect(page.getByTestId('confirm-dialog-confirm')).toBeHidden()
}

async function openPendingReview(page: Page, accountId: string): Promise<void> {
  await page.goto('/account?tab=accounts')
  await page.getByTestId(`account-card-${accountId}`).click()
  await expect(page.getByTestId('reactivation-review-sheet')).toBeVisible()
}

async function accountActivation(contract: Parameters<typeof queryRows>[0], accountId: string): Promise<boolean | undefined> {
  const rows = await queryRows<{ is_active: boolean }>(contract, 'SELECT is_active FROM public.accounts WHERE id = $1', [accountId])
  return rows[0]?.is_active
}

async function latestRequestStatus(contract: Parameters<typeof queryRows>[0], accountId: string): Promise<string | undefined> {
  const rows = await queryRows<{ status: string }>(
    contract,
    `SELECT status::text AS status
     FROM public.account_reactivation_requests
     WHERE account_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [accountId]
  )
  return rows[0]?.status
}

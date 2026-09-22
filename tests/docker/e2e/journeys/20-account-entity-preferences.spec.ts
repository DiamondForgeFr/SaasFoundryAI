import { test, expect } from '../fixtures'
import { signInBrowser } from '../support/api'
import { expectRowCount, queryRows } from '../support/assertions'
import { LIVE_PASSWORD, liveIdentity, liveName } from '../support/data'

test.describe.serial('live account, entity and preferences', () => {
  test('account admin creates an entity and persists user preferences @full', async ({ livePage: page, contract }) => {
    const owner = liveIdentity(contract, 'owner')
    const accountName = liveName(contract, 'owner account')
    const entityName = liveName(contract, 'company')

    await signInBrowser(page, owner.email, LIVE_PASSWORD)
    await page.goto('/account?tab=entities')
    await page.getByRole('button', { name: /New entity/i }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: /^Company/i }).click()
    await dialog.getByLabel(/^Name$/i).fill(entityName)
    await dialog.getByLabel(/Description/i).fill('Created by the generated-product lifecycle suite.')
    await dialog.getByLabel(/Website/i).fill('example.test')
    await dialog.getByRole('button', { name: /^Create$/i }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByTestId('entity-row').filter({ hasText: entityName })).toBeVisible()

    await expectRowCount(
      contract,
      `SELECT COUNT(*)
       FROM public.entities entity
       INNER JOIN public.accounts account ON account.id = entity."accountId"
       INNER JOIN public.organizations organization ON organization.entity_id = entity.id
       WHERE account.name = $1 AND organization.name = $2 AND organization.type = 'COMPANY' AND entity.is_active = TRUE`,
      [accountName, entityName],
      1
    )

    await page.goto('/profile')
    await expect(page.getByTestId('preferences-section')).toBeVisible()
    await page
      .getByTestId('theme-switch')
      .getByRole('button', { name: /^Dark$/i })
      .click()
    await expect.poll(() => page.evaluate(() => localStorage.getItem('sf-theme'))).toBe('dark')
    await expect(page.locator('html')).toHaveClass(/dark/)

    await page
      .getByTestId('language-switch')
      .getByRole('button', { name: /^Français$/i })
      .click()
    await expect
      .poll(async () => {
        const rows = await queryRows<{ locale: string }>(
          contract,
          `SELECT preference.locale::text AS locale
         FROM public.user_preferences preference
         INNER JOIN public.users user_account ON user_account.id = preference.user_id
         WHERE user_account.email = $1`,
          [owner.email]
        )
        return rows[0]?.locale
      })
      .toBe('FR')

    await page.reload()
    await expect(page.getByTestId('theme-switch').getByRole('button', { name: /^Sombre$/i })).toHaveClass(/bg-accent/)
    await expect(page.getByTestId('language-switch').getByRole('button', { name: /^Français$/i })).toHaveClass(/bg-accent/)
  })
})

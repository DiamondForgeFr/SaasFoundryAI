import { test, expect, observeLivePage } from '../fixtures'
import { signInBrowser } from '../support/api'
import { queryRows } from '../support/assertions'
import { LIVE_NEW_PASSWORD, LIVE_PASSWORD, liveIdentity } from '../support/data'

const MODULE_NAME = 'ACCOUNT_ADMINISTRATION'

test.describe.serial('live module lifecycle', () => {
  test('platform admin deactivates and restores a generated module @full', async ({ browser, livePage: page, contract }) => {
    const admin = liveIdentity(contract, 'admin')
    const owner = liveIdentity(contract, 'owner')
    await signInBrowser(page, admin.email, LIVE_NEW_PASSWORD)
    await page.goto('/platform/modules')

    const card = page.getByTestId(`module-card-${MODULE_NAME}`)
    const moduleSwitch = page.getByTestId(`module-switch-${MODULE_NAME}`)
    await expect(card).toBeVisible()
    await expect(moduleSwitch).toBeChecked()

    await moduleSwitch.click()
    await expect(moduleSwitch).not.toBeChecked()
    await expect.poll(() => moduleActivation(contract, MODULE_NAME)).toBe(false)

    const ownerContext = await browser.newContext({ baseURL: contract.webUrl })
    try {
      const ownerPage = await ownerContext.newPage()
      const failures = await observeLivePage(ownerPage, contract)
      await signInBrowser(ownerPage, owner.email, LIVE_PASSWORD)
      await ownerPage.goto('/account')
      await expect(ownerPage).not.toHaveURL(/\/account(?:\?|$)/)

      await page.reload()
      await expect(page.getByTestId(`module-switch-${MODULE_NAME}`)).not.toBeChecked()
      await page.getByTestId(`module-switch-${MODULE_NAME}`).click()
      await expect(page.getByTestId(`module-switch-${MODULE_NAME}`)).toBeChecked()
      await expect.poll(() => moduleActivation(contract, MODULE_NAME)).toBe(true)

      await ownerPage.goto('/account?tab=entities')
      await expect(ownerPage.getByTestId('entities-table')).toBeVisible()
      expect(failures, 'Module lifecycle owner browser/runtime failures were observed').toEqual([])
    } finally {
      await ownerContext.close()
    }
  })
})

async function moduleActivation(contract: Parameters<typeof queryRows>[0], name: string): Promise<boolean | undefined> {
  const rows = await queryRows<{ is_active: boolean }>(contract, 'SELECT is_active FROM public.modules WHERE name = $1', [name])
  return rows[0]?.is_active
}

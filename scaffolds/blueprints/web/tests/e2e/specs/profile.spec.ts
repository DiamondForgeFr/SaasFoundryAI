/**
 * Resources
 */
import { expect, Page, Route, test } from '@playwright/test'

/**
 * Dependencies
 */
import { selectors, testApi, testData } from '../selectors/profile.se'
import { selectors as globaleSelectors } from '../selectors/globale.se'
import { setupApiInterceptor } from '../utils/api-interceptor'

/**
 * Types
 */
interface CustomPage extends Page {
  mockRoute: (url: string, handler: (route: Route) => Promise<void>) => Promise<void>
}

/**
 * Setup authenticated user (admin with preferences)
 */
async function setupAuthenticatedUser(page: CustomPage) {
  await page.goto('/')

  await page.mockRoute(testApi.meAdminWithPreferences.URL, async (route) => {
    await route.fulfill({
      status: testApi.meAdminWithPreferences.success.status,
      contentType: 'application/json',
      body: JSON.stringify(testApi.meAdminWithPreferences.success.body)
    })
  })

  await page.evaluate((userData) => {
    localStorage.setItem('authMe', JSON.stringify(userData))
  }, testApi.meAdminWithPreferences.success.body)
}

/**
 * Tests
 */
test.describe('Profile Management Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Broad interceptor — abort any /api/* call that isn't explicitly mocked
    await setupApiInterceptor(page, '**/api/**')
    await setupAuthenticatedUser(page as CustomPage)
    await page.goto(selectors.URL)
  })

  test('should land on the profile page', async ({ page }) => {
    await expect(page).toHaveURL(selectors.successURL)
  })

  test('should display correct breadcrumb', async ({ page }) => {
    const breadcrumb = page.getByLabel(globaleSelectors.breadcrumb.ariaLabel.name)
    const pageDescription = page.getByTestId(globaleSelectors.breadcrumb.blockId)
    await expect(breadcrumb).toBeVisible()
    await expect(breadcrumb.locator('li').first()).toHaveText('Profile management')
    await expect(breadcrumb.locator('li').last()).toHaveText('Settings')
    await expect(pageDescription).toHaveText('Profile information and personal preferences')
  })

  test('should not have translation keys in the page', async ({ page }) => {
    const elements = await page.$$('text=/.tk_/')
    expect(elements.length).toBe(0)
  })

  test('should display the profile header with name, email and role', async ({ page }) => {
    const header = page.getByTestId(selectors.header.blockId)
    await expect(header).toBeVisible()

    await expect(header.getByText(`${testData.firstName} ${testData.lastName}`)).toBeVisible()
    await expect(header.getByText(testData.email)).toBeVisible()
    await expect(header.getByText(selectors.header.role.name)).toBeVisible()
  })

  test('should display the profile information section', async ({ page }) => {
    const section = page.getByTestId(selectors.profileInfo.blockId)
    await expect(section).toBeVisible()

    await expect(section.getByText(selectors.profileInfo.title)).toBeVisible()

    // Labels
    await expect(section.getByText(selectors.profileInfo.fields.firstName)).toBeVisible()
    await expect(section.getByText(selectors.profileInfo.fields.lastName)).toBeVisible()
    await expect(section.getByText(selectors.profileInfo.fields.email)).toBeVisible()
    await expect(section.getByText(selectors.profileInfo.fields.roles)).toBeVisible()
    await expect(section.getByText(selectors.profileInfo.fields.memberSince)).toBeVisible()

    // Values
    await expect(section.getByText(testData.firstName, { exact: true })).toBeVisible()
    await expect(section.getByText(testData.lastName, { exact: true })).toBeVisible()
    await expect(section.getByText(testData.email)).toBeVisible()
  })

  test('should display the memberships section with accounts and entities', async ({ page }) => {
    const section = page.getByTestId(selectors.memberships.blockId)
    await expect(section).toBeVisible()

    await expect(section.getByText(selectors.memberships.title)).toBeVisible()
    await expect(section.getByText(selectors.memberships.accounts)).toBeVisible()
    await expect(section.getByText(selectors.memberships.entities)).toBeVisible()

    // Account name appears in the accounts row
    await expect(section.getByText(testData.accountName)).toBeVisible()
    // Entity displayed as "Organization · Entity" or just entity name
    await expect(section.getByText(new RegExp(testData.entityName))).toBeVisible()
  })

  test('should display the preferences section with theme and language switches', async ({ page }) => {
    const section = page.getByTestId(selectors.preferences.blockId)
    await expect(section).toBeVisible()

    await expect(section.getByText(selectors.preferences.title)).toBeVisible()

    const themeSwitch = section.getByTestId(selectors.preferences.theme.blockId)
    await expect(themeSwitch).toBeVisible()
    await expect(themeSwitch.getByRole('button', { name: selectors.preferences.theme.light })).toBeVisible()
    await expect(themeSwitch.getByRole('button', { name: selectors.preferences.theme.dark })).toBeVisible()
    await expect(themeSwitch.getByRole('button', { name: selectors.preferences.theme.system })).toBeVisible()

    const languageSwitch = section.getByTestId(selectors.preferences.language.blockId)
    await expect(languageSwitch).toBeVisible()
    await expect(languageSwitch.getByRole('button', { name: selectors.preferences.language.en })).toBeVisible()
    await expect(languageSwitch.getByRole('button', { name: selectors.preferences.language.fr })).toBeVisible()
  })

  test('should switch theme between light and dark', async ({ page }) => {
    const themeSwitch = page.getByTestId(selectors.preferences.theme.blockId)
    await themeSwitch.getByRole('button', { name: selectors.preferences.theme.dark }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)

    await themeSwitch.getByRole('button', { name: selectors.preferences.theme.light }).click()
    await expect(page.locator('html')).not.toHaveClass(/dark/)
  })

  test('should switch language and call the preferences endpoint', async ({ page }) => {
    let capturedBody: string | null = null
    await (page as CustomPage).mockRoute(testApi.updatePreferences.URL, async (route) => {
      if (route.request().method() === 'PATCH' || route.request().method() === 'PUT' || route.request().method() === 'POST') {
        capturedBody = route.request().postData()
        await route.fulfill({
          status: testApi.updatePreferences.success.status,
          contentType: 'application/json',
          body: JSON.stringify(testApi.updatePreferences.success.body)
        })
      } else {
        await route.continue()
      }
    })

    const languageSwitch = page.getByTestId(selectors.preferences.language.blockId)
    await languageSwitch.getByRole('button', { name: selectors.preferences.language.fr }).click()

    // Wait for the preferences mutation to fire
    await expect.poll(() => capturedBody).not.toBeNull()
    expect(capturedBody).toContain('FR')
  })
})

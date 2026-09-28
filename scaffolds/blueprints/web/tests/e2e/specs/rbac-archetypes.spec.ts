/**
 * Resources
 */
import { expect, Page, Route, test } from '@playwright/test'

/**
 * Dependencies
 */
import { ids, me, selectors, testApi } from '../selectors/archetypes.se'
import { setupApiInterceptor } from '../utils/api-interceptor'

/**
 * RBAC v2 — per-archetype access-matrix suite (mock-based).
 *
 * Each `describe` mocks `/me` with the archetype's fixture (see `archetypes.se.ts`, grants from
 * `apps/api/docs/rbac-v2.md` §5) then asserts the §10 matrix on three axes:
 *   1. Screen reach  — /account · /platform/modules · /profile reachable vs redirected.
 *   2. Section visibility — which account tabs render per archetype (sub-module gated).
 *   3. Action affordances — admin sees the action CTA; the matching `-user` sees the SAME section
 *      with the CTA ABSENT (the read-only crux).
 */

/**
 * Types
 */
interface CustomPage extends Page {
  mockRoute: (url: string, handler: (route: Route) => Promise<void>) => Promise<void>
}

type MeFixture = (typeof me)[keyof typeof me]

/**
 * Helpers
 */
async function fulfill(page: CustomPage, url: string, body: unknown, status = 200) {
  await page.mockRoute(url, async (route) => {
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

/**
 * Wire every endpoint an account/platform screen may pull. Bodies are minimal but schema-valid, so
 * the tests stay deterministic regardless of which archetype is mounted.
 */
async function mockSharedEndpoints(page: CustomPage) {
  await fulfill(page, testApi.guest.URL, testApi.guest.success.body)
  await fulfill(page, testApi.invitations.URL, testApi.invitations.success.bodyEmpty)
  await fulfill(page, testApi.allAccounts.URL, testApi.allAccounts.success.body)
  await fulfill(page, testApi.platformOverview.URL, testApi.platformOverview.success.body)
  await fulfill(page, testApi.platformModules.URL, testApi.platformModules.success.body)

  // Both accounts (the second one drives the multi-account scope header).
  for (const accountId of [ids.accountA, ids.accountB]) {
    await fulfill(page, testApi.account(accountId).URL, testApi.account(accountId).success.body)
    await fulfill(page, testApi.entities(accountId).URL, testApi.entities(accountId).success.body)
    await fulfill(page, testApi.users(accountId).URL, testApi.users(accountId).success.body)
    await fulfill(page, testApi.roles(accountId).URL, testApi.roles(accountId).success.body)
  }
}

/**
 * Mock `/me` with the archetype fixture AND prime `localStorage` so the session is active on first
 * paint (mirrors `account.spec`'s `setupAuthenticatedUser`).
 */
async function authenticateAs(page: CustomPage, fixture: MeFixture) {
  await page.goto('/')
  await fulfill(page, fixture.URL, fixture.success.body)
  await page.evaluate((body) => {
    localStorage.setItem('authMe', JSON.stringify(body))
    // Clear any scope override leaked from a previous test in the same worker.
    sessionStorage.removeItem('currentScopeOverride')
  }, fixture.success.body)
}

/**
 * Shared setup
 */
test.beforeEach(async ({ page }) => {
  await setupApiInterceptor(page, testApi.interceptorURL)
  await mockSharedEndpoints(page as CustomPage)
})

/* ─────────────────────────── GUEST (unauthenticated) ─────────────────────────── */

test.describe('Archetype: guest (unauthenticated)', () => {
  test('is redirected to /signin from every gated screen', async ({ page }) => {
    // No authMe in localStorage → no active session.
    await page.goto('/')
    await page.evaluate(() => localStorage.removeItem('authMe'))

    for (const url of [selectors.accountURL, selectors.platformModulesURL, selectors.profileURL]) {
      await page.goto(url)
      await expect(page).toHaveURL(selectors.signInURLPattern)
    }
  })
})

/* ─────────────────────────── PLATFORM ADMIN ─────────────────────────── */

test.describe('Archetype: platform-admin', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page as CustomPage, me.platformAdmin)
  })

  test('reaches /account, /platform/modules and /profile', async ({ page }) => {
    await page.goto(selectors.accountURL)
    await expect(page.getByRole('tab', selectors.sectionTabs.overview)).toBeVisible()

    await page.goto(selectors.platformModulesURL)
    await expect(page).toHaveURL(/.*\/platform\/modules/)

    await page.goto(selectors.profileURL)
    await expect(page).toHaveURL(/.*\/profile/)
  })

  test('PLATFORM scope exposes overview + accounts + roles + users tabs', async ({ page }) => {
    await page.goto(selectors.accountURL)
    await expect(page.getByRole('tab', selectors.sectionTabs.overview)).toBeVisible()
    await expect(page.getByRole('tab', selectors.sectionTabs.accounts)).toBeVisible()
    await expect(page.getByRole('tab', selectors.sectionTabs.roles)).toBeVisible()
    await expect(page.getByRole('tab', selectors.sectionTabs.users)).toBeVisible()
    // PLATFORM_ALL hides the account-only Entities tab (accounts own entities, not the platform view).
    await expect(page.getByRole('tab', selectors.sectionTabs.entities)).not.toBeVisible()
  })

  test('can toggle modules on /platform/modules (MODULE_MANAGEMENT switch present)', async ({ page }) => {
    await page.goto(selectors.platformModulesURL)
    // ACCOUNT_ADMINISTRATION is a non-locked module → its status switch is interactive for an actor
    // holding MODULE_MANAGEMENT (read-only actors get a static status pill instead).
    await expect(page.getByRole('switch')).toHaveCount(1)
  })
})

/* ─────────────────────────── PLATFORM USER (read-only) ─────────────────────────── */

test.describe('Archetype: platform-user (read-only)', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page as CustomPage, me.platformUser)
  })

  test('reaches /platform/modules, /account and /profile (read access into platform)', async ({ page }) => {
    await page.goto(selectors.platformModulesURL)
    await expect(page).toHaveURL(/.*\/platform\/modules/)

    await page.goto(selectors.accountURL)
    await expect(page.getByRole('tab', selectors.sectionTabs.overview)).toBeVisible()

    await page.goto(selectors.profileURL)
    await expect(page).toHaveURL(/.*\/profile/)
  })

  test('sees the same platform sections as platform-admin', async ({ page }) => {
    await page.goto(selectors.accountURL)
    await expect(page.getByRole('tab', selectors.sectionTabs.overview)).toBeVisible()
    await expect(page.getByRole('tab', selectors.sectionTabs.accounts)).toBeVisible()
    await expect(page.getByRole('tab', selectors.sectionTabs.roles)).toBeVisible()
    await expect(page.getByRole('tab', selectors.sectionTabs.users)).toBeVisible()
  })

  test('READ-ONLY: /platform/modules has NO toggle switch (no MODULE_MANAGEMENT)', async ({ page }) => {
    await page.goto(selectors.platformModulesURL)
    // Read-only actors get a static status pill, never an interactive switch.
    await expect(page.getByRole('switch')).toHaveCount(0)
  })
})

/* ─────────────────────────── ACCOUNT ADMIN ─────────────────────────── */

test.describe('Archetype: account-admin', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page as CustomPage, me.accountAdmin)
  })

  test('reaches /account but is BLOCKED from /platform/modules', async ({ page }) => {
    await page.goto(selectors.accountURL)
    await expect(page.getByRole('tab', selectors.sectionTabs.overview)).toBeVisible()

    // No PLATFORM_ADMINISTRATION module → ModuleAccessRoute redirects to /signin, but since the
    // session is active PublicOnlyRoute immediately bounces /signin → /dashboard. The net effect for
    // an authenticated-but-unauthorised actor is /dashboard (vs /signin for an unauthenticated guest).
    await page.goto(selectors.platformModulesURL)
    await expect(page).toHaveURL(selectors.dashboardURLPattern)
  })

  test('ACCOUNT scope exposes overview + entities + roles + users (no accounts tab)', async ({ page }) => {
    await page.goto(selectors.accountURL)
    await expect(page.getByRole('tab', selectors.sectionTabs.overview)).toBeVisible()
    await expect(page.getByRole('tab', selectors.sectionTabs.entities)).toBeVisible()
    await expect(page.getByRole('tab', selectors.sectionTabs.roles)).toBeVisible()
    await expect(page.getByRole('tab', selectors.sectionTabs.users)).toBeVisible()
    await expect(page.getByRole('tab', selectors.sectionTabs.accounts)).not.toBeVisible()
  })

  test('ACTION: Users tab shows "Invite user", Entities tab shows "New entity", Roles tab shows "New role"', async ({ page }) => {
    await page.goto(selectors.accountURL)

    await page.getByRole('tab', selectors.sectionTabs.users).click()
    await expect(page.getByRole('button', selectors.cta.inviteUser).first()).toBeVisible()

    await page.getByRole('tab', selectors.sectionTabs.entities).click()
    await expect(page.getByRole('button', selectors.cta.createEntity).first()).toBeVisible()

    await page.getByRole('tab', selectors.sectionTabs.roles).click()
    await expect(page.getByRole('button', selectors.cta.createRole).first()).toBeVisible()
  })
})

/* ─────────────────────────── ACCOUNT USER (read-only) ─────────────────────────── */

test.describe('Archetype: account-user (read-only)', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page as CustomPage, me.accountUser)
  })

  test('reaches /account but is BLOCKED from /platform/modules', async ({ page }) => {
    await page.goto(selectors.accountURL)
    await expect(page.getByRole('tab', selectors.sectionTabs.overview)).toBeVisible()

    // Authenticated-but-unauthorised: ModuleAccessRoute → /signin, then PublicOnlyRoute bounces the
    // active session to /dashboard.
    await page.goto(selectors.platformModulesURL)
    await expect(page).toHaveURL(selectors.dashboardURLPattern)
  })

  test('sees the SAME account sections as account-admin (overview + entities + roles + users)', async ({ page }) => {
    await page.goto(selectors.accountURL)
    await expect(page.getByRole('tab', selectors.sectionTabs.overview)).toBeVisible()
    await expect(page.getByRole('tab', selectors.sectionTabs.entities)).toBeVisible()
    await expect(page.getByRole('tab', selectors.sectionTabs.roles)).toBeVisible()
    await expect(page.getByRole('tab', selectors.sectionTabs.users)).toBeVisible()
  })

  test('READ-ONLY: no "Invite user" / "New entity" / "New role" CTAs', async ({ page }) => {
    await page.goto(selectors.accountURL)

    await page.getByRole('tab', selectors.sectionTabs.users).click()
    await expect(page.getByRole('button', selectors.cta.inviteUser)).toHaveCount(0)

    await page.getByRole('tab', selectors.sectionTabs.entities).click()
    await expect(page.getByRole('button', selectors.cta.createEntity)).toHaveCount(0)

    await page.getByRole('tab', selectors.sectionTabs.roles).click()
    await expect(page.getByRole('button', selectors.cta.createRole)).toHaveCount(0)
  })
})

/* ─────────────────────────── ENTITY ADMIN ─────────────────────────── */

test.describe('Archetype: entity-admin', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page as CustomPage, me.entityAdmin)
  })

  test('reaches /account but is BLOCKED from /platform/modules', async ({ page }) => {
    await page.goto(selectors.accountURL)
    await expect(page.getByRole('tab', selectors.sectionTabs.overview)).toBeVisible()

    // Authenticated-but-unauthorised: ModuleAccessRoute → /signin, then PublicOnlyRoute bounces the
    // active session to /dashboard.
    await page.goto(selectors.platformModulesURL)
    await expect(page).toHaveURL(selectors.dashboardURLPattern)
  })

  test('ENTITY scope exposes overview + users + roles, with NO entities tab (D5)', async ({ page }) => {
    await page.goto(selectors.accountURL)
    await expect(page.getByRole('tab', selectors.sectionTabs.overview)).toBeVisible()
    await expect(page.getByRole('tab', selectors.sectionTabs.users)).toBeVisible()
    await expect(page.getByRole('tab', selectors.sectionTabs.roles)).toBeVisible()
    // No ENTITIES sub-module → no Entities tab, and never the platform Accounts tab.
    await expect(page.getByRole('tab', selectors.sectionTabs.entities)).not.toBeVisible()
    await expect(page.getByRole('tab', selectors.sectionTabs.accounts)).not.toBeVisible()
  })

  test('ACTION: Users tab shows "Invite user", Roles tab shows "New role"', async ({ page }) => {
    await page.goto(selectors.accountURL)

    await page.getByRole('tab', selectors.sectionTabs.users).click()
    await expect(page.getByRole('button', selectors.cta.inviteUser).first()).toBeVisible()

    await page.getByRole('tab', selectors.sectionTabs.roles).click()
    await expect(page.getByRole('button', selectors.cta.createRole).first()).toBeVisible()
  })
})

/* ─────────────────────────── ENTITY USER (read-only) ─────────────────────────── */

test.describe('Archetype: entity-user (read-only)', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page as CustomPage, me.entityUser)
  })

  test('reaches /account but is BLOCKED from /platform/modules', async ({ page }) => {
    await page.goto(selectors.accountURL)
    await expect(page.getByRole('tab', selectors.sectionTabs.overview)).toBeVisible()

    // Authenticated-but-unauthorised: ModuleAccessRoute → /signin, then PublicOnlyRoute bounces the
    // active session to /dashboard.
    await page.goto(selectors.platformModulesURL)
    await expect(page).toHaveURL(selectors.dashboardURLPattern)
  })

  test('sees the SAME entity sections as entity-admin (overview + users + roles, no entities tab)', async ({ page }) => {
    await page.goto(selectors.accountURL)
    await expect(page.getByRole('tab', selectors.sectionTabs.overview)).toBeVisible()
    await expect(page.getByRole('tab', selectors.sectionTabs.users)).toBeVisible()
    await expect(page.getByRole('tab', selectors.sectionTabs.roles)).toBeVisible()
    await expect(page.getByRole('tab', selectors.sectionTabs.entities)).not.toBeVisible()
  })

  test('READ-ONLY: no "Invite user" / "New role" CTAs', async ({ page }) => {
    await page.goto(selectors.accountURL)

    await page.getByRole('tab', selectors.sectionTabs.users).click()
    await expect(page.getByRole('button', selectors.cta.inviteUser)).toHaveCount(0)

    await page.getByRole('tab', selectors.sectionTabs.roles).click()
    await expect(page.getByRole('button', selectors.cta.createRole)).toHaveCount(0)
  })
})

/* ─────────────────────────── MULTI-ACCOUNT ─────────────────────────── */

test.describe('Archetype: multi-account (account-admin × 2 accounts)', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page as CustomPage, me.multiAccount)
  })

  test('scope header exposes the account switcher', async ({ page }) => {
    await page.goto(selectors.accountURL)
    // isMultiAccount (2 accounts) → showAccountSwitcher renders the "Switch account" pill.
    await expect(page.getByText(selectors.scopeHeader.switchAccount.name).first()).toBeVisible()
  })

  test('switcher lists both accounts', async ({ page }) => {
    await page.goto(selectors.accountURL)
    await page.getByText(selectors.scopeHeader.switchAccount.name).first().click()
    // The dropdown surfaces both linked accounts by name.
    await expect(page.getByText('Main account').first()).toBeVisible()
    await expect(page.getByText('Second account').first()).toBeVisible()
  })

  test('still admin: Users tab shows "Invite user" CTA', async ({ page }) => {
    await page.goto(selectors.accountURL)
    await page.getByRole('tab', selectors.sectionTabs.users).click()
    await expect(page.getByRole('button', selectors.cta.inviteUser).first()).toBeVisible()
  })
})

/* ─────────────────────────── MULTI-ENTITY ─────────────────────────── */

test.describe('Archetype: multi-entity (entity-admin × 2 entities)', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page as CustomPage, me.multiEntity)
  })

  test('scope header exposes the entity switcher', async ({ page }) => {
    await page.goto(selectors.accountURL)
    // isMultiEntity (2 entities) → showEntitySwitcher renders the "Switch entity" pill.
    await expect(page.getByText(selectors.scopeHeader.switchEntity.name).first()).toBeVisible()
  })

  test('switcher lists both entities', async ({ page }) => {
    await page.goto(selectors.accountURL)
    await page.getByText(selectors.scopeHeader.switchEntity.name).first().click()
    await expect(page.getByText('First Entity').first()).toBeVisible()
    await expect(page.getByText('Second Entity').first()).toBeVisible()
  })

  test('entity sections only (overview + users + roles, no entities tab)', async ({ page }) => {
    await page.goto(selectors.accountURL)
    await expect(page.getByRole('tab', selectors.sectionTabs.overview)).toBeVisible()
    await expect(page.getByRole('tab', selectors.sectionTabs.users)).toBeVisible()
    await expect(page.getByRole('tab', selectors.sectionTabs.roles)).toBeVisible()
    await expect(page.getByRole('tab', selectors.sectionTabs.entities)).not.toBeVisible()
  })
})

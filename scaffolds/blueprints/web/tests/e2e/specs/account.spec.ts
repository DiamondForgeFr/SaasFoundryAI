/**
 * Resources
 */
import { expect, Page, Route, test } from '@playwright/test'

/**
 * Dependencies
 */
import { selectors, testApi, testData } from '../selectors/account.se'
import { selectors as authSelectors, testApi as authTestApi } from '../selectors/auth.se'
import { selectors as globaleSelectors } from '../selectors/globale.se'
import { setupApiInterceptor } from '../utils/api-interceptor'

/**
 * Types
 */
interface CustomPage extends Page {
  mockRoute: (url: string, handler: (route: Route) => Promise<void>) => Promise<void>
}

/**
 * Setup authenticated user
 */
async function setupAuthenticatedUser(page: CustomPage, user: 'admin' | 'user') {
  await page.goto('/')

  const meEndpoint = user === 'admin' ? authTestApi.meAdmin : authTestApi.meUser

  await page.mockRoute(meEndpoint.URL, async (route) => {
    await route.fulfill({
      status: meEndpoint.success.status,
      contentType: 'application/json',
      body: JSON.stringify(meEndpoint.success.body)
    })
  })

  await page.evaluate((userData) => {
    localStorage.setItem('authMe', JSON.stringify(userData))
  }, meEndpoint.success.body)
}

/**
 * Tests
 */
test.describe('Account Management Flow', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiInterceptor(page, testApi.interceptorURL)

    await (page as CustomPage).mockRoute(testApi.account.URL, async (route) => {
      await route.fulfill({
        status: testApi.account.success.status,
        contentType: 'application/json',
        body: JSON.stringify(testApi.account.success.body)
      })
    })

    // Empty invitations by default — overridden in Users describe
    await (page as CustomPage).mockRoute(testApi.invitations.URL, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: testApi.invitations.success.status,
          contentType: 'application/json',
          body: JSON.stringify(testApi.invitations.success.bodyEmpty)
        })
      }
    })
  })

  test('should not display account menu item if user has no permission', async ({ page }) => {
    await setupAuthenticatedUser(page as CustomPage, 'user')
    await page.goto(authSelectors.dashboard.URL)

    await page.getByRole('button', authSelectors.dashboard.cta.userMenu).click()
    await expect(page.getByRole('menuitem', authSelectors.dashboard.cta.account)).not.toBeVisible()

    await page.goto(selectors.URL)
    await expect(page).toHaveURL(authSelectors.dashboard.URL)
  })

  test('should display account tabs with overview tab active for admin user', async ({ page }) => {
    await setupAuthenticatedUser(page as CustomPage, 'admin')
    await page.goto(authSelectors.dashboard.URL)

    await page.getByRole('button', authSelectors.dashboard.cta.userMenu).click()
    await page.getByRole('menuitem', authSelectors.dashboard.cta.account).click()

    await expect(page).toHaveURL(selectors.accountOverview.successURL)

    await expect(page.getByRole('tab', selectors.sectionTabs.overview)).toHaveAttribute('data-state', 'active')
    await expect(page.getByRole('tab', selectors.sectionTabs.entities)).toBeVisible()
    await expect(page.getByRole('tab', selectors.sectionTabs.users)).toBeVisible()

    // Overview structural blocks (KPIs + recent users + recent entities + roles)
    await expect(page.getByTestId(selectors.accountOverview.kpis.blockId)).toBeVisible()
    await expect(page.getByTestId(selectors.accountOverview.recentUsers.blockId)).toBeVisible()
    await expect(page.getByTestId(selectors.accountOverview.recentEntities.blockId)).toBeVisible()
    await expect(page.getByTestId(selectors.accountOverview.roles.blockId)).toBeVisible()
  })

  test('should not have translation keys in the page', async ({ page }) => {
    await setupAuthenticatedUser(page as CustomPage, 'admin')
    await page.goto(selectors.URL)
    const elements = await page.$$('text=/.tk_/')
    expect(elements.length).toBe(0)
  })

  test.describe('Account Overview', () => {
    test.beforeEach(async ({ page }) => {
      await setupAuthenticatedUser(page as CustomPage, 'admin')
      await page.goto(selectors.URL)
    })

    test('should display correct breadcrumb', async ({ page }) => {
      const breadcrumb = page.getByLabel(globaleSelectors.breadcrumb.ariaLabel.name)
      const pageDescription = page.getByTestId(globaleSelectors.breadcrumb.blockId)
      await expect(breadcrumb).toBeVisible()
      await expect(breadcrumb.locator('li').first()).toHaveText('Account')
      await expect(breadcrumb.locator('li').last()).toHaveText('Overview')
      await expect(pageDescription).toHaveText('View and manage your account details')
    })

    test('should display KPI row with users / entities / pending', async ({ page }) => {
      const usersKpi = page.getByTestId(selectors.accountOverview.kpis.users.blockId)
      const entitiesKpi = page.getByTestId(selectors.accountOverview.kpis.entities.blockId)
      const pendingKpi = page.getByTestId(selectors.accountOverview.kpis.pending.blockId)

      await expect(usersKpi).toBeVisible()
      await expect(entitiesKpi).toBeVisible()
      await expect(pendingKpi).toBeVisible()

      // The count value is the only "exact" match for the digit (sub-text may contain other digits)
      await expect(usersKpi.getByText(testApi.account.success.body.users.count.toString(), { exact: true })).toBeVisible()
      await expect(entitiesKpi.getByText(testApi.account.success.body.entities.count.toString(), { exact: true })).toBeVisible()
      // Pending card now shows two numbers — invitations · sign-ups (both 0 in the fixture).
      await expect(pendingKpi.getByText('0', { exact: true })).toHaveCount(2)
      await expect(pendingKpi.getByText(/no invitation or sign-up awaiting/i)).toBeVisible()
    })

    test('should display recent users correctly', async ({ page }) => {
      const recentUsersBlock = page.getByTestId(selectors.accountOverview.recentUsers.blockId)

      await expect(recentUsersBlock.getByText(selectors.accountOverview.recentUsers.title)).toBeVisible()

      const rows = recentUsersBlock.getByTestId(selectors.accountOverview.recentUsers.rowId)
      await expect(rows).toHaveCount(testApi.account.success.body.users.values.length)

      const firstUserApi = testApi.account.success.body.users.values[0]
      const firstUserUI = rows.first()

      await expect(firstUserUI.getByText(firstUserApi.email)).toBeVisible()

      // "View all users" CTA visible when there is at least one user
      await expect(recentUsersBlock.getByRole('button', selectors.accountOverview.recentUsers.cta.viewAll)).toBeVisible()
    })

    test('should display recent entities correctly', async ({ page }) => {
      const recentEntitiesBlock = page.getByTestId(selectors.accountOverview.recentEntities.blockId)

      await expect(recentEntitiesBlock.getByText(selectors.accountOverview.recentEntities.title)).toBeVisible()

      const rows = recentEntitiesBlock.getByTestId(selectors.accountOverview.recentEntities.rowId)
      await expect(rows).toHaveCount(testApi.account.success.body.entities.values.length)

      const firstEntityApi = testApi.account.success.body.entities.values[0]
      await expect(rows.first().getByText(new RegExp(firstEntityApi.name))).toBeVisible()

      await expect(recentEntitiesBlock.getByRole('button', selectors.accountOverview.recentEntities.cta.viewAll)).toBeVisible()
    })

    test('should display roles section with all account roles', async ({ page }) => {
      const rolesBlock = page.getByTestId(selectors.accountOverview.roles.blockId)

      await expect(rolesBlock.getByText(selectors.accountOverview.roles.title)).toBeVisible()

      // RolesCard renders up to 6 roles in a grid (built-in roles get translated labels)
      const cards = rolesBlock.getByTestId(selectors.accountOverview.roles.cardId)
      await expect(cards).toHaveCount(testApi.account.success.body.roles.values.length)
    })
  })

  test.describe('Account Entities', () => {
    test.beforeEach(async ({ page }) => {
      await setupAuthenticatedUser(page as CustomPage, 'admin')
      await page.goto(selectors.URL)

      await (page as CustomPage).mockRoute(testApi.entities.URL, async (route) => {
        await route.fulfill({
          status: testApi.entities.success.status,
          contentType: 'application/json',
          body: JSON.stringify(testApi.entities.success.body)
        })
      })

      await page.getByRole('tab', selectors.sectionTabs.entities).click()
    })

    test('should display correct breadcrumb', async ({ page }) => {
      const breadcrumb = page.getByLabel(globaleSelectors.breadcrumb.ariaLabel.name)
      const pageDescription = page.getByTestId(globaleSelectors.breadcrumb.blockId)
      await expect(breadcrumb).toBeVisible()
      await expect(breadcrumb.locator('li').first()).toHaveText('Account')
      await expect(breadcrumb.locator('li').last()).toHaveText('Entities')
      await expect(pageDescription).toHaveText('Manage your business entities and their settings')
      await expect(page).toHaveURL(selectors.accountEntities.successURL)
    })

    test('should not have translation keys in the page', async ({ page }) => {
      const elements = await page.$$('text=/.tk_/')
      expect(elements.length).toBe(0)
    })

    test('should display filters and create CTA', async ({ page }) => {
      await expect(page.getByTestId(globaleSelectors.filters.search.blockId)).toBeVisible()
      await expect(page.getByTestId(globaleSelectors.filters.status.blockId)).toBeVisible()
      await expect(page.getByRole('button', selectors.accountEntities.cta.createEntity)).toBeVisible()
    })

    test('should display entities table with API data', async ({ page }) => {
      const rows = page.getByTestId(selectors.accountEntities.table.rowId)
      await expect(rows).toHaveCount(testApi.entities.success.body.items.length)

      const firstEntity = testApi.entities.success.body.items[0]
      const firstRow = rows.first()

      // Organization name is the primary label, entity name is shown as sub-text when different
      await expect(firstRow.getByText(new RegExp(firstEntity.organization.name))).toBeVisible()
      await expect(firstRow.getByText(new RegExp(firstEntity.name))).toBeVisible()
      await expect(firstRow.getByText(/^Active$/i)).toBeVisible()
    })

    test.describe('Create entity', () => {
      test('should display create entity dialog with organization fields', async ({ page }) => {
        const dialog = page.getByRole('dialog')
        await page.getByRole('button', selectors.accountEntities.cta.createEntity).click()
        await expect(dialog).toBeVisible()

        await expect(dialog.getByText(new RegExp(selectors.accountEntities.newEntityDialog.title.name))).toBeVisible()
        await expect(dialog.getByText(new RegExp(selectors.accountEntities.newEntityDialog.subtitle.name))).toBeVisible()

        const organizationContent = dialog.getByTestId(selectors.accountEntities.newEntityDialog.organization.blockId)
        await expect(organizationContent).toBeVisible()

        // Type cards (Company / Association / Community)
        await expect(organizationContent.getByRole('button', selectors.accountEntities.newEntityDialog.organization.types.company)).toBeVisible()
        await expect(organizationContent.getByRole('button', selectors.accountEntities.newEntityDialog.organization.types.association)).toBeVisible()
        await expect(organizationContent.getByRole('button', selectors.accountEntities.newEntityDialog.organization.types.community)).toBeVisible()

        // Form fields (FloatingLabelInput places the label inside the input wrapper)
        await expect(organizationContent.getByLabel(globaleSelectors.fields.name)).toBeVisible()
        await expect(organizationContent.getByLabel(globaleSelectors.fields.description)).toBeVisible()
        await expect(organizationContent.getByLabel(globaleSelectors.fields.website)).toBeVisible()

        await expect(dialog.getByRole('button', selectors.accountEntities.newEntityDialog.cta.create)).toBeVisible()
      })

      test('should not create entity if form is invalid & raise error message', async ({ page }) => {
        const dialog = page.getByRole('dialog')
        await page.getByRole('button', selectors.accountEntities.cta.createEntity).click()
        await expect(dialog).toBeVisible()

        await dialog.getByRole('button', selectors.accountEntities.newEntityDialog.cta.create).click()

        const organizationContent = dialog.getByTestId(selectors.accountEntities.newEntityDialog.organization.blockId)
        await expect(organizationContent.getByText(globaleSelectors.fields.errors.minLength)).toBeVisible()
      })

      test('should create entity with organization', async ({ page }) => {
        await (page as CustomPage).mockRoute(testApi.createOrganization.URL, async (route) => {
          await route.fulfill({
            status: testApi.createOrganization.success.status,
            contentType: 'application/json',
            body: JSON.stringify(testApi.createOrganization.success.body)
          })
        })

        await (page as CustomPage).mockRoute(testApi.createEntity.URL, async (route) => {
          await route.fulfill({
            status: testApi.createEntity.success.status,
            contentType: 'application/json',
            body: JSON.stringify(testApi.createEntity.success.body)
          })
        })

        await (page as CustomPage).mockRoute(testApi.entities.URL, async (route) => {
          await route.fulfill({
            status: testApi.entities.success.status,
            contentType: 'application/json',
            body: JSON.stringify(testApi.entities.success.body2)
          })
        })

        const dialog = page.getByRole('dialog')
        await page.getByRole('button', selectors.accountEntities.cta.createEntity).click()
        await expect(dialog).toBeVisible()

        const organizationContent = dialog.getByTestId(selectors.accountEntities.newEntityDialog.organization.blockId)
        await organizationContent.getByLabel(globaleSelectors.fields.name).fill(testData.organizationName2)
        await organizationContent.getByLabel(globaleSelectors.fields.description).fill(testData.organizationDescription2)

        await dialog.getByRole('button', selectors.accountEntities.newEntityDialog.cta.create).click()
        await expect(dialog).not.toBeVisible({ timeout: 5000 })

        const rows = page.getByTestId(selectors.accountEntities.table.rowId)
        await expect(rows).toHaveCount(testApi.entities.success.body2.items.length)
      })
    })
  })

  test.describe('Account Users', () => {
    test.beforeEach(async ({ page }) => {
      await setupAuthenticatedUser(page as CustomPage, 'admin')
      await page.goto(selectors.URL)

      await (page as CustomPage).mockRoute(testApi.entities.URL, async (route) => {
        await route.fulfill({
          status: testApi.entities.success.status,
          contentType: 'application/json',
          body: JSON.stringify(testApi.entities.success.body)
        })
      })

      await (page as CustomPage).mockRoute(testApi.roles.URL, async (route) => {
        await route.fulfill({
          status: testApi.roles.success.status,
          contentType: 'application/json',
          body: JSON.stringify(testApi.roles.success.body)
        })
      })

      await (page as CustomPage).mockRoute(testApi.invitations.URL, async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({
            status: testApi.invitations.success.status,
            contentType: 'application/json',
            body: JSON.stringify(testApi.invitations.success.body)
          })
        }
      })

      await (page as CustomPage).mockRoute(testApi.users.URL, async (route) => {
        await route.fulfill({
          status: testApi.users.success.status,
          contentType: 'application/json',
          body: JSON.stringify(testApi.users.success.body)
        })
      })

      await page.getByRole('tab', selectors.sectionTabs.users).click()
    })

    test('should display correct breadcrumb', async ({ page }) => {
      const breadcrumb = page.getByLabel(globaleSelectors.breadcrumb.ariaLabel.name)
      const pageDescription = page.getByTestId(globaleSelectors.breadcrumb.blockId)
      await expect(breadcrumb).toBeVisible()
      await expect(breadcrumb.locator('li').first()).toHaveText('Account')
      await expect(breadcrumb.locator('li').last()).toHaveText('Users')
      await expect(pageDescription).toHaveText('Manage your team members and their permissions')
      await expect(page).toHaveURL(selectors.accountUsers.successURL)
    })

    test('should not have translation keys in the page', async ({ page }) => {
      const elements = await page.$$('text=/.tk_/')
      expect(elements.length).toBe(0)
    })

    // Reworked Users page: the legacy `directUsers` switch filter was replaced by the
    // "account-linked" KPI filter card. The search / status / entities / roles filters and the
    // invite CTA stay; assert those plus the KPI filter row that took the switch's place.
    test('should display filters and invite CTA', async ({ page }) => {
      await expect(page.getByTestId(globaleSelectors.filters.search.blockId)).toBeVisible()
      await expect(page.getByTestId(globaleSelectors.filters.status.blockId)).toBeVisible()
      await expect(page.getByTestId(globaleSelectors.filters.entities.blockId)).toBeVisible()
      await expect(page.getByTestId(globaleSelectors.filters.roles.blockId)).toBeVisible()
      await expect(page.getByRole('button', selectors.accountUsers.cta.inviteUser)).toBeVisible()
    })

    test('should display users table with API data', async ({ page }) => {
      const rows = page.getByTestId(selectors.accountUsers.table.rowId)
      await expect(rows).toHaveCount(testApi.users.success.body.items.length)

      const firstUser = testApi.users.success.body.items[0]
      const firstRow = rows.first()

      await expect(firstRow.getByText(`${firstUser.people.firstname} ${firstUser.people.lastname}`)).toBeVisible()
      await expect(firstRow.getByText(firstUser.email)).toBeVisible()
      await expect(firstRow.getByText(/^Active$/i)).toBeVisible()
    })

    test.describe('Invite user', () => {
      test('should display invite user dialog', async ({ page }) => {
        const dialog = page.getByRole('dialog')
        await page.getByRole('button', selectors.accountUsers.cta.inviteUser).click()
        await expect(dialog).toBeVisible()

        await expect(dialog.getByRole('heading', selectors.accountUsers.inviteUserDialog.title)).toBeVisible()

        // Section markers (A — Who? / B — Access scope / C — Roles)
        await expect(dialog.getByText(selectors.accountUsers.inviteUserDialog.sections.who)).toBeVisible()
        await expect(dialog.getByText(selectors.accountUsers.inviteUserDialog.sections.accessScope)).toBeVisible()
        await expect(dialog.getByText(selectors.accountUsers.inviteUserDialog.sections.roles)).toBeVisible()

        // Form fields
        await expect(dialog.getByLabel(globaleSelectors.fields.email)).toBeVisible()
        await expect(dialog.getByLabel(globaleSelectors.fields.firstname)).toBeVisible()
        await expect(dialog.getByLabel(globaleSelectors.fields.lastname)).toBeVisible()

        // Access scope: account access tile + entities list (entity-scope role gating drives the
        // role tiles below — the account-admin flow shows the "Account access" tile + per-account entities).
        await expect(dialog.getByTestId(selectors.accountUsers.inviteUserDialog.accessScope.accountAccessId)).toBeVisible()
        const entityTiles = dialog.getByTestId(selectors.accountUsers.inviteUserDialog.accessScope.entityTileId)
        await expect(entityTiles).toHaveCount(testApi.entities.success.body.items.length)

        // Roles list block is always present; the reworked dialog only reveals role tiles once a
        // scope is picked. Selecting "Account access" surfaces the ACCOUNT-scoped roles
        // (guest is filtered out, PLATFORM-scoped roles are not offered in the account flow).
        const rolesList = dialog.getByTestId(selectors.accountUsers.inviteUserDialog.roles.blockId)
        await expect(rolesList).toBeVisible()
        await dialog.getByTestId(selectors.accountUsers.inviteUserDialog.accessScope.accountAccessId).click()
        const roleTiles = rolesList.getByTestId(selectors.accountUsers.inviteUserDialog.roles.tileId)
        const accountScopedRoles = testApi.roles.success.body.items.filter((r) => r.name.toLowerCase() !== 'guest' && r.scope === 'ACCOUNT')
        await expect(roleTiles).toHaveCount(accountScopedRoles.length)

        await expect(dialog.getByRole('button', selectors.accountUsers.inviteUserDialog.cta.invite)).toBeVisible()
      })

      test('should not invite user if form is invalid & raise error messages', async ({ page }) => {
        const dialog = page.getByRole('dialog')
        await page.getByRole('button', selectors.accountUsers.cta.inviteUser).click()
        await expect(dialog).toBeVisible()

        await dialog.getByRole('button', selectors.accountUsers.inviteUserDialog.cta.invite).click()

        // Email field error (minLength on empty input)
        await expect(dialog.getByText(globaleSelectors.fields.errors.minLength).first()).toBeVisible()
      })

      // Reworked invite flow: the access scope is picked first (an entity tile here), which is
      // sufficient to submit — roles are optional in the payload and ENTITY-scoped roles only
      // surface once an entity is selected. Picking the entity then submitting closes the dialog.
      test('should invite user in entity', async ({ page }) => {
        await (page as CustomPage).mockRoute(testApi.inviteUser.URL, async (route) => {
          if (route.request().method() === 'POST') {
            await route.fulfill({
              status: testApi.inviteUser.success.status,
              contentType: 'application/json',
              body: JSON.stringify(testApi.inviteUser.success.body)
            })
          }
        })

        const dialog = page.getByRole('dialog')
        await page.getByRole('button', selectors.accountUsers.cta.inviteUser).click()
        await expect(dialog).toBeVisible()

        await dialog.getByLabel(globaleSelectors.fields.email).fill(testData.userEmail)
        await dialog.getByLabel(globaleSelectors.fields.firstname).fill(testData.userFirstName)
        await dialog.getByLabel(globaleSelectors.fields.lastname).fill(testData.userLastName)

        // Pick the first entity tile — defines the access scope for the invitation.
        const entityTiles = dialog.getByTestId(selectors.accountUsers.inviteUserDialog.accessScope.entityTileId)
        await entityTiles.first().click()

        await dialog.getByRole('button', selectors.accountUsers.inviteUserDialog.cta.invite).click()
        await expect(dialog).not.toBeVisible({ timeout: 5000 })
      })
    })
  })
})

import { test, expect, observeLivePage } from '../fixtures'
import { signInBrowser } from '../support/api'
import { expectRowCount, queryRows } from '../support/assertions'
import { LIVE_NEW_PASSWORD, LIVE_PASSWORD, liveIdentity, liveName } from '../support/data'
import { messageLink, resetMailbox, waitForMail } from '../support/mailbox'

test.describe.serial('live users, roles and scope switching', () => {
  test('platform admin creates a role, account admin invites a scoped user and scope persists @full', async ({ browser, livePage: adminPage, contract }) => {
    const owner = liveIdentity(contract, 'owner')
    const member = liveIdentity(contract, 'member')
    const entityMember = liveIdentity(contract, 'entity-member')
    const admin = liveIdentity(contract, 'admin')
    const accountName = liveName(contract, 'owner account')
    const entityName = liveName(contract, 'company')
    const roleName = `LC ${contract.topology} ${contract.phase} viewer`
    const accounts = await queryRows<{ id: string }>(contract, 'SELECT id FROM public.accounts WHERE name = $1', [accountName])
    const accountId = accounts[0]?.id
    expect(accountId).toBeTruthy()
    const entities = await queryRows<{ id: string }>(
      contract,
      `SELECT entity.id
       FROM public.entities entity
       INNER JOIN public.organizations organization ON organization.entity_id = entity.id
       WHERE organization.name = $1`,
      [entityName]
    )
    const entityId = entities[0]?.id
    expect(entityId).toBeTruthy()
    const entityRoles = await queryRows<{ id: number }>(contract, "SELECT id FROM public.roles WHERE name = 'entity-user' AND scope = 'ENTITY'", [])
    const entityUserRoleId = entityRoles[0]?.id
    expect(entityUserRoleId).toBeTruthy()

    await signInBrowser(adminPage, admin.email, LIVE_NEW_PASSWORD)
    await adminPage.goto('/account?tab=accounts')
    await adminPage.getByTestId(`account-card-${accountId}`).click()
    await expect.poll(() => adminPage.evaluate(() => sessionStorage.getItem('currentScopeOverride'))).toBe(`PLATFORM::${accountId}`)
    await adminPage.goto('/account?tab=roles')
    await adminPage.getByTestId('new-role-button').click()
    await adminPage.getByTestId('role-name').fill(roleName)
    await adminPage.getByTestId('role-description').fill('Read-only lifecycle role')
    const accountModule = adminPage.getByTestId('role-module-ACCOUNT_ADMINISTRATION')
    await expect(accountModule).toBeVisible()
    await accountModule.getByRole('button').first().click()
    await adminPage.getByTestId('role-section-OVERVIEW').click()
    await adminPage.getByTestId('role-submit').click()
    await expect(adminPage.getByTestId('role-editor')).toBeHidden()

    await expectRowCount(
      contract,
      `SELECT COUNT(*)
       FROM public.roles role
       INNER JOIN public.roles_sub_modules_links role_section ON role_section.role_id = role.id
       INNER JOIN public.sub_modules section ON section.id = role_section.sub_module_id
       INNER JOIN public.accounts account ON account.id = role.account_id
       WHERE role.name = $1 AND role.scope = 'ACCOUNT' AND role.is_active = TRUE
         AND section.name = 'OVERVIEW' AND account.name = $2`,
      [roleName, accountName],
      1
    )

    const ownerContext = await browser.newContext({ baseURL: contract.webUrl })
    try {
      const ownerPage = await ownerContext.newPage()
      const ownerFailures = await observeLivePage(ownerPage, contract)
      await signInBrowser(ownerPage, owner.email, LIVE_PASSWORD)
      await resetMailbox(contract)
      await ownerPage.goto('/account?tab=users')
      await ownerPage.getByTestId('invite-user-button').click()
      const invitationDialog = ownerPage.getByTestId('invite-user-dialog')
      await invitationDialog.getByTestId('invite-user-email').fill(member.email)
      await invitationDialog.getByTestId('invite-user-firstname').fill(member.firstName)
      await invitationDialog.getByTestId('invite-user-lastname').fill(member.lastName)
      await invitationDialog.getByTestId('invite-account-access').click()
      const customRole = invitationDialog.getByTestId('invite-role-tile').filter({ hasText: roleName })
      await expect(customRole).toBeVisible()
      await customRole.click()
      await invitationDialog.getByTestId('invite-user-submit').click()
      await expect(invitationDialog).toBeHidden()

      const invitation = await waitForMail(contract, member.email)
      const memberContext = await browser.newContext({ baseURL: contract.webUrl })
      try {
        const memberPage = await memberContext.newPage()
        const memberFailures = await observeLivePage(memberPage, contract)
        await memberPage.goto(messageLink(invitation, '/user-invitation'))
        await memberPage.getByLabel(/First name/i).fill(member.firstName)
        await memberPage.getByLabel(/Last name/i).fill(member.lastName)
        await memberPage.getByLabel(/^New password$/i).fill(LIVE_PASSWORD)
        await memberPage.getByRole('button', { name: /Accept.*sign in/i }).click()
        await expect(memberPage).toHaveURL(/\/dashboard$/)
        const memberAccess = await memberPage.evaluate(async (id) => {
          const [overview, entitiesResponse, platform] = await Promise.all([
            fetch(`/api/accounts/${id}`, { credentials: 'include' }),
            fetch(`/api/accounts/${id}/entities`, { credentials: 'include' }),
            fetch('/api/accounts/platform/modules', { credentials: 'include' })
          ])
          return { overview: overview.status, entities: entitiesResponse.status, platform: platform.status }
        }, accountId!)
        expect(memberAccess).toEqual({ overview: 200, entities: 403, platform: 403 })
        expect(memberFailures, 'Invited member browser/runtime failures were observed').toEqual([])
      } finally {
        await memberContext.close()
      }

      await expectRowCount(
        contract,
        `SELECT COUNT(*)
       FROM public.users_roles_assignments assignment
       INNER JOIN public.users user_account ON user_account.id = assignment.user_id
       INNER JOIN public.roles role ON role.id = assignment.role_id
       INNER JOIN public.accounts account ON account.id = assignment.account_id
       WHERE user_account.email = $1 AND user_account.is_active = TRUE
         AND role.name = $2 AND account.name = $3 AND assignment.entity_id IS NULL`,
        [member.email, roleName, accountName],
        1
      )
      await ownerPage.reload()
      await expect(ownerPage.getByTestId('user-row').filter({ hasText: member.email })).toBeVisible()

      await resetMailbox(contract)
      await ownerPage.getByTestId('invite-user-button').click()
      const entityDialog = ownerPage.getByTestId('invite-user-dialog')
      await entityDialog.getByTestId('invite-user-email').fill(entityMember.email)
      await entityDialog.getByTestId('invite-user-firstname').fill(entityMember.firstName)
      await entityDialog.getByTestId('invite-user-lastname').fill(entityMember.lastName)
      await entityDialog.getByTestId('invite-entity-tile').filter({ hasText: entityName }).click()
      const entityUserRole = entityDialog.locator(`[data-testid="invite-role-tile"][data-role-id="${entityUserRoleId}"]`)
      await expect(entityUserRole).toBeVisible()
      await entityUserRole.click()
      await entityDialog.getByTestId('invite-user-submit').click()
      await expect(entityDialog).toBeHidden()

      const entityInvitation = await waitForMail(contract, entityMember.email)
      const entityContext = await browser.newContext({ baseURL: contract.webUrl })
      try {
        const entityPage = await entityContext.newPage()
        const entityFailures = await observeLivePage(entityPage, contract)
        await entityPage.goto(messageLink(entityInvitation, '/user-invitation'))
        await entityPage.getByLabel(/First name/i).fill(entityMember.firstName)
        await entityPage.getByLabel(/Last name/i).fill(entityMember.lastName)
        await entityPage.getByLabel(/^New password$/i).fill(LIVE_PASSWORD)
        await entityPage.getByRole('button', { name: /Accept.*sign in/i }).click()
        await expect(entityPage).toHaveURL(/\/dashboard$/)
        const entityAccess = await entityPage.evaluate(async (id) => {
          const [overview, entitiesResponse] = await Promise.all([fetch(`/api/accounts/${id}`, { credentials: 'include' }), fetch(`/api/accounts/${id}/entities`, { credentials: 'include' })])
          return { overview: overview.status, entities: entitiesResponse.status }
        }, accountId!)
        expect(entityAccess).toEqual({ overview: 200, entities: 403 })
        await entityPage.goto('/account')
        await expect(entityPage.getByRole('tab', { name: /Overview/i })).toBeVisible()
        await expect(entityPage.getByRole('tab', { name: /Entities/i })).toHaveCount(0)
        expect(entityFailures, 'Entity-scoped member browser/runtime failures were observed').toEqual([])
      } finally {
        await entityContext.close()
      }

      await expectRowCount(
        contract,
        `SELECT COUNT(*)
         FROM public.users_roles_assignments assignment
         INNER JOIN public.users user_account ON user_account.id = assignment.user_id
         INNER JOIN public.roles role ON role.id = assignment.role_id
         WHERE user_account.email = $1 AND role.name = 'entity-user'
           AND assignment.account_id IS NULL AND assignment.entity_id = $2`,
        [entityMember.email, entityId],
        1
      )
      expect(ownerFailures, 'Account admin browser/runtime failures were observed').toEqual([])
    } finally {
      await ownerContext.close()
    }

    await adminPage.reload()
    await expect(adminPage.getByText(accountName, { exact: true }).first()).toBeVisible()
    await expect(adminPage.evaluate(() => sessionStorage.getItem('currentScopeOverride'))).resolves.toBe(`PLATFORM::${accountId}`)
  })
})

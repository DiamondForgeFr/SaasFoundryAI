import { test, expect, observeLivePage } from '../fixtures'
import { assertApiStatus, apiJson, signInBrowser } from '../support/api'
import { expectRowCount, queryRows } from '../support/assertions'
import { LIVE_NEW_PASSWORD, LIVE_PASSWORD, liveIdentity, liveName } from '../support/data'
import { messageLink, resetMailbox, waitForMail } from '../support/mailbox'

test.describe.serial('live account-owner invitation', () => {
  test('platform admin invitation provisions an isolated account and is single use @smoke', async ({ browser, livePage: adminPage, contract, request }) => {
    const admin = liveIdentity(contract, 'admin')
    const owner = liveIdentity(contract, 'owner')
    const accountName = liveName(contract, 'owner account')

    await signInBrowser(adminPage, admin.email, LIVE_NEW_PASSWORD)
    await resetMailbox(contract)
    await adminPage.goto('/account?tab=accounts')
    await adminPage.getByRole('button', { name: /Invite account owner/i }).click()

    const dialog = adminPage.getByRole('dialog')
    await dialog.getByLabel(/Email/i).fill(owner.email)
    await dialog.getByLabel(/First name/i).fill(owner.firstName)
    await dialog.getByLabel(/Last name/i).fill(owner.lastName)
    await dialog.getByLabel(/Suggested account name/i).fill(accountName)
    await dialog.getByRole('button', { name: /Send invitation/i }).click()
    await expect(dialog).toBeHidden()

    const invitation = await waitForMail(contract, owner.email)
    const invitationLink = messageLink(invitation, '/user-invitation')
    const invitationToken = new URL(invitationLink).searchParams.get('invitationToken')
    expect(invitationToken).toBeTruthy()

    const ownerContext = await browser.newContext({ baseURL: contract.webUrl })
    try {
      const ownerPage = await ownerContext.newPage()
      const failures = await observeLivePage(ownerPage, contract)
      await ownerPage.goto(invitationLink)
      await ownerPage.getByLabel(/First name/i).fill(owner.firstName)
      await ownerPage.getByLabel(/Last name/i).fill(owner.lastName)
      await ownerPage.getByLabel(/^New password$/i).fill(LIVE_PASSWORD)
      await ownerPage.getByRole('button', { name: /Accept.*sign in/i }).click()
      await expect(ownerPage).toHaveURL(/\/dashboard$/)
      expect(failures, 'Invited owner browser/runtime failures were observed').toEqual([])
    } finally {
      await ownerContext.close()
    }

    await expectRowCount(contract, 'SELECT COUNT(*) FROM public.users WHERE email = $1 AND is_active = TRUE', [owner.email], 1)
    await expectRowCount(contract, 'SELECT COUNT(*) FROM public.accounts WHERE name = $1 AND is_active = TRUE', [accountName], 1)
    const assignments = await queryRows<{ role_name: string; account_name: string | null }>(
      contract,
      `SELECT role.name AS role_name, account.name AS account_name
       FROM public.users_roles_assignments assignment
       INNER JOIN public.users user_account ON user_account.id = assignment.user_id
       INNER JOIN public.roles role ON role.id = assignment.role_id
       LEFT JOIN public.accounts account ON account.id = assignment.account_id
       WHERE user_account.email = $1`,
      [owner.email]
    )
    expect(assignments).toContainEqual({ role_name: 'account-admin', account_name: accountName })

    const reused = await apiJson<unknown>(request, contract, 'post', '/invitations/accept', {
      invitationToken,
      password: LIVE_PASSWORD,
      firstname: owner.firstName,
      lastname: owner.lastName
    })
    await assertApiStatus(reused.response, 404)
    await expectRowCount(contract, 'SELECT COUNT(*) FROM public.users WHERE email = $1', [owner.email], 1)
    await expectRowCount(contract, 'SELECT COUNT(*) FROM public.accounts WHERE name = $1', [accountName], 1)
  })
})

import { test, expect } from '../fixtures'
import { signInBrowser } from '../support/api'
import { queryRows } from '../support/assertions'
import { LIVE_PASSWORD, liveIdentity, liveName } from '../support/data'

test.describe.serial('live RBAC and tenant scope', () => {
  test('account admin is denied platform reach and foreign-account data @smoke', async ({ livePage: page, contract }) => {
    const owner = liveIdentity(contract, 'owner')
    const accountName = liveName(contract, 'owner account')
    const foreignAccountId = `lifecycle-foreign-${contract.topology}-${contract.phase}`
    const foreignAccountName = liveName(contract, 'foreign account')

    await queryRows(
      contract,
      `INSERT INTO public.accounts (id, name, is_active, created_at, updated_at)
       VALUES ($1, $2, TRUE, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = TRUE`,
      [foreignAccountId, foreignAccountName]
    )

    await signInBrowser(page, owner.email, LIVE_PASSWORD)

    const platformStatus = await page.evaluate(async () => {
      const response = await fetch('/api/accounts/platform/modules', { credentials: 'include' })
      return response.status
    })
    expect(platformStatus).toBe(403)

    const foreignAccountResponse = await page.evaluate(async (accountId) => {
      const response = await fetch(`/api/accounts/${accountId}/entities`, { credentials: 'include' })
      return { status: response.status, text: await response.text() }
    }, foreignAccountId)
    expect(foreignAccountResponse.status).toBe(401)
    expect(foreignAccountResponse.text).not.toContain(foreignAccountName)

    await page.goto('/platform/modules')
    await expect(page).not.toHaveURL(/\/platform\/modules$/)

    await page.goto('/account?tab=accounts')
    await expect(page.getByRole('button', { name: /Invite account owner/i })).toHaveCount(0)
    await expect(page.getByText(accountName, { exact: true }).first()).toBeVisible()

    const scopedAssignments = await queryRows<{ role_name: string; account_name: string | null }>(
      contract,
      `SELECT role.name AS role_name, account.name AS account_name
       FROM public.users_roles_assignments assignment
       INNER JOIN public.users user_account ON user_account.id = assignment.user_id
       INNER JOIN public.roles role ON role.id = assignment.role_id
       LEFT JOIN public.accounts account ON account.id = assignment.account_id
       WHERE user_account.email = $1`,
      [owner.email]
    )
    expect(scopedAssignments).toEqual([{ role_name: 'account-admin', account_name: accountName }])
  })
})

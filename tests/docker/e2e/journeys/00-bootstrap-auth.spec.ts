import { test, expect } from '../fixtures'
import { assertApiStatus, apiJson } from '../support/api'
import { expectRowCount, queryRows } from '../support/assertions'
import { LIVE_NEW_PASSWORD, LIVE_PASSWORD, liveIdentity } from '../support/data'
import { messageLink, resetMailbox, waitForMail } from '../support/mailbox'

test.describe.serial('live bootstrap and authentication', () => {
  test('browser signup, confirmation, session and password reset @smoke', async ({ livePage: page, contract, request }) => {
    const identity = liveIdentity(contract, 'admin')
    await resetMailbox(contract)

    await page.goto('/signup')
    await page.getByLabel(/Email/i).fill(identity.email)
    await page.getByLabel(/^Password/i).fill(LIVE_PASSWORD)
    const signupResponsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/auth/signup')
    await page.getByRole('button', { name: /^Sign up$/i }).click()
    const signupResponse = await signupResponsePromise
    expect(signupResponse.status(), await signupResponse.text()).toBe(200)
    await expect(page.getByText(/Account created successfully/i)).toBeVisible({ timeout: 10_000 })

    const confirmation = await waitForMail(contract, identity.email)
    await page.goto(messageLink(confirmation, '/signin'))
    await page.getByLabel(/First name/i).fill(identity.firstName)
    await page.getByLabel(/Last name/i).fill(identity.lastName)
    const accountName = page.getByLabel(/Account name/i)
    if (await accountName.isVisible().catch(() => false)) await accountName.fill(`Lifecycle ${contract.topology} account`)
    await page.getByLabel(/^Password/i).fill(LIVE_PASSWORD)
    await page.getByRole('button', { name: /^Sign in$/i }).click()
    await expect(page).toHaveURL(/\/dashboard$/)

    await expectRowCount(contract, 'SELECT COUNT(*) FROM public.users WHERE email = $1 AND is_active = TRUE', [identity.email], 1)
    const roles = await queryRows<{ name: string }>(
      contract,
      `SELECT role.name
       FROM public.users_roles_assignments assignment
       INNER JOIN public.users user_account ON user_account.id = assignment.user_id
       INNER JOIN public.roles role ON role.id = assignment.role_id
       WHERE user_account.email = $1`,
      [identity.email]
    )
    expect(roles.map((role) => role.name)).toContain('platform-admin')

    await page.getByRole('button', { name: new RegExp(`${identity.firstName} ${identity.lastName}`, 'i') }).click()
    await page.getByRole('menuitem', { name: /Sign out/i }).click()
    await expect(page).toHaveURL(/\/signin$/)

    await resetMailbox(contract)
    await page.goto('/reset-password-request')
    await page.getByLabel(/Email/i).fill(identity.email)
    await page.getByRole('button', { name: /Send reset password link/i }).click()
    await expect(page.getByText(/Reset link sent/i)).toBeVisible()
    const reset = await waitForMail(contract, identity.email)
    const resetLink = messageLink(reset, '/reset-password')
    const resetToken = new URL(resetLink).searchParams.get('resetPasswordToken')
    expect(resetToken).toBeTruthy()
    await page.goto(resetLink)
    await page.getByLabel(/^New password$/i).fill(LIVE_NEW_PASSWORD)
    await page.getByLabel(/Confirm password/i).fill(LIVE_NEW_PASSWORD)
    await page.getByRole('button', { name: /Update password/i }).click()
    await expect(page.getByText(/Password updated successfully/i)).toBeVisible()

    const oldSignin = await apiJson<unknown>(request, contract, 'post', '/auth/signin', { email: identity.email, password: LIVE_PASSWORD })
    await assertApiStatus(oldSignin.response, 401)
    const newSignin = await apiJson<unknown>(request, contract, 'post', '/auth/signin', { email: identity.email, password: LIVE_NEW_PASSWORD })
    await assertApiStatus(newSignin.response, 200)
    const reused = await apiJson<unknown>(request, contract, 'post', '/auth/reset-password', { resetPasswordToken: resetToken, password: LIVE_PASSWORD, confirmPassword: LIVE_PASSWORD })
    await assertApiStatus(reused.response, 404)
  })
})

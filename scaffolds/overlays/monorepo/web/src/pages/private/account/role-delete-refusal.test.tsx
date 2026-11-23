/**
 * Resources
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

/**
 * Dependencies
 */
import { roleDeleteRefusalOf } from '@/pages/private/account/role-delete-refusal'
import { RoleDeleteRefusalNotice } from '@/pages/private/account/role-delete-refusal-notice'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

/** The error both API clients throw on a non-2xx answer: the message, the HTTP status and the response body. */
const apiError = (status: number, message: string) => Object.assign(new Error(message), { status, body: { statusCode: status, message } })

/**
 * Declaration
 */
describe('role delete refusal (#1221)', () => {
  const inUse = 'ROLE_IN_USE: the role "support" is still assigned to alice@acme.test (Acme Lyon). To delete it, first unassign it.'

  it('reads a 409 ROLE_IN_USE as a role still in use, and keeps the holders the API names', () => {
    expect(roleDeleteRefusalOf(apiError(409, inUse))).toEqual({
      kind: 'in-use',
      detail: 'the role "support" is still assigned to alice@acme.test (Acme Lyon). To delete it, first unassign it.'
    })
  })

  it('reads any other failure as a failed delete, with the API message', () => {
    expect(roleDeleteRefusalOf(apiError(403, 'This role is used in an entity you do not administer'))).toEqual({
      kind: 'failed',
      detail: 'This role is used in an entity you do not administer'
    })
    expect(roleDeleteRefusalOf(undefined)).toEqual({ kind: 'failed', detail: '' })
  })

  it('shows the in-use heading and the holders in the sheet', () => {
    render(<RoleDeleteRefusalNotice refusal={roleDeleteRefusalOf(apiError(409, inUse))} />)

    const notice = screen.getByTestId('role-delete-refusal')
    expect(notice.getAttribute('role')).toBe('alert')
    expect(screen.getByText('roles.tk_delete-in-use_')).toBeTruthy()
    expect(screen.getByText(/alice@acme\.test \(Acme Lyon\)/)).toBeTruthy()
  })

  it('shows the generic heading for another failure', () => {
    render(<RoleDeleteRefusalNotice refusal={{ kind: 'failed', detail: '' }} />)

    expect(screen.getByText('roles.tk_delete-failed_')).toBeTruthy()
  })
})

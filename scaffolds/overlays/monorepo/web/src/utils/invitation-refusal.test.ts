/**
 * Resources
 */
import { describe, expect, it } from 'vitest'

/**
 * Dependencies
 */
import { invitationRefusalOf } from '@/utils/invitation-refusal'

/** The error both API clients throw on a non-2xx answer: the message, the HTTP status and the response body. */
const apiError = (status: number, message: string) => Object.assign(new Error(message), { status, body: { statusCode: status, message } })

/**
 * Declaration
 */
describe('invitation refusal (#988)', () => {
  const alreadyActive = 'USER_ALREADY_ACTIVE: alice@acme.test already has an active account. An invitation only onboards a new user, so none was sent and nothing was changed.'

  it('reads a 409 USER_ALREADY_ACTIVE as an address that already has an active account', () => {
    expect(invitationRefusalOf(apiError(409, alreadyActive))).toEqual({
      kind: 'already-active',
      detail: 'alice@acme.test already has an active account. An invitation only onboards a new user, so none was sent and nothing was changed.'
    })
  })

  it('reads any other failure as a failed invitation, with the API message', () => {
    expect(invitationRefusalOf(apiError(403, 'You do not have permission to invite users to account a1'))).toEqual({
      kind: 'failed',
      detail: 'You do not have permission to invite users to account a1'
    })
    expect(invitationRefusalOf(undefined)).toEqual({ kind: 'failed', detail: '' })
  })
})

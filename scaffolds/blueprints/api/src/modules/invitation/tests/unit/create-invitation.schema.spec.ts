/**
 * Dependencies
 */
import { buildCreateInvitationPayloadSchema } from '@shared-validation/invitation'

/**
 * Each target of an invitation costs authorization work, so the lists are bounded in the schema: a request
 * cannot ask for thousands of accounts, entities or roles.
 */
describe('create invitation payload (bounded id lists)', () => {
  const schema = buildCreateInvitationPayloadSchema()
  const ids = (count: number) => Array.from({ length: count }, (_, index) => `id-${index}`)

  it('accepts the maximum number of accounts, entities and roles', () => {
    const result = schema.safeParse({ email: 'invitee@example.com', accountIds: ids(100), entityIds: ids(100), roleIds: Array.from({ length: 20 }, (_, index) => index + 1) })

    expect(result.success).toBe(true)
  })

  it.each([
    ['accountIds', { accountIds: ids(101) }],
    ['entityIds', { entityIds: ids(101) }],
    ['roleIds', { roleIds: Array.from({ length: 21 }, (_, index) => index + 1) }]
  ])('rejects more than the maximum in %s', (field, extra) => {
    const result = schema.safeParse({ email: 'invitee@example.com', ...extra })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].path).toEqual([field])
  })
})

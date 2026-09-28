import { startProviderFixture } from '../../../../tests/docker/lifecycle/provider-fixture'

describe('lifecycle provider fixture', () => {
  it('captures bounded messages behind a bearer capability and resets deterministically', async () => {
    const fixture = await startProviderFixture()
    const authorization = { authorization: `Bearer ${fixture.capability}`, 'content-type': 'application/json' }
    try {
      const forbidden = await fetch(`${fixture.url}/messages`)
      expect(forbidden.status).toBe(403)

      const captured = await fetch(`${fixture.url}/messages`, {
        method: 'POST',
        headers: authorization,
        body: JSON.stringify({ to: 'owner@example.test', subject: 'Invitation', html: '<a href="http://127.0.0.1/invite">Invite</a>', text: 'Invite' })
      })
      expect(captured.status).toBe(201)

      const response = await fetch(`${fixture.url}/messages?to=owner%40example.test`, { headers: authorization })
      const body = (await response.json()) as { messages: Array<{ id: number; to: string; subject: string }> }
      expect(body.messages).toEqual([expect.objectContaining({ id: 1, to: 'owner@example.test', subject: 'Invitation' })])
      expect(fixture.messages).toHaveLength(1)

      fixture.reset()
      expect(fixture.messages).toEqual([])
    } finally {
      await fixture.stop()
      await fixture.stop()
    }
  })

  it('rejects malformed and oversized message envelopes', async () => {
    const fixture = await startProviderFixture()
    const headers = { authorization: `Bearer ${fixture.capability}`, 'content-type': 'application/json' }
    try {
      const malformed = await fetch(`${fixture.url}/messages`, { method: 'POST', headers, body: JSON.stringify({ to: 42 }) })
      expect(malformed.status).toBe(400)
      const oversized = await fetch(`${fixture.url}/messages`, { method: 'POST', headers, body: JSON.stringify({ to: 'a@example.test', subject: 'x', html: 'x'.repeat(129 * 1024) }) })
      expect(oversized.status).toBe(400)
      expect(fixture.messages).toEqual([])
    } finally {
      await fixture.stop()
    }
  })
})

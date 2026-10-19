import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

import { enableAgents, readDelegation, recordDelegation, refreshAgents } from '../../../harness/agent-support'
import { isTicketDeliveryDecision, resolveDelegation, validateDelegation } from '../../../harness/delegation'

const MANIFEST = {
  version: '1.0.0-beta',
  projectName: 'managed',
  structure: 'cli',
  modules: { harness: { version: 4, managed: true, agents: ['claude-code'] } },
  fileHashes: { 'unrelated.txt': 'preserve-me' }
}

describe('ticket delivery delegation consent (#1026)', () => {
  let root: string
  const put = async (path: string, content: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
  const get = (path: string) => readFile(join(root, path), 'utf8')
  const manifest = async () => JSON.parse(await get('.saasfoundry.json'))
  const at = (iso: string) => () => new Date(iso)

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sf-delegation-'))
    await put('.saasfoundry.json', JSON.stringify(MANIFEST, null, 2) + '\n')
  })
  afterEach(async () => rm(root, { recursive: true, force: true }))

  describe('the recorded block', () => {
    it('accepts the two decisions and refuses anything else', () => {
      expect(isTicketDeliveryDecision('allowed')).toBe(true)
      expect(isTicketDeliveryDecision('declined')).toBe(true)
      expect(isTicketDeliveryDecision('allow')).toBe(false)
      expect(isTicketDeliveryDecision(undefined)).toBe(false)
    })

    it.each([
      ['a non-object', 'allowed', 'expected an object'],
      ['an array', [], 'expected an object'],
      ['an unknown decision', { ticketDelivery: 'maybe', decidedAt: '2026-10-19T10:00:00.000Z' }, 'ticketDelivery must be allowed or declined'],
      ['a missing date', { ticketDelivery: 'allowed' }, 'decidedAt must be an ISO-8601 date-time'],
      ['a date that is not ISO-8601', { ticketDelivery: 'allowed', decidedAt: 'yesterday' }, 'decidedAt must be an ISO-8601 date-time'],
      ['a calendar date without a time', { ticketDelivery: 'allowed', decidedAt: '2026-10-19' }, 'decidedAt must be an ISO-8601 date-time'],
      ['an unknown key', { ticketDelivery: 'allowed', decidedAt: '2026-10-19T10:00:00Z', scope: 'local' }, 'unknown key scope']
    ])('rejects %s', (_, value, message) => {
      expect(() => validateDelegation(value)).toThrow(message)
    })

    it('reads a missing block as not asked yet', () => {
      expect(resolveDelegation(undefined)).toEqual({ ticketDelivery: 'not-asked' })
      expect(resolveDelegation({ ticketDelivery: 'declined', decidedAt: '2026-10-19T10:00:00.000Z' })).toEqual({ ticketDelivery: 'declined', decidedAt: '2026-10-19T10:00:00.000Z' })
    })
  })

  it('reports not asked on a manifest that never recorded a decision, without touching it', async () => {
    const before = await get('.saasfoundry.json')
    expect(await readDelegation(root)).toEqual({ ticketDelivery: 'not-asked' })
    expect(await get('.saasfoundry.json')).toBe(before)
  })

  it('records the decision in the harness block and keeps every other field', async () => {
    const result = await recordDelegation({ targetPath: root, ticketDelivery: 'allowed', now: at('2026-10-19T10:00:00.000Z') })

    expect(result).toEqual({ ticketDelivery: 'allowed', decidedAt: '2026-10-19T10:00:00.000Z', changed: true })
    expect((await manifest()).modules.harness).toEqual({
      version: 4,
      managed: true,
      agents: ['claude-code'],
      delegation: { ticketDelivery: 'allowed', decidedAt: '2026-10-19T10:00:00.000Z' }
    })
    expect((await manifest()).fileHashes).toEqual(MANIFEST.fileHashes)
    expect(await readDelegation(root)).toEqual({ ticketDelivery: 'allowed', decidedAt: '2026-10-19T10:00:00.000Z' })
  })

  it('leaves the file untouched when the same decision is recorded again, so the first date stands', async () => {
    await recordDelegation({ targetPath: root, ticketDelivery: 'declined', now: at('2026-10-19T10:00:00.000Z') })
    const before = await get('.saasfoundry.json')

    const again = await recordDelegation({ targetPath: root, ticketDelivery: 'declined', now: at('2026-10-20T08:00:00.000Z') })

    expect(again).toEqual({ ticketDelivery: 'declined', decidedAt: '2026-10-19T10:00:00.000Z', changed: false })
    expect(await get('.saasfoundry.json')).toBe(before)
  })

  it('replaces the decision when the developer changes their mind', async () => {
    await recordDelegation({ targetPath: root, ticketDelivery: 'declined', now: at('2026-10-19T10:00:00.000Z') })

    const result = await recordDelegation({ targetPath: root, ticketDelivery: 'allowed', now: at('2026-10-20T08:00:00.000Z') })

    expect(result).toEqual({ ticketDelivery: 'allowed', decidedAt: '2026-10-20T08:00:00.000Z', changed: true })
    expect((await manifest()).modules.harness.delegation).toEqual({ ticketDelivery: 'allowed', decidedAt: '2026-10-20T08:00:00.000Z' })
  })

  it('refuses a project without a harness block instead of inventing one', async () => {
    await put('.saasfoundry.json', JSON.stringify({ ...MANIFEST, modules: undefined }) + '\n')
    const before = await get('.saasfoundry.json')

    await expect(recordDelegation({ targetPath: root, ticketDelivery: 'allowed' })).rejects.toThrow('modules.harness is missing')
    expect(await readDelegation(root)).toEqual({ ticketDelivery: 'not-asked' })
    expect(await get('.saasfoundry.json')).toBe(before)
  })

  it('refuses a hand-edited block that is not a valid decision', async () => {
    await put('.saasfoundry.json', JSON.stringify({ ...MANIFEST, modules: { harness: { version: 4, delegation: { ticketDelivery: 'sure', decidedAt: 'now' } } } }) + '\n')

    await expect(readDelegation(root)).rejects.toThrow('Invalid manifest harness delegation')
    await expect(recordDelegation({ targetPath: root, ticketDelivery: 'allowed' })).rejects.toThrow('Invalid manifest harness delegation')
  })

  it('fails closed on a manifest that is not valid JSON', async () => {
    await put('.saasfoundry.json', '{ not json')

    await expect(readDelegation(root)).rejects.toThrow('Invalid JSON in .saasfoundry.json')
  })

  it('survives the other writers of the harness block: agents enable and refresh', async () => {
    await put('CLAUDE.md', '# Custom common instructions\n')
    await recordDelegation({ targetPath: root, ticketDelivery: 'allowed', now: at('2026-10-19T10:00:00.000Z') })

    await enableAgents({ targetPath: root, agents: ['codex'], scope: 'shared' })
    await refreshAgents({ targetPath: root, scope: 'shared' })

    const harness = (await manifest()).modules.harness
    expect(harness.agents).toEqual(['claude-code', 'codex'])
    expect(harness.delegation).toEqual({ ticketDelivery: 'allowed', decidedAt: '2026-10-19T10:00:00.000Z' })
  })
})

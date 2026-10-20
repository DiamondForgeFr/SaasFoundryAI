import { execFile } from 'child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'

import { recordDelegation } from '../../../harness/agent-support'
import { collectStatus } from '../../../status/collect'
import { evaluatePreconditions } from '../../../status/preconditions'
import { delegationSummary, renderAgentFriendly, renderHuman, renderJson } from '../../../status/render'

const exec = promisify(execFile)
// A commit hook exports GIT_* variables: a fixture repository must never inherit them.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))

const FIRST = '2026-10-19T10:00:00.000Z'
const LATER = '2026-10-20T08:00:00.000Z'
const manifest = (modules?: Record<string, unknown>) => ({ version: '1.0.0-beta', projectName: 'status-demo', structure: 'cli', generatedAt: FIRST, ...(modules ? { modules } : {}) })

// The consent is read at the start of every session from the agent-friendly status, so a session
// does not need a separate command (and a separate permission prompt) to learn it (#1026).
describe('the delegation consent in sf status', () => {
  let root: string
  const write = (content: unknown) => writeFile(join(root, '.saasfoundry.json'), JSON.stringify(content, null, 2) + '\n')
  const git = async (...args: string[]) => (await exec('git', args, { cwd: root, env: cleanEnv })).stdout.trim()
  const render = async (renderer: typeof renderAgentFriendly) => {
    const report = await collectStatus(root, { checkNetwork: false })
    return renderer({ report, preconditions: evaluatePreconditions(report) })
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sf-status-delegation-'))
    await mkdir(join(root, '.claude/skills'), { recursive: true })
  })
  afterEach(async () => rm(root, { recursive: true, force: true }))

  describe('delegationSummary', () => {
    it('says what the session needs: the effective value, its source and its date', () => {
      expect(
        delegationSummary({ ticketDelivery: 'allowed', decidedAt: FIRST, source: 'shared', shared: { ticketDelivery: 'allowed', decidedAt: FIRST }, local: { ticketDelivery: 'not-asked' } })
      ).toBe(`allowed (shared, ${FIRST})`)
    })

    it('names the team default behind a local override', () => {
      expect(
        delegationSummary({
          ticketDelivery: 'declined',
          decidedAt: LATER,
          source: 'local',
          shared: { ticketDelivery: 'allowed', decidedAt: FIRST },
          local: { ticketDelivery: 'declined', decidedAt: LATER }
        })
      ).toBe(`declined (local, ${LATER}; shared team default: allowed)`)
    })

    it('says not-asked with the way to record the answer, and never raises on an unreadable one', () => {
      expect(delegationSummary({ ticketDelivery: 'not-asked', source: 'none', shared: { ticketDelivery: 'not-asked' }, local: { ticketDelivery: 'not-asked' } })).toContain(
        'not-asked (ask the developer once'
      )
      expect(delegationSummary({ error: 'Invalid local delegation answer' })).toBe('unreadable (Invalid local delegation answer)')
      expect(delegationSummary({ ticketDelivery: 'unavailable', source: 'none', shared: { ticketDelivery: 'not-asked' }, local: { ticketDelivery: 'not-asked' }, reason: 'no harness' })).toBe(
        'unavailable (no harness)'
      )
    })
  })

  it('prints nothing on a project without a harness block', async () => {
    await write(manifest())
    const report = await collectStatus(root, { checkNetwork: false })
    expect(report.delegation).toBeUndefined()
    expect(await render(renderAgentFriendly)).not.toContain('delegation')
    expect(JSON.parse(await render(renderJson)).delegation).toBeNull()
  })

  it('prints not-asked while nobody answered', async () => {
    await write(manifest({ harness: { version: 4, managed: true } }))
    expect(await render(renderAgentFriendly)).toContain('- delegation: not-asked (ask the developer once')
  })

  it('prints the shared answer in the agent-friendly status, the human status and the JSON', async () => {
    await write(manifest({ harness: { version: 4, managed: true } }))
    await recordDelegation({ targetPath: root, ticketDelivery: 'allowed', now: () => new Date(FIRST) })

    expect(await render(renderAgentFriendly)).toContain(`- delegation: allowed (shared, ${FIRST})`)
    expect(await render(renderHuman)).toContain(`allowed (shared, ${FIRST})`)
    expect(JSON.parse(await render(renderJson)).delegation).toMatchObject({ ticketDelivery: 'allowed', source: 'shared', decidedAt: FIRST })
  })

  it('prints the clone override as the effective value, with the team default beside it', async () => {
    await write(manifest({ harness: { version: 4, managed: true } }))
    await git('init', '-q')
    await recordDelegation({ targetPath: root, ticketDelivery: 'allowed', now: () => new Date(FIRST) })
    await recordDelegation({ targetPath: root, ticketDelivery: 'declined', scope: 'local', now: () => new Date(LATER) })

    expect(await render(renderAgentFriendly)).toContain(`- delegation: declined (local, ${LATER}; shared team default: allowed)`)
  })

  it('does not fail the status when the local answer is corrupt: it reports it', async () => {
    await write(manifest({ harness: { version: 4, managed: true } }))
    await git('init', '-q')
    await recordDelegation({ targetPath: root, ticketDelivery: 'declined', scope: 'local', now: () => new Date(FIRST) })
    await writeFile(join(await git('rev-parse', '--absolute-git-dir'), 'saasfoundry', 'delegation.json'), 'not json')

    const output = await render(renderAgentFriendly)
    expect(output).toContain('- delegation: unreadable (Invalid local delegation answer')
    expect(output).toContain('sf agents delegation clear')
  })
})

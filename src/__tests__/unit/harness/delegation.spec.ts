import { execFile } from 'child_process'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { promisify } from 'util'

import { clearDelegation, enableAgents, readDelegation, recordDelegation, refreshAgents } from '../../../harness/agent-support'
import { isDelegationScope, isTicketDeliveryDecision, resolveDelegation, unavailableDelegation, validateDelegation } from '../../../harness/delegation'

const exec = promisify(execFile)
// A commit hook exports GIT_* variables: a fixture repository must never inherit them.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))

const MANIFEST = {
  version: '1.0.0-beta',
  projectName: 'managed',
  structure: 'cli',
  modules: { harness: { version: 4, managed: true, agents: ['claude-code'] } },
  fileHashes: { 'unrelated.txt': 'preserve-me' }
}

const FIRST = '2026-10-19T10:00:00.000Z'
const LATER = '2026-10-20T08:00:00.000Z'
const NOT_ASKED = { ticketDelivery: 'not-asked' }

describe('ticket delivery delegation consent (#1026)', () => {
  let root: string
  const put = async (path: string, content: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
  const get = (path: string) => readFile(join(root, path), 'utf8')
  const manifest = async () => JSON.parse(await get('.saasfoundry.json'))
  const at = (iso: string) => () => new Date(iso)
  const git = async (...args: string[]) => (await exec('git', args, { cwd: root, env: cleanEnv })).stdout.trim()

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sf-delegation-'))
    await put('.saasfoundry.json', JSON.stringify(MANIFEST, null, 2) + '\n')
  })
  afterEach(async () => rm(root, { recursive: true, force: true }))

  describe('the recorded answer', () => {
    it('accepts the two decisions and the two scopes, and refuses anything else', () => {
      expect(isTicketDeliveryDecision('allowed')).toBe(true)
      expect(isTicketDeliveryDecision('declined')).toBe(true)
      expect(isTicketDeliveryDecision('allow')).toBe(false)
      expect(isTicketDeliveryDecision(undefined)).toBe(false)
      expect(isDelegationScope('shared')).toBe(true)
      expect(isDelegationScope('local')).toBe(true)
      expect(isDelegationScope('team')).toBe(false)
    })

    it.each([
      ['a non-object', 'allowed', 'expected an object'],
      ['an array', [], 'expected an object'],
      ['an unknown decision', { ticketDelivery: 'maybe', decidedAt: FIRST }, 'ticketDelivery must be allowed or declined'],
      ['a missing date', { ticketDelivery: 'allowed' }, 'decidedAt must be an ISO-8601 date-time'],
      ['a date that is not ISO-8601', { ticketDelivery: 'allowed', decidedAt: 'yesterday' }, 'decidedAt must be an ISO-8601 date-time'],
      ['a calendar date without a time', { ticketDelivery: 'allowed', decidedAt: '2026-10-19' }, 'decidedAt must be an ISO-8601 date-time'],
      ['an unknown key', { ticketDelivery: 'allowed', decidedAt: '2026-10-19T10:00:00Z', scope: 'local' }, 'unknown key scope']
    ])('rejects %s', (_, value, message) => {
      expect(() => validateDelegation(value)).toThrow(message)
    })
  })

  describe('the effective value', () => {
    const allowed = { ticketDelivery: 'allowed', decidedAt: FIRST } as const
    const declined = { ticketDelivery: 'declined', decidedAt: LATER } as const

    it('reads nobody answered as not asked yet', () => {
      expect(resolveDelegation(undefined)).toEqual({ ticketDelivery: 'not-asked', source: 'none', shared: NOT_ASKED, local: NOT_ASKED })
    })

    it('takes the shared team default when the clone has no override', () => {
      expect(resolveDelegation(allowed)).toEqual({ ticketDelivery: 'allowed', decidedAt: FIRST, source: 'shared', shared: allowed, local: NOT_ASKED })
    })

    it('lets the clone override win over the shared default, and keeps both layers visible', () => {
      expect(resolveDelegation(allowed, declined)).toEqual({ ticketDelivery: 'declined', decidedAt: LATER, source: 'local', shared: allowed, local: declined })
    })

    it('takes a clone override even when the team never answered', () => {
      expect(resolveDelegation(undefined, declined)).toMatchObject({ ticketDelivery: 'declined', source: 'local', shared: NOT_ASKED })
    })

    it('says unavailable, not not asked, when there is no harness to carry an answer (#14)', () => {
      expect(unavailableDelegation('no harness')).toEqual({ ticketDelivery: 'unavailable', source: 'none', shared: NOT_ASKED, local: NOT_ASKED, reason: 'no harness' })
    })
  })

  describe('the shared team default (outside a Git checkout)', () => {
    it('reports not asked on a manifest that never recorded a decision, without touching it', async () => {
      const before = await get('.saasfoundry.json')
      expect(await readDelegation(root)).toEqual({ ticketDelivery: 'not-asked', source: 'none', shared: NOT_ASKED, local: NOT_ASKED })
      expect(await get('.saasfoundry.json')).toBe(before)
    })

    it('records the decision in the harness block and keeps every other field', async () => {
      const result = await recordDelegation({ targetPath: root, ticketDelivery: 'allowed', now: at(FIRST) })

      expect(result).toMatchObject({ ticketDelivery: 'allowed', decidedAt: FIRST, source: 'shared', scope: 'shared', changed: true })
      expect((await manifest()).modules.harness).toEqual({
        version: 4,
        managed: true,
        agents: ['claude-code'],
        delegation: { ticketDelivery: 'allowed', decidedAt: FIRST }
      })
      expect((await manifest()).fileHashes).toEqual(MANIFEST.fileHashes)
      expect(await readDelegation(root)).toMatchObject({ ticketDelivery: 'allowed', decidedAt: FIRST, source: 'shared' })
    })

    it('leaves the file untouched when the same decision is recorded again, so the first date stands', async () => {
      await recordDelegation({ targetPath: root, ticketDelivery: 'declined', now: at(FIRST) })
      const before = await get('.saasfoundry.json')

      const again = await recordDelegation({ targetPath: root, ticketDelivery: 'declined', now: at(LATER) })

      expect(again).toMatchObject({ ticketDelivery: 'declined', decidedAt: FIRST, scope: 'shared', changed: false })
      expect(await get('.saasfoundry.json')).toBe(before)
    })

    it('replaces the decision when the developer changes their mind', async () => {
      await recordDelegation({ targetPath: root, ticketDelivery: 'declined', now: at(FIRST) })

      const result = await recordDelegation({ targetPath: root, ticketDelivery: 'allowed', now: at(LATER) })

      expect(result).toMatchObject({ ticketDelivery: 'allowed', decidedAt: LATER, changed: true })
      expect((await manifest()).modules.harness.delegation).toEqual({ ticketDelivery: 'allowed', decidedAt: LATER })
    })

    it('reports unavailable on a project without a harness block, and refuses to record there (#14)', async () => {
      await put('.saasfoundry.json', JSON.stringify({ ...MANIFEST, modules: undefined }) + '\n')
      const before = await get('.saasfoundry.json')

      const state = await readDelegation(root)
      expect(state).toMatchObject({ ticketDelivery: 'unavailable', source: 'none' })
      expect(state.reason).toContain('modules.harness is missing')
      await expect(recordDelegation({ targetPath: root, ticketDelivery: 'allowed' })).rejects.toThrow('modules.harness is missing')
      await expect(clearDelegation({ targetPath: root })).rejects.toThrow('modules.harness is missing')
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

    it('refuses an unknown scope and a local answer outside a Git checkout', async () => {
      await expect(recordDelegation({ targetPath: root, ticketDelivery: 'allowed', scope: 'team' })).rejects.toThrow('Delegation scope must be shared or local')
      await expect(recordDelegation({ targetPath: root, ticketDelivery: 'allowed', scope: 'local' })).rejects.toThrow('run this from a Git checkout')
      await expect(clearDelegation({ targetPath: root, scope: 'shared' })).rejects.toThrow('Delegation scope must be local')
      expect(await readDelegation(root)).toMatchObject({ ticketDelivery: 'not-asked' })
    })

    it('survives the other writers of the harness block: agents enable and refresh', async () => {
      await put('CLAUDE.md', '# Custom common instructions\n')
      await recordDelegation({ targetPath: root, ticketDelivery: 'allowed', now: at(FIRST) })

      await enableAgents({ targetPath: root, agents: ['codex'], scope: 'shared' })
      await refreshAgents({ targetPath: root, scope: 'shared' })

      const harness = (await manifest()).modules.harness
      expect(harness.agents).toEqual(['claude-code', 'codex'])
      expect(harness.delegation).toEqual({ ticketDelivery: 'allowed', decidedAt: FIRST })
    })
  })

  // The shared answer is the team's, so one teammate, fork or CI run must be able to say otherwise
  // for itself without editing the repository: the override lives in the clone's Git directory.
  describe('the clone-local override', () => {
    const localFile = async () => join(await git('rev-parse', '--absolute-git-dir'), 'saasfoundry', 'delegation.json')
    const commit = async () => {
      await git('add', '.')
      await git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'fixture')
    }

    beforeEach(async () => {
      await git('init', '-q')
      await commit()
    })

    it('records the override in the Git directory only: the manifest, the index and the tree do not change', async () => {
      const before = await get('.saasfoundry.json')

      const result = await recordDelegation({ targetPath: root, ticketDelivery: 'declined', scope: 'local', now: at(FIRST) })

      expect(result).toMatchObject({ ticketDelivery: 'declined', decidedAt: FIRST, source: 'local', scope: 'local', changed: true, shared: NOT_ASKED })
      expect(await get('.saasfoundry.json')).toBe(before)
      expect(await git('status', '--porcelain')).toBe('')
      expect(JSON.parse(await readFile(await localFile(), 'utf8'))).toEqual({ version: 1, ticketDelivery: 'declined', decidedAt: FIRST })
      expect(((await lstat(await localFile())).mode & 0o777).toString(8)).toBe('600')
    })

    it('overrides the shared default for this clone and reports both layers and the effective value', async () => {
      await recordDelegation({ targetPath: root, ticketDelivery: 'allowed', now: at(FIRST) })
      await recordDelegation({ targetPath: root, ticketDelivery: 'declined', scope: 'local', now: at(LATER) })

      expect(await readDelegation(root)).toEqual({
        ticketDelivery: 'declined',
        decidedAt: LATER,
        source: 'local',
        shared: { ticketDelivery: 'allowed', decidedAt: FIRST },
        local: { ticketDelivery: 'declined', decidedAt: LATER }
      })
      expect((await manifest()).modules.harness.delegation).toEqual({ ticketDelivery: 'allowed', decidedAt: FIRST })
    })

    it('keeps the first local date when the same override is recorded again', async () => {
      await recordDelegation({ targetPath: root, ticketDelivery: 'declined', scope: 'local', now: at(FIRST) })

      const again = await recordDelegation({ targetPath: root, ticketDelivery: 'declined', scope: 'local', now: at(LATER) })

      expect(again).toMatchObject({ decidedAt: FIRST, changed: false })
    })

    it('still wins when the shared default is recorded afterwards, and says so', async () => {
      await recordDelegation({ targetPath: root, ticketDelivery: 'declined', scope: 'local', now: at(FIRST) })

      const shared = await recordDelegation({ targetPath: root, ticketDelivery: 'allowed', now: at(LATER) })

      expect(shared).toMatchObject({ scope: 'shared', changed: true, ticketDelivery: 'declined', source: 'local', shared: { ticketDelivery: 'allowed', decidedAt: LATER } })
    })

    it('clears the override so the shared default applies again, and reports when there was none', async () => {
      await recordDelegation({ targetPath: root, ticketDelivery: 'allowed', now: at(FIRST) })
      await recordDelegation({ targetPath: root, ticketDelivery: 'declined', scope: 'local', now: at(LATER) })

      expect(await clearDelegation({ targetPath: root })).toMatchObject({ ticketDelivery: 'allowed', source: 'shared', scope: 'local', changed: true })
      expect(await readDelegation(root)).toMatchObject({ ticketDelivery: 'allowed', source: 'shared', local: NOT_ASKED })
      expect(await clearDelegation({ targetPath: root })).toMatchObject({ changed: false })
    })

    it('is shared by every worktree of the clone, because it lives in the common Git directory', async () => {
      await recordDelegation({ targetPath: root, ticketDelivery: 'declined', scope: 'local', now: at(FIRST) })
      const worktree = join(root, '..', `${root.split('/').pop()}-wt`)
      await git('worktree', 'add', '-q', '-b', 'feature/x', worktree)
      try {
        expect(await readDelegation(worktree)).toMatchObject({ ticketDelivery: 'declined', source: 'local', decidedAt: FIRST })
      } finally {
        await rm(worktree, { recursive: true, force: true })
      }
    })

    it('does not leak into a fresh clone: the answer is not tracked', async () => {
      await recordDelegation({ targetPath: root, ticketDelivery: 'declined', scope: 'local', now: at(FIRST) })
      const clone = `${root}-clone`
      await exec('git', ['clone', '-q', root, clone], { env: cleanEnv })
      try {
        expect(await readDelegation(clone)).toMatchObject({ ticketDelivery: 'not-asked', source: 'none' })
      } finally {
        await rm(clone, { recursive: true, force: true })
      }
    })

    it('fails closed on a corrupt local answer, and clear is the way out', async () => {
      await recordDelegation({ targetPath: root, ticketDelivery: 'declined', scope: 'local', now: at(FIRST) })
      await writeFile(await localFile(), '{ "version": 1, "ticketDelivery": "perhaps", "decidedAt": "now" }')

      await expect(readDelegation(root)).rejects.toThrow('Invalid local delegation answer')
      await expect(readDelegation(root)).rejects.toThrow('sf agents delegation clear')
      expect(await clearDelegation({ targetPath: root })).toMatchObject({ changed: true, ticketDelivery: 'not-asked' })
      expect(await readDelegation(root)).toMatchObject({ ticketDelivery: 'not-asked' })
    })

    it('refuses to read or replace a local answer that is a link', async () => {
      await recordDelegation({ targetPath: root, ticketDelivery: 'declined', scope: 'local', now: at(FIRST) })
      const file = await localFile()
      await rm(file)
      await writeFile(join(root, 'elsewhere.json'), JSON.stringify({ version: 1, ticketDelivery: 'allowed', decidedAt: FIRST }))
      await symlink(join(root, 'elsewhere.json'), file)

      await expect(readDelegation(root)).rejects.toThrow('not a link or directory')
      await expect(recordDelegation({ targetPath: root, ticketDelivery: 'allowed', scope: 'local' })).rejects.toThrow('not a link or directory')
    })
  })
})

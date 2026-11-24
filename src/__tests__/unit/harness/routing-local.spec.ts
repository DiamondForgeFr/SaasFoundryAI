import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  autoKindsFor,
  emptyLocalRouting,
  listLocalAdjustments,
  listLocalHolds,
  localRoutingPath,
  readLocalRouting,
  readLocalRoutingWithSkipped,
  ROUTING_LOG_LIMIT,
  skippedLocalRoutingNotice,
  staleTierAgentPaths,
  updateLocalRouting,
  withLogEntry,
  type LocalAdjustment,
  type LocalRouting
} from '../../../harness/routing-local'

const AT = '2026-10-20T08:00:00.000Z'
const evidence = {
  rule: 'r',
  from: { tier: 'build', candidate: 'a/b' },
  to: { tier: 'fix', candidate: 'c/d' },
  window: { rated: 10, successes: 7, failures: 3 },
  expectedFeatureCost: { from: '1.000000', to: null, currency: 'USD' as const },
  durationP95Ms: { from: null, to: null },
  runs: []
}
const move = (tier: string, from: string, action: LocalAdjustment['action'] = 'escalate'): LocalAdjustment => ({ tier, from, action, at: AT, evidence })
const layerWith = (kinds: LocalRouting['kinds']): LocalRouting => ({ ...emptyLocalRouting(), kinds })

describe('the local routing layer (#1035)', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sf-local-routing-'))
  })
  afterEach(async () => rm(dir, { recursive: true, force: true }))

  it('is empty until something moved', async () => {
    expect(await readLocalRouting(dir)).toEqual(emptyLocalRouting())
    expect(await readLocalRouting(join(dir, 'never-written'))).toEqual(emptyLocalRouting())
  })

  it('keeps a change as an atomic, owner-only file and reads it back', async () => {
    const next = layerWith({ 'multi-file-feature': { 'claude-code': move('fix', 'build') } })
    expect(await updateLocalRouting(dir, () => ({ next, result: 'written' }))).toBe('written')
    expect(((await stat(localRoutingPath(dir))).mode & 0o777).toString(8)).toBe('600')
    expect(await readLocalRouting(dir)).toEqual(next)
    expect(listLocalAdjustments(next)).toEqual([{ kind: 'multi-file-feature', provider: 'claude-code', adjustment: move('fix', 'build') }])
  })

  it('leaves the file alone when the change returns nothing', async () => {
    await updateLocalRouting(dir, () => ({ result: null }))
    await expect(stat(localRoutingPath(dir))).rejects.toThrow()
  })

  it('does not lose a move when several writers race', async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        updateLocalRouting(dir, (state) => ({
          next: withLogEntry(state, { at: AT, action: 'escalate', kind: 'tests', provider: 'codex', from: 'build', to: `fix${index}`, evidence: null, note: null }),
          result: index
        }))
      )
    )
    expect((await readLocalRouting(dir)).log).toHaveLength(12)
  })

  it('keeps the log bounded: the oldest moves fall off', () => {
    let state = emptyLocalRouting()
    for (let index = 0; index < ROUTING_LOG_LIMIT + 5; index++)
      state = withLogEntry(state, { at: AT, action: 'escalate', kind: 'tests', provider: null, from: 'a', to: String(index), evidence: null, note: null })
    expect(state.log).toHaveLength(ROUTING_LOG_LIMIT)
    expect(state.log[0].to).toBe('5')
  })

  it('gives the moves of one provider in the shape the resolution takes', () => {
    const layer = layerWith({ tests: { 'claude-code': move('fix', 'build'), codex: move('terminal', 'build') }, prose: { codex: move('edit', 'light', 'deescalate') } })
    expect(autoKindsFor(layer, 'claude-code')).toEqual({ tests: { tier: 'fix' } })
    expect(autoKindsFor(layer, 'codex')).toEqual({ tests: { tier: 'terminal' }, prose: { tier: 'edit' } })
  })

  describe('a file that is not what the CLI wrote', () => {
    it.each([
      ['not JSON', '{ nope', 'not JSON'],
      ['an unversioned file', JSON.stringify({ ...emptyLocalRouting(), version: 0 }), 'expected version 1'],
      ['a file without its sections', JSON.stringify({ version: 1, kinds: {} }), 'kinds, boundaries and log are required'],
      ['holds that are not an object', JSON.stringify({ ...emptyLocalRouting(), holds: [] }), 'holds and ladders must be objects']
    ])('refuses %s, and says it only caches the moves of this clone', async (_, content, detail) => {
      await mkdir(dir, { recursive: true })
      await writeFile(localRoutingPath(dir), content)
      await expect(readLocalRouting(dir)).rejects.toThrow(detail)
      await expect(readLocalRouting(dir)).rejects.toThrow('delete the file to start over')
    })

    it('says a newer version needs a newer CLI, and never asks to delete the file (#1309)', async () => {
      await writeFile(localRoutingPath(dir), JSON.stringify({ ...emptyLocalRouting(), version: 2 }))
      await expect(readLocalRouting(dir)).rejects.toThrow('written by a newer CLI (version 2; this CLI reads version 1). Upgrade this CLI')
      await expect(readLocalRouting(dir)).rejects.not.toThrow('delete the file')
    })

    it('refuses a link in place of the file', async () => {
      await writeFile(join(dir, 'elsewhere.json'), JSON.stringify(emptyLocalRouting()))
      await symlink(join(dir, 'elsewhere.json'), localRoutingPath(dir))
      await expect(readLocalRouting(dir)).rejects.toThrow('not a link or directory')
    })
  })

  describe('the tier agents a move leaves behind', () => {
    const shared = undefined
    it('has none while nothing moved', () => {
      expect(staleTierAgentPaths(['claude-code', 'codex'], shared, emptyLocalRouting())).toEqual([])
    })

    it('names the agents whose text the move changes, for the declared hosts only: every tier says which other tier serves the kind', () => {
      const layer = layerWith({ 'multi-file-feature': { 'claude-code': move('fix', 'build') } })
      expect(staleTierAgentPaths(['claude-code'], shared, layer)).toEqual(['build', 'edit', 'fix', 'light', 'plan', 'terminal'].map((tier) => `.claude/agents/sf-${tier}.md`))
      expect(staleTierAgentPaths(['codex'], shared, layer)).toEqual([])
      expect(staleTierAgentPaths(['gemini-cli'], shared, layer)).toEqual([])
    })

    it('has none once the move was promoted: the shared routing renders the same agents', () => {
      const promoted = { kinds: { 'multi-file-feature': { tier: 'fix' } } }
      expect(staleTierAgentPaths(['claude-code'], promoted, emptyLocalRouting())).toEqual([])
    })
  })

  it('reads the file as the CLI wrote it', async () => {
    await updateLocalRouting(dir, () => ({ next: layerWith({ tests: { codex: move('terminal', 'build') } }), result: null }))
    expect(JSON.parse(await readFile(localRoutingPath(dir), 'utf8'))).toMatchObject({ version: 1, kinds: { tests: { codex: { tier: 'terminal', from: 'build', action: 'escalate' } } } })
  })

  describe('what the adjustment last said, and the candidates it has seen (Examine findings 10 and 11)', () => {
    const withState = (): LocalRouting => ({
      ...emptyLocalRouting(),
      holds: { 'terminal-ci': { 'claude-code': { reason: 'top-of-ladder', since: AT } } },
      ladders: { 'claude-code': { fix: { candidate: 'claude-opus-5-5/medium', since: AT, status: 'new' }, build: { candidate: 'claude-sonnet-5-5/xhigh', since: AT, status: 'accepted' } } },
      log: [{ at: AT, action: 'hold', kind: 'terminal-ci', provider: 'claude-code', from: 'terminal', to: 'terminal', evidence: null, note: 'top-of-ladder: nothing above' }]
    })

    it('keeps the holds, the candidates and a hold entry of the log, and lists the holds in kind order', async () => {
      await updateLocalRouting(dir, () => ({ next: withState(), result: null }))
      const read = await readLocalRouting(dir)
      expect(read).toEqual(withState())
      expect(listLocalHolds(read)).toEqual([{ kind: 'terminal-ci', provider: 'claude-code', hold: { reason: 'top-of-ladder', since: AT } }])
    })

    it('reads a layer written before holds and candidates existed as one without any', async () => {
      const older = Object.fromEntries(Object.entries(emptyLocalRouting()).filter(([key]) => key !== 'holds' && key !== 'ladders'))
      await writeFile(localRoutingPath(dir), JSON.stringify(older))
      expect(await readLocalRouting(dir)).toEqual(emptyLocalRouting())
    })

    it('keeps the log for the last hundred entries', () => {
      expect(ROUTING_LOG_LIMIT).toBe(100)
    })
  })

  // #1309: the worktrees of one clone share the layer, so an older CLI reads what a newer one wrote. It skips
  // what it does not know, applies the rest, names what it skipped, and writes the skipped entries back.
  describe('entries a newer CLI wrote', () => {
    const known = { tests: { codex: move('terminal', 'build') } }
    it.each([
      ['an unknown key', { budget: 1 }, 'budget'],
      ['an unknown task kind', { kinds: { ...known, deploy: { codex: move('fix', 'build') } } }, 'kinds.deploy'],
      ['an unrouted provider', { kinds: { tests: { ...known.tests, 'future-agent': move('fix', 'build') } } }, 'kinds.tests.future-agent'],
      ['a tier that is not an identifier', { kinds: { ...known, prose: { codex: { ...move('fix', 'build'), tier: 'Fix!' } } } }, 'kinds.prose.codex'],
      ['a boundary that is not a time', { kinds: known, boundaries: { tests: { codex: 'yesterday' } } }, 'boundaries.tests.codex'],
      ['a hold that is not a reason', { kinds: known, holds: { tests: { codex: { reason: 3, since: AT } } } }, 'holds.tests.codex'],
      ['a hold for a kind that does not exist', { kinds: known, holds: { deploy: {} } }, 'holds.deploy'],
      ['a candidate with a status nobody wrote', { kinds: known, ladders: { codex: { build: { candidate: 'a/b', since: AT, status: 'maybe' } } } }, 'ladders.codex.build'],
      ['a ladder for a provider this CLI does not route', { kinds: known, ladders: { 'future-agent': { fix: { candidate: 'm/high', since: AT, status: 'new' } } } }, 'ladders.future-agent'],
      ['a log entry with an action nobody writes', { kinds: known, log: [{ at: AT, kind: 'tests', action: 'bless' }] }, 'log entry']
    ])('skips %s, keeps applying the rest, and names what it skipped', async (_, patch, path) => {
      await writeFile(localRoutingPath(dir), JSON.stringify({ ...emptyLocalRouting(), kinds: known, ...patch }))
      const { local, skipped } = await readLocalRoutingWithSkipped(dir)
      expect(local.kinds.tests?.codex).toEqual(move('terminal', 'build'))
      expect(skipped).toEqual([path])
      expect(await readLocalRouting(dir)).toEqual(local)
      expect(skippedLocalRoutingNotice(skipped)).toContain(path)
    })

    it('says nothing when it skipped nothing, and names five entries at most', () => {
      expect(skippedLocalRoutingNotice([])).toBeUndefined()
      const notice = skippedLocalRoutingNotice(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
      expect(notice).toContain('(a, b, c, d, e and 2 more)')
      expect(notice).toContain('kept, not applied')
      expect(notice).not.toContain('delete')
    })

    it('writes the entries it skipped back as they were, next to its own changes', async () => {
      const later = '2026-10-21T08:00:00.000Z'
      const written = {
        ...emptyLocalRouting(),
        budget: { usd: 3 },
        kinds: { tests: { 'future-agent': move('fix', 'build') }, deploy: { codex: move('fix', 'build') } },
        ladders: { 'future-agent': { fix: { candidate: 'm/high', since: AT, status: 'new' } }, codex: { build: { candidate: 'a/b', since: AT, status: 'accepted' } } },
        log: [{ at: later, kind: 'tests', action: 'bless', provider: 'future-agent' }]
      }
      await writeFile(localRoutingPath(dir), JSON.stringify(written))
      await updateLocalRouting(dir, (state) => ({
        next: withLogEntry(
          { ...state, kinds: { tests: { codex: move('terminal', 'build') } } },
          { at: AT, action: 'escalate', kind: 'tests', provider: 'codex', from: 'build', to: 'terminal', evidence: null, note: null }
        ),
        result: null
      }))
      const raw = JSON.parse(await readFile(localRoutingPath(dir), 'utf8'))
      expect(raw.budget).toEqual({ usd: 3 })
      expect(raw.kinds).toEqual({ tests: { 'future-agent': move('fix', 'build'), codex: move('terminal', 'build') }, deploy: { codex: move('fix', 'build') } })
      expect(raw.ladders).toEqual(written.ladders)
      // the log stays in time order, the skipped line at its place
      expect(raw.log.map((entry: { action: string }) => entry.action)).toEqual(['escalate', 'bless'])
      // and the older CLI reads its own change back, the skipped entries still left out
      const { local, skipped } = await readLocalRoutingWithSkipped(dir)
      expect(local.kinds).toEqual({ tests: { codex: move('terminal', 'build') } })
      expect(skipped).toEqual(['budget', 'kinds.tests.future-agent', 'kinds.deploy', 'ladders.future-agent', 'log entry'])
    })

    it('lets its own known entry win over a skipped one at the same place', async () => {
      await writeFile(localRoutingPath(dir), JSON.stringify({ ...emptyLocalRouting(), ladders: { codex: { build: { candidate: 'a/b', since: AT, status: 'maybe' } } } }))
      const entry = { candidate: 'c/d', since: AT, status: 'accepted' as const }
      await updateLocalRouting(dir, (state) => ({ next: { ...state, ladders: { codex: { build: entry } } }, result: null }))
      expect(JSON.parse(await readFile(localRoutingPath(dir), 'utf8')).ladders).toEqual({ codex: { build: entry } })
      expect((await readLocalRoutingWithSkipped(dir)).skipped).toEqual([])
    })
  })
})

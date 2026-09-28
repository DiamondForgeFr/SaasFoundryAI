import { execFile } from 'child_process'
import path from 'path'

const SCRIPT = path.resolve(__dirname, '../../../../scaffolds/skills-templates/tool-saasfoundry/scripts/plan-milestone.js')
const NODE = process.execPath

interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

async function run(input: unknown): Promise<ExecResult> {
  const child = execFile(NODE, [SCRIPT])
  const out: string[] = []
  const err: string[] = []
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (c: string) => out.push(c))
  child.stderr?.on('data', (c: string) => err.push(c))
  child.stdin?.write(typeof input === 'string' ? input : JSON.stringify(input))
  child.stdin?.end()
  const code = await new Promise<number>((resolve) => child.on('close', (c) => resolve(c ?? 0)))
  return { stdout: out.join(''), stderr: err.join(''), code }
}

interface Candidate {
  source: 'epic' | 'srs-version' | 'unaffiliated'
  name: string | null
  rationale: string
  evidence: string
  tickets: number[]
  scopeSize: number
  openCount: number
  doneCount: number
}
interface Plan {
  shouldPropose: boolean
  trigger: string | null
  reason: string | null
  candidates: Candidate[]
  droppedCandidates: Array<{ source: string; rationale: string; scopeSize: number; openCount: number }>
  cap: number
  considered: number
  dropped: number
  counts: { tickets: number; open: number; unassigned: number; openMilestones: number }
  notes: string[]
}

interface Ticket {
  number: number
  title?: string
  status?: string
  isEpic?: boolean
  parent?: number | null
  milestone?: string | null
}

async function plan(
  tickets: Ticket[],
  extra: { milestones?: unknown[]; srsVersions?: unknown[]; boardTruncated?: boolean; boardLimit?: number; srsUnreachable?: boolean; versionNamed?: string } = {}
): Promise<Plan> {
  const res = await run({ tickets, milestones: extra.milestones ?? [], srsVersions: extra.srsVersions ?? [], ...extra })
  if (res.code !== 0) throw new Error(`expected 0, got ${res.code}: ${res.stderr}`)
  return JSON.parse(res.stdout) as Plan
}

/** N open tickets under one open Epic. */
function epicWith(epicNumber: number, openChildren: number, doneChildren = 0): Ticket[] {
  const out: Ticket[] = [{ number: epicNumber, title: `[EPIC] epic ${epicNumber}`, status: 'In progress', isEpic: true }]
  for (let i = 0; i < openChildren; i++) out.push({ number: epicNumber * 100 + i, status: 'Backlog', parent: epicNumber })
  for (let i = 0; i < doneChildren; i++) out.push({ number: epicNumber * 100 + 50 + i, status: 'Done', parent: epicNumber })
  return out
}

const loose = (count: number, from = 9000): Ticket[] => Array.from({ length: count }, (_, i) => ({ number: from + i, status: 'Backlog' }))

describe('plan-milestone.js', () => {
  describe('input handling', () => {
    it('exits 2 on empty stdin', async () => {
      expect((await run('')).code).toBe(2)
    })

    it('refuses to guess when there is no board', async () => {
      const res = await run({ milestones: [] })
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('derived from the board, not guessed')
    })
  })

  describe('every candidate names what it grouped on', () => {
    it('cites the sub-issue relationship for an Epic', async () => {
      const p = await plan(epicWith(482, 4))
      const c = p.candidates.find((x) => x.source === 'epic')
      expect(c?.evidence).toContain('sub-issue relationship to #482')
      expect(c?.rationale).toContain('holds 4 tickets, 4 still open')
      expect(c?.openCount).toBe(4)
    })

    it('never invents a release name', async () => {
      // Naming a release is a decision, not a derivation. The script proposes contents.
      const p = await plan(epicWith(482, 4))
      for (const c of p.candidates) expect(c.name).toBeNull()
    })

    it('admits when a group is only leftovers', async () => {
      // Dressing an unaffiliated pile up as a theme is exactly the invention this avoids.
      const p = await plan(loose(12))
      const c = p.candidates.find((x) => x.source === 'unaffiliated')
      expect(c?.evidence).toContain('leftover set, not a theme')
    })

    it('proposes contents from an SRS version, not a name', async () => {
      const p = await plan(loose(12), { srsVersions: [{ title: 'v2 — live notes', url: 'https://notion.so/v2' }] })
      const c = p.candidates.find((x) => x.source === 'srs-version')
      expect(c?.rationale).toContain('v2 — live notes')
      expect(c?.evidence).toContain('https://notion.so/v2')
      expect(c?.name).toBeNull()
    })

    it('ignores an Epic whose children are all finished', async () => {
      const p = await plan(epicWith(300, 0, 5))
      expect(p.candidates.filter((c) => c.source === 'epic')).toEqual([])
    })
  })

  describe('ranking, and the cap naming what it cut', () => {
    // All of this came from pointing the engine at SaaSFoundry's own board.
    it('ranks by what a release would contain, not by what is left to do', async () => {
      // #482 holds 16 tickets with 15 done — the most complete release scope on the board.
      // Ranking by remaining work put it last and then dropped it. A milestone records
      // CONTENTS, and it is read mostly after the release, when everything in it is closed.
      const nearlyDone = epicWith(482, 1, 15)
      const p = await plan([...nearlyDone, ...epicWith(393, 7)])
      expect(p.candidates[0].rationale).toContain('#482')
      expect(p.candidates[0].scopeSize).toBe(16)
      expect(p.candidates[0].openCount).toBe(1)
    })

    it('puts a declared version above an Epic, and an Epic above leftovers', async () => {
      // Size alone would float the unaffiliated pile to the top: it is the largest
      // grouping and the least defensible one.
      const p = await plan([...epicWith(1, 4), ...loose(40)], { srsVersions: [{ title: 'v2 — live notes' }] })
      expect(p.candidates.map((c) => c.source)).toEqual(['srs-version', 'epic', 'unaffiliated'])
    })

    it('emits both counts, because they answer different questions', async () => {
      const p = await plan(epicWith(1, 3, 9))
      expect(p.candidates[0].scopeSize).toBe(12)
      expect(p.candidates[0].openCount).toBe(3)
    })

    it('lists the dropped candidates rather than only counting them', async () => {
      const p = await plan([...epicWith(1, 2), ...epicWith(2, 9), ...epicWith(3, 5), ...epicWith(4, 1)])
      expect(p.dropped).toBe(1)
      expect(p.droppedCandidates).toHaveLength(1)
      expect(p.droppedCandidates[0].rationale).toContain('#4')
      expect(p.droppedCandidates[0].scopeSize).toBe(1)
      expect(p.notes.join(' ')).toContain('not hidden')
    })

    it('says when the board itself was read incompletely', async () => {
      // A 400-item limit silently dropped 10 of this board's 410 — and with them two
      // children of #482 and the whole of #542. Every count becomes an undercount, so it
      // is said in those terms rather than as a footnote about pagination.
      const p = await plan(epicWith(1, 3), { boardTruncated: true, boardLimit: 400 })
      expect(p.notes.join(' ')).toContain('every count here is a floor')
      expect(p.notes.join(' ')).toContain('400')
    })

    it('drops nothing when everything fits', async () => {
      const p = await plan(epicWith(1, 3))
      expect(p.dropped).toBe(0)
      expect(p.droppedCandidates).toEqual([])
    })
  })

  describe('the trigger fires on a signal, not on every turn', () => {
    it('fires when enough open tickets carry no milestone and none is open', async () => {
      const p = await plan(loose(12))
      expect(p.shouldPropose).toBe(true)
      expect(p.trigger).toContain('no milestone and none is open')
    })

    it('stays quiet below the threshold — every board has a few in flight', async () => {
      const p = await plan([...epicWith(1, 3), ...loose(1)])
      expect(p.shouldPropose).toBe(false)
      expect(p.reason).toContain('below the threshold worth interrupting for')
    })

    it('stays quiet when a milestone is already open, and says to re-scope it', async () => {
      // R1 on #542: a milestone is re-scopable at any time. Proposing a second one when
      // one is open is how boards end up with three overlapping releases.
      const p = await plan(loose(12), { milestones: [{ title: 'v1.0.0', state: 'open' }] })
      expect(p.shouldPropose).toBe(false)
      expect(p.reason).toContain('re-scope it rather than proposing another')
      expect(p.reason).toContain('v1.0.0')
    })

    it('fires on an SRS version that no milestone matches, even below the ticket threshold', async () => {
      const p = await plan([...epicWith(1, 3)], { srsVersions: [{ title: 'v2 — live notes' }] })
      expect(p.shouldPropose).toBe(true)
      expect(p.trigger).toContain('SRS declares a version')
    })
  })

  describe('nothing to group is said, not invented', () => {
    it('says the board is empty when it is', async () => {
      const p = await plan([])
      expect(p.shouldPropose).toBe(false)
      expect(p.reason).toContain('the board is empty')
      expect(p.candidates).toEqual([])
    })

    it('says so when nothing groups, rather than proposing a milestone anyway', async () => {
      // Two loose tickets and a finished Epic: real, but not a release scope.
      const p = await plan([...epicWith(1, 0, 3), ...loose(2)])
      expect(p.shouldPropose).toBe(false)
      expect(p.reason).toContain('nothing on the board groups into a release scope')
      expect(p.candidates).toEqual([])
    })

    it('says when it could only read the board, and why', async () => {
      const p = await plan(loose(12))
      // Reworded by #570: the note used to say "no SRS versions were supplied" on
      // every run, describing a gap the script could close itself. It now names the
      // real cause and the command that fixes it.
      expect(p.notes.join(' ')).toContain('declares no version pages')
      expect(p.notes.join(' ')).toContain('sf srs normalize')
    })
  })

  describe('counts', () => {
    it('separates open from unassigned, since a milestone can already hold open work', async () => {
      const p = await plan([
        { number: 1, status: 'Backlog', milestone: 'v1.0.0' },
        { number: 2, status: 'Backlog' },
        { number: 3, status: 'Done' }
      ])
      expect(p.counts).toEqual({ tickets: 3, open: 2, unassigned: 1, openMilestones: 0 })
    })
  })
})

/**
 * #570 — the `srs-version` source is ranked first and owns the only trigger that
 * ignores the ticket-count threshold. Until now nothing supplied it, so a project
 * that had declared its version in the SRS was told to come back once it had
 * accumulated eight unassigned tickets.
 */
describe('SRS versions feed the first-ranked trigger (#570)', () => {
  const version = { title: 'v1 — MVP', url: 'https://notion.so/v1', feature: 'Réunion live', frCount: 5 }

  it('proposes below the threshold when the SRS declares a version', async () => {
    const out = await plan(epicWith(1, 2), { srsVersions: [version] })

    expect(out.shouldPropose).toBe(true)
    expect(out.trigger).toMatch(/the SRS declares a version that no milestone corresponds to/)
    expect(out.candidates[0].source).toBe('srs-version')
  })

  it('carries the feature and the FR count into the rationale', async () => {
    const out = await plan(epicWith(1, 2), { srsVersions: [version] })

    expect(out.candidates[0].rationale).toContain('under « Réunion live »')
    expect(out.candidates[0].rationale).toContain('5 FRs')
    // What the release would contain lives on the SRS side here, not the board.
    // Reporting 0 would read as "this version is empty".
    expect(out.candidates[0].scopeSize).toBe(5)
  })

  it('does not propose a version that already belongs to a milestone', async () => {
    const out = await plan(epicWith(1, 2), {
      srsVersions: [version],
      milestones: [{ title: 'v1.0.0', state: 'closed', description: 'SRS versions: https://notion.so/v1' }]
    })

    expect(out.candidates.some((c) => c.source === 'srs-version')).toBe(false)
    expect(out.notes.join(' ')).toMatch(/already belongs to a milestone/)
  })

  it('counts the ones it filtered when only some are already associated', async () => {
    const other = { title: 'v2 — Live', url: 'https://notion.so/v2', feature: 'Réunion live', frCount: 3 }
    const out = await plan(epicWith(1, 2), {
      srsVersions: [version, other],
      milestones: [{ title: 'v1.0.0', state: 'closed', description: 'SRS versions: https://notion.so/v1' }]
    })

    expect(out.candidates.filter((c) => c.source === 'srs-version')).toHaveLength(1)
    expect(out.notes.join(' ')).toMatch(/1 version\(s\) already belong to a milestone/)
  })

  it('says the SRS was unreadable rather than claiming no version exists', async () => {
    const out = await plan(epicWith(1, 2), { srsVersions: [], srsUnreachable: true })

    expect(out.notes.join(' ')).toMatch(/could not be read/)
    expect(out.notes.join(' ')).toMatch(/not a finding that no version exists/)
  })

  it('distinguishes an SRS with no versions from an SRS that could not be read', async () => {
    const out = await plan(epicWith(1, 2), { srsVersions: [] })

    expect(out.notes.join(' ')).toMatch(/declares no version pages/)
    expect(out.notes.join(' ')).toMatch(/sf srs normalize/)
    expect(out.notes.join(' ')).not.toMatch(/could not be read/)
  })
})

/**
 * #571 — the Guardrail's first documented trigger is conversational, and the decision
 * was delegated to a script that never learned what was said. A number cannot overrule a
 * stated intention; it does not know one was stated.
 */
describe('a named version outranks the ticket-count threshold (#571)', () => {
  it('proposes on a board far below the threshold once the user names one', async () => {
    const out = await plan(epicWith(1, 2), { versionNamed: 'MVP' })

    expect(out.shouldPropose).toBe(true)
    expect(out.trigger).toContain('the user named a version')
    expect(out.trigger).toContain('MVP')
  })

  it('stays silent below the threshold when nothing was named', async () => {
    const out = await plan(epicWith(1, 2))

    expect(out.shouldPropose).toBe(false)
    expect(out.reason).toContain('below the threshold')
  })

  it('still refuses to invent a grouping when there is nothing to point at', async () => {
    // Being told a version was named is not a licence to produce a candidate. If the
    // board groups into nothing, the honest answer is still that it groups into nothing.
    const out = await plan([{ number: 1, status: 'Done' }], { versionNamed: 'MVP' })

    expect(out.shouldPropose).toBe(false)
    expect(out.candidates).toEqual([])
    expect(out.reason).toContain('nothing on the board groups into a release scope')
  })

  it('routes to re-scoping, and names what the user called it, when a milestone is open', async () => {
    const out = await plan(epicWith(1, 2), { milestones: [{ title: 'v0.9.0', state: 'open' }], versionNamed: 'v1' })

    expect(out.shouldPropose).toBe(false)
    expect(out.reason).toContain('a milestone is already open (v0.9.0)')
    expect(out.reason).toContain('The user named "v1"')
  })

  it('ignores whitespace-only input rather than treating it as an intention', async () => {
    const out = await plan(epicWith(1, 2), { versionNamed: '   ' })

    expect(out.shouldPropose).toBe(false)
  })

  it('quotes the user, not the SRS, when both apply — and still leads with the SRS candidate', async () => {
    const out = await plan(epicWith(1, 2), {
      versionNamed: 'MVP',
      srsVersions: [{ title: 'v1 — MVP', url: 'https://notion.so/v1', feature: 'Live', frCount: 4 }]
    })

    expect(out.shouldPropose).toBe(true)
    // The trigger is what the model quotes back, so it should connect to what the person
    // just said. Nothing is lost by preferring it: the SRS version is still ranked first
    // in `candidates`, which is where the evidence lives.
    expect(out.trigger).toContain('the user named a version')
    expect(out.candidates[0].source).toBe('srs-version')
    expect(out.candidates[0].rationale).toContain('v1 — MVP')
  })
})

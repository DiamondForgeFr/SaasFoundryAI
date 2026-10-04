import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EpicSpec, FrSpec, PageContent, PageRef, RawContent, ResolvedParent, SrsAdapter } from '../../../../builders/srs/types'
import { parseArgs, runSpawn, SpawnIO, SpawnOptions } from '../../../../srs/bin/spawn'
import { parseFrPageTitle } from '../../../../srs/tree/fr-title'
import { renderEpicPage } from '../../../../builders/srs/templates/pages/epic.tpl'
import { renderFrPage } from '../../../../builders/srs/templates/pages/fr.tpl'
import { asRead } from '../../../helpers/srs-pages'
import { registerSrsBackend, unregisterSrsBackend } from '../../../../srs'

class StubAdapter implements SrsAdapter {
  constructor(
    private readonly children: PageRef[] = [],
    private readonly onInit: () => Promise<void> | void = () => undefined,
    private readonly onResolveParent: (input: string) => Promise<ResolvedParent> | ResolvedParent = (input) => ({ id: input, name: input, url: 'https://example.test/epic' }),
    private readonly onListChildren: ((parentId: string) => Promise<PageRef[]> | PageRef[]) | null = null,
    private readonly onFetchPage: ((pageId: string) => Promise<RawContent> | RawContent) | null = null
  ) {}

  async init(): Promise<void> {
    await this.onInit()
  }
  async resolveParent(input: string): Promise<ResolvedParent> {
    return this.onResolveParent(input)
  }
  async createPage(parentPageId: string, title: string): Promise<PageRef> {
    void parentPageId
    return { id: 'page', url: '', title }
  }
  async createEpicPage(spec: EpicSpec): Promise<PageRef> {
    return { id: 'e', url: '', title: spec.title }
  }
  async createFrPage(spec: FrSpec): Promise<PageRef> {
    return { id: 'f', url: '', title: spec.fr.title }
  }
  async updatePage(pageId: string, content: PageContent): Promise<void> {
    void pageId
    void content
  }
  async fetchPage(pageId: string): Promise<RawContent> {
    if (this.onFetchPage) return this.onFetchPage(pageId)
    return { pageId, title: '', url: '', blocks: [] }
  }
  async listChildren(parentPageId: string): Promise<PageRef[]> {
    if (this.onListChildren) return this.onListChildren(parentPageId)
    return this.children
  }
  async move(pageId: string, newParentPageId: string): Promise<void> {
    void pageId
    void newParentPageId
  }
}

interface TestIO extends SpawnIO {
  stdout: jest.Mock
  stderr: jest.Mock
  createSubtask: jest.Mock
  createEpic: jest.Mock
  inspectTickets: jest.Mock
  linkSubtask: jest.Mock
  addToProject: jest.Mock
  stdoutBuffer: string[]
  stderrBuffer: string[]
}

function makeIO(overrides?: Partial<SpawnIO>): TestIO {
  const stdoutBuffer: string[] = []
  const stderrBuffer: string[] = []
  let nextNumber = 100
  const stdout = jest.fn((chunk: string) => {
    stdoutBuffer.push(chunk)
  })
  const stderr = jest.fn((chunk: string) => {
    stderrBuffer.push(chunk)
  })
  const createSubtask = jest.fn((parent: string, title: string, body: string, reason: string) => {
    void parent
    void title
    void body
    void reason
    return { childNumber: String(nextNumber++) }
  })
  const createEpic = jest.fn((title: string, body: string, reason: string) => {
    void title
    void body
    void reason
    return { epicNumber: String(nextNumber++) }
  })
  const ensureMilestone = jest.fn((name: string) => {
    void name
    return { created: true }
  })
  const assignMilestone = jest.fn((ticket: string, name: string) => {
    void ticket
    void name
  })
  const associateMilestone = jest.fn((name: string, page: string) => {
    void name
    void page
  })
  const inspectTickets = jest.fn(() => [])
  const linkSubtask = jest.fn()
  const addToProject = jest.fn()
  const setComplexity = jest.fn()
  return Object.assign(
    { stdout, stderr, createSubtask, createEpic, inspectTickets, linkSubtask, addToProject, ensureMilestone, assignMilestone, associateMilestone, setComplexity, stdoutBuffer, stderrBuffer },
    overrides
  )
}

describe('parseArgs', () => {
  // #901
  it('reads --complexity, and refuses a level the workflow does not know', () => {
    expect(parseArgs(['--epic', 'e', '--complexity', 'medium']).complexity).toBe('medium')
    expect(() => parseArgs(['--epic', 'e', '--complexity', 'huge'])).toThrow('--complexity must be one of bug, low, medium, complex (got "huge")')
  })

  it('parses the minimal happy path', () => {
    const opts = parseArgs(['--ticket', '42', '--epic', 'epic-url'])
    expect(opts.ticket).toBe('42')
    expect(opts.epic).toBe('epic-url')
    expect(opts.dryRun).toBe(false)
    expect(opts.manifestPath).toBe('.saasfoundry.json')
    expect(opts.bypassReason).toBe('spawned-from-srs')
  })

  // #834 — the form every sf-srs example uses; `sf srs` used to swallow its `--version`
  it('reads the version and milestone of a versioned spawn', () => {
    const opts = parseArgs(['--epic', 'feature-url', '--version', 'v0 — Bootstrap', '--milestone', 'v0.1.0'])
    expect(opts).toMatchObject({ epic: 'feature-url', version: 'v0 — Bootstrap', milestone: 'v0.1.0' })
    expect(opts.ticket).toBeUndefined()
  })

  it('accepts --dry-run and custom --manifest / --bypass-reason', () => {
    const opts = parseArgs(['--ticket', '1', '--epic', 'e', '--dry-run', '--manifest', '/tmp/m.json', '--bypass-reason', 'bootstrap', '--reconciliation-plan', '/tmp/reconcile.json'])
    expect(opts.dryRun).toBe(true)
    expect(opts.manifestPath).toBe('/tmp/m.json')
    expect(opts.bypassReason).toBe('bootstrap')
    expect(opts.reconciliationPlanPath).toBe('/tmp/reconcile.json')
  })

  it('throws when --ticket has no value', () => {
    expect(() => parseArgs(['--ticket'])).toThrow(/--ticket requires a value/)
  })

  it('throws when --ticket is followed by another flag', () => {
    expect(() => parseArgs(['--ticket', '--epic', 'e'])).toThrow(/--ticket requires a value/)
  })

  it('throws when --epic is followed by another flag', () => {
    expect(() => parseArgs(['--ticket', '42', '--epic', '--dry-run'])).toThrow(/--epic requires a value/)
  })

  it('throws when --manifest has no value', () => {
    expect(() => parseArgs(['--ticket', '42', '--epic', 'e', '--manifest'])).toThrow(/--manifest requires a value/)
  })

  it('throws when --bypass-reason is followed by another flag', () => {
    expect(() => parseArgs(['--ticket', '42', '--epic', 'e', '--bypass-reason', '--dry-run'])).toThrow(/--bypass-reason requires a value/)
  })

  it('throws when --reconciliation-plan has no value', () => {
    expect(() => parseArgs(['--ticket', '42', '--epic', 'e', '--reconciliation-plan'])).toThrow(/--reconciliation-plan requires a value/)
  })

  // --ticket became optional in #517: without it, spawn creates the Epic itself.
  it('accepts a missing --ticket, which means "create the Epic too"', () => {
    const opts = parseArgs(['--epic', 'e'])
    expect(opts.ticket).toBeUndefined()
    expect(opts.epic).toBe('e')
  })

  it('throws when --epic is missing altogether', () => {
    expect(() => parseArgs(['--ticket', '42'])).toThrow(/missing --epic/)
  })
})

// spawn used to carry its own FR-title regex matching `FR-\d+` only, so every real
// id (FR-LIVE-007, FR-CONFIG-ENGINE-01) failed it and was fabricated into a ticket
// from the raw title. It now shares the one parser with the inventory walk.
describe('spawn uses the shared FR title parser', () => {
  it('reads the ids the old local regex could not', () => {
    expect(parseFrPageTitle('FR-LIVE-007 — Topic-aware AI note taking')).toMatchObject({ id: 'FR-LIVE-007', title: 'Topic-aware AI note taking' })
    expect(parseFrPageTitle('FR-CONFIG-ENGINE-01 — Declarative steps')).toMatchObject({ id: 'FR-CONFIG-ENGINE-01' })
  })

  it('keeps the separator tolerance the old regex had', () => {
    expect(parseFrPageTitle('FR-AUTH-042: Password reset')).toMatchObject({ id: 'FR-AUTH-042', title: 'Password reset' })
    expect(parseFrPageTitle('fr-auth-009 — Something')).toMatchObject({ id: 'FR-AUTH-009' })
    expect(parseFrPageTitle('  FR-AUTH-010 - Typed hyphen  ')).toMatchObject({ id: 'FR-AUTH-010', title: 'Typed hyphen' })
  })

  // The two parsers covered DISJOINT shapes, not overlapping ones. The old local
  // regex accepted `FR-\d+` and nothing else — the shape used in ticket-body
  // examples, never the one the SRS templates produce. The canonical page-title
  // convention is `FR-AREA-NN`, so an area-less id is not an FR page title.
  it('rejects the area-less shape the old local regex was built for', () => {
    expect(parseFrPageTitle('FR-001 — Login flow')).toBeNull()
  })

  it('returns null instead of falling back to the raw title', () => {
    expect(parseFrPageTitle('Ad hoc page')).toBeNull()
  })
})

describe('runSpawn', () => {
  let tmp: string

  const baseOptions = (overrides: Partial<SpawnOptions> = {}): SpawnOptions => ({
    ticket: '42',
    epic: 'https://example.test/epic',
    dryRun: false,
    manifestPath: join(tmp, '.saasfoundry.json'),
    bypassReason: 'spawned-from-srs',
    ...overrides
  })

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sf-srs-spawn-'))
  })

  afterEach(() => {
    unregisterSrsBackend('stub')
    unregisterSrsBackend('explode-init')
    unregisterSrsBackend('explode-resolve')
    unregisterSrsBackend('explode-children')
    rmSync(tmp, { recursive: true, force: true })
  })

  const writeManifest = (body: unknown): void => {
    writeFileSync(join(tmp, '.saasfoundry.json'), JSON.stringify(body))
  }

  const writeReconciliationPlan = (requirements: Array<{ frId: string; classification: 'delivered' | 'partial' | 'missing' | 'superseded'; evidence?: string[] }>): string => {
    const path = join(tmp, 'reconciliation.json')
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        sources: {
          board: { status: 'verified', evidence: ['board inspection'] },
          srs: { status: 'verified', evidence: ['selected SRS version'] },
          implementation: { status: 'verified', evidence: ['source, tests and docs audit'] }
        },
        requirements: requirements.map((requirement) => ({ ...requirement, evidence: requirement.evidence ?? ['verified'] }))
      })
    )
    return path
  }

  it('returns 2 when the manifest is missing', async () => {
    const io = makeIO()
    const code = await runSpawn(baseOptions({ manifestPath: join(tmp, 'nope.json') }), io)
    expect(code).toBe(2)
    expect(io.stderrBuffer.join('')).toMatch(/ENOENT|no such file/)
  })

  it('returns 2 when the manifest is malformed JSON', async () => {
    writeFileSync(join(tmp, '.saasfoundry.json'), '{not valid json')
    const io = makeIO()
    const code = await runSpawn(baseOptions(), io)
    expect(code).toBe(2)
    expect(io.stderrBuffer.join('')).toMatch(/failed to parse/)
  })

  it('returns 3 when tools.srs.backend is missing', async () => {
    writeManifest({ tools: {} })
    const io = makeIO()
    const code = await runSpawn(baseOptions(), io)
    expect(code).toBe(3)
  })

  it('returns 4 when the backend key is unknown', async () => {
    writeManifest({ tools: { srs: { backend: 'nope' } } })
    const io = makeIO()
    const code = await runSpawn(baseOptions(), io)
    expect(code).toBe(4)
  })

  it('returns 5 when adapter.init() throws a non-config error', async () => {
    registerSrsBackend(
      'explode-init',
      () =>
        new StubAdapter([], async () => {
          throw new Error('network down')
        })
    )
    writeManifest({ tools: { srs: { backend: 'explode-init' } } })
    const io = makeIO()
    const code = await runSpawn(baseOptions(), io)
    expect(code).toBe(5)
    expect(io.stderrBuffer.join('')).toMatch(/network down/)
  })

  it('returns 6 when resolveParent throws', async () => {
    registerSrsBackend(
      'explode-resolve',
      () =>
        new StubAdapter([], undefined, () => {
          throw new Error('unknown epic')
        })
    )
    writeManifest({ tools: { srs: { backend: 'explode-resolve' } } })
    const io = makeIO()
    const code = await runSpawn(baseOptions(), io)
    expect(code).toBe(6)
    expect(io.stderrBuffer.join('')).toMatch(/could not resolve epic/)
  })

  it('returns 7 when listChildren throws', async () => {
    registerSrsBackend(
      'explode-children',
      () =>
        new StubAdapter([], undefined, undefined, () => {
          throw new Error('permission denied')
        })
    )
    writeManifest({ tools: { srs: { backend: 'explode-children' } } })
    const io = makeIO()
    const code = await runSpawn(baseOptions(), io)
    expect(code).toBe(7)
    expect(io.stderrBuffer.join('')).toMatch(/listChildren failed/)
  })

  it('returns 0 and emits a "nothing to spawn" message when the Epic has no child pages', async () => {
    registerSrsBackend('stub', () => new StubAdapter([]))
    writeManifest({ tools: { srs: { backend: 'stub' } } })
    const io = makeIO()
    const code = await runSpawn(baseOptions(), io)
    expect(code).toBe(0)
    expect(io.createSubtask).not.toHaveBeenCalled()
    expect(io.stdoutBuffer.join('')).toMatch(/nothing to spawn/)
  })

  it('dry-run: plans without creating, then exits 0', async () => {
    const children: PageRef[] = [
      { id: 'p1', url: 'https://example.test/fr1', title: 'FR-AUTH-001 — Login flow' },
      { id: 'p2', url: 'https://example.test/fr2', title: 'FR-AUTH-002: Password reset' }
    ]
    registerSrsBackend('stub', () => new StubAdapter(children))
    writeManifest({ tools: { srs: { backend: 'stub' } } })
    const io = makeIO()
    const code = await runSpawn(baseOptions({ dryRun: true }), io)
    expect(code).toBe(0)
    expect(io.createSubtask).not.toHaveBeenCalled()
    const out = io.stdoutBuffer.join('')
    expect(out).toMatch(/2 FR page\(s\)/)
    expect(out).toMatch(/FR-AUTH-001 → FR-AUTH-001: Login flow/)
    expect(out).toMatch(/FR-AUTH-002 → FR-AUTH-002: Password reset/)
    expect(out).toMatch(/dry-run/)
  })

  it('creates one Story sub-issue per FR page under the parent', async () => {
    const children: PageRef[] = [
      { id: 'p1', url: 'https://example.test/fr1', title: 'FR-AUTH-001 — Login flow' },
      { id: 'p2', url: 'https://example.test/fr2', title: 'FR-AUTH-002 — Password reset' }
    ]
    registerSrsBackend('stub', () => new StubAdapter(children))
    writeManifest({ tools: { srs: { backend: 'stub' } } })
    const io = makeIO()
    const code = await runSpawn(baseOptions(), io)
    expect(code).toBe(0)
    expect(io.createSubtask).toHaveBeenCalledTimes(2)
    expect(io.createSubtask.mock.calls[0]).toEqual(['42', 'FR-AUTH-001: Login flow', expect.any(String), 'spawned-from-srs'])
    expect(io.createSubtask.mock.calls[1]).toEqual(['42', 'FR-AUTH-002: Password reset', expect.any(String), 'spawned-from-srs'])
    const firstBody = io.createSubtask.mock.calls[0][2] as string
    expect(firstBody).toMatch(/## Objective/)
    expect(firstBody).toMatch(/FR-AUTH-001 — Login flow/)
    expect(firstBody).toMatch(/https:\/\/example\.test\/fr1/)
  })

  // #836 — spawned tickets reached the milestone and their Epic, never the board
  describe('the project board', () => {
    const children: PageRef[] = [
      { id: 'p1', url: 'https://example.test/fr1', title: 'FR-AUTH-001 — Login flow' },
      { id: 'p2', url: 'https://example.test/fr2', title: 'FR-AUTH-002 — Password reset' }
    ]

    it('carries the parent and every created Story, before the release is assigned', async () => {
      registerSrsBackend('stub', () => new StubAdapter(children))
      writeManifest({ tools: { srs: { backend: 'stub' } } })
      const io = makeIO()

      const code = await runSpawn(baseOptions({ milestone: 'v0.1.0' }), io)

      expect(code).toBe(0)
      expect(io.addToProject.mock.calls.map((call) => call[0])).toEqual(['42', '100', '101'])
      expect(io.addToProject.mock.invocationCallOrder[2]).toBeLessThan((io.assignMilestone as jest.Mock).mock.invocationCallOrder[0])
      expect(io.stdoutBuffer.join('')).toContain('3 ticket(s) on the project board')
    })

    it('reports which tickets joined when one cannot, and stops before the release', async () => {
      registerSrsBackend('stub', () => new StubAdapter(children))
      writeManifest({ tools: { srs: { backend: 'stub' } } })
      const io = makeIO({
        addToProject: jest.fn((ticket: string) => {
          if (ticket === '101') throw new Error('project scope missing')
        })
      })

      const code = await runSpawn(baseOptions({ milestone: 'v0.1.0' }), io)

      expect(code).toBe(9)
      expect(io.stderrBuffer.join('')).toContain('#101 could not join the project board — project scope missing')
      expect(io.stderrBuffer.join('')).toContain('2 of 3 are on the board: #42, #100')
      expect(io.stderrBuffer.join('')).toContain('workflow-cli.sh add-to-project <ticket> --status Backlog')
      expect(io.assignMilestone).not.toHaveBeenCalled()
    })

    it('touches nothing on a dry run', async () => {
      registerSrsBackend('stub', () => new StubAdapter(children))
      writeManifest({ tools: { srs: { backend: 'stub' } } })
      const io = makeIO()

      await expect(runSpawn(baseOptions({ dryRun: true }), io)).resolves.toBe(0)
      expect(io.addToProject).not.toHaveBeenCalled()
    })
  })

  it('reconciles delivered, existing and missing FRs before creating only missing work', async () => {
    const children: PageRef[] = [
      { id: 'p1', url: 'https://example.test/fr1', title: 'FR-AUTH-001 — Existing flow' },
      { id: 'p2', url: 'https://example.test/fr2', title: 'FR-AUTH-002 — Missing flow' },
      { id: 'p3', url: 'https://example.test/fr3', title: 'FR-AUTH-003 — Delivered elsewhere' }
    ]
    registerSrsBackend('stub', () => new StubAdapter(children))
    writeManifest({ tools: { srs: { backend: 'stub' } } })
    const reconciliationPlanPath = writeReconciliationPlan([
      { frId: 'FR-AUTH-001', classification: 'partial' },
      { frId: 'FR-AUTH-002', classification: 'missing' },
      { frId: 'FR-AUTH-003', classification: 'delivered', evidence: ['covered by #88'] }
    ])
    const existing = {
      number: '77',
      title: 'Renamed existing flow',
      body: '',
      state: 'CLOSED' as const,
      boardStatus: 'Done',
      parentNumber: '42',
      issueType: 'sf-story',
      url: 'https://github.test/issues/77',
      srsLinks: ['https://example.test/fr1'],
      frIds: ['FR-AUTH-001']
    }
    const io = makeIO({ inspectTickets: jest.fn(() => [existing]) })
    const code = await runSpawn(baseOptions({ reconciliationPlanPath }), io)

    expect(code).toBe(0)
    expect(io.createSubtask).toHaveBeenCalledTimes(1)
    expect(io.createSubtask.mock.calls[0][1]).toBe('FR-AUTH-002: Missing flow')
    expect(io.stdoutBuffer.join('')).toMatch(/FR-AUTH-001: partial → reuse #77/)
    expect(io.stdoutBuffer.join('')).toMatch(/FR-AUTH-003: delivered → skip/)
    expect(io.stdoutBuffer.join('')).toMatch(/created 1, reused 1, skipped 1/)
    // #836 — the reused Story is on the board too; add-to-project keeps the status it has there
    expect(io.addToProject.mock.calls.map((call) => call[0])).toEqual(['42', '77', '100'])
  })

  it('is idempotent when every actionable FR already has one canonical ticket', async () => {
    const children: PageRef[] = [{ id: 'p1', url: 'https://example.test/fr1', title: 'FR-AUTH-001 — Existing flow' }]
    registerSrsBackend('stub', () => new StubAdapter(children))
    writeManifest({ tools: { srs: { backend: 'stub' } } })
    const reconciliationPlanPath = writeReconciliationPlan([{ frId: 'FR-AUTH-001', classification: 'partial' }])
    const io = makeIO({
      inspectTickets: jest.fn(() => [
        {
          number: '77',
          title: 'Existing flow',
          body: '',
          state: 'OPEN',
          boardStatus: 'Backlog',
          parentNumber: '42',
          issueType: 'sf-story',
          url: 'https://github.test/issues/77',
          srsLinks: ['https://example.test/fr1'],
          frIds: ['FR-AUTH-001']
        }
      ])
    })
    const code = await runSpawn(baseOptions({ reconciliationPlanPath }), io)

    expect(code).toBe(0)
    expect(io.createSubtask).not.toHaveBeenCalled()
    expect(io.stdoutBuffer.join('')).toMatch(/created 0, reused 1, skipped 0/)
  })

  it('blocks ambiguous board evidence before milestones or ticket mutation', async () => {
    const children: PageRef[] = [{ id: 'p1', url: 'https://example.test/fr1', title: 'FR-AUTH-001 — Existing flow' }]
    registerSrsBackend('stub', () => new StubAdapter(children))
    writeManifest({ tools: { srs: { backend: 'stub' } } })
    const reconciliationPlanPath = writeReconciliationPlan([{ frId: 'FR-AUTH-001', classification: 'partial' }])
    const candidate = {
      title: 'Existing flow',
      body: '',
      state: 'OPEN' as const,
      boardStatus: 'Backlog',
      parentNumber: '42',
      issueType: 'sf-story',
      url: 'https://github.test/issues/77',
      srsLinks: ['https://example.test/fr1'],
      frIds: ['FR-AUTH-001']
    }
    const io = makeIO({
      inspectTickets: jest.fn(() => [
        { ...candidate, number: '77' },
        { ...candidate, number: '78' }
      ])
    })
    const code = await runSpawn(baseOptions({ reconciliationPlanPath, milestone: 'v1.0.0' }), io)

    expect(code).toBe(10)
    expect(io.ensureMilestone).not.toHaveBeenCalled()
    expect(io.createSubtask).not.toHaveBeenCalled()
    expect(io.stderrBuffer.join('')).toMatch(/ambiguous.*#77, #78/)
    expect(io.stderrBuffer.join('')).toMatch(/Nothing was created/)
  })

  it('recovers an orphan created before an uncertain create response', async () => {
    const children: PageRef[] = [{ id: 'p1', url: 'https://example.test/fr1', title: 'FR-AUTH-001 — Existing flow' }]
    registerSrsBackend('stub', () => new StubAdapter(children))
    writeManifest({ tools: { srs: { backend: 'stub' } } })
    const reconciliationPlanPath = writeReconciliationPlan([{ frId: 'FR-AUTH-001', classification: 'missing' }])
    const orphan = {
      number: '77',
      title: 'Existing flow',
      body: '',
      state: 'OPEN' as const,
      boardStatus: 'Backlog',
      parentNumber: null,
      issueType: 'sf-story',
      url: 'https://github.test/issues/77',
      srsLinks: ['https://example.test/fr1'],
      frIds: ['FR-AUTH-001']
    }
    const inspectTickets = jest.fn().mockReturnValueOnce([]).mockReturnValueOnce([orphan])
    const io = makeIO({
      inspectTickets,
      createSubtask: jest.fn(() => {
        throw new Error('response lost')
      })
    })
    const code = await runSpawn(baseOptions({ reconciliationPlanPath }), io)

    expect(code).toBe(0)
    expect(io.linkSubtask).toHaveBeenCalledWith('42', '77')
    expect(io.stdoutBuffer.join('')).toMatch(/recovered after an uncertain create response/)
  })

  // Was: "warns and uses the raw title". Producing a ticket from a non-FR title is
  // worse than failing — it looks planned and is empty. Two such tickets, and zero
  // for the four real FRs, is what spawn did on the live "Réunion live" feature.
  it('aborts and creates nothing when a page under a version is not an FR', async () => {
    const children: PageRef[] = [
      { id: 'p1', url: 'https://example.test/fr1', title: 'FR-LIVE-007 — Real' },
      { id: 'p2', url: 'https://example.test/ad-hoc', title: 'Ad hoc page' }
    ]
    registerSrsBackend('stub', () => new StubAdapter(children))
    writeManifest({ tools: { srs: { backend: 'stub' } } })
    const io = makeIO()
    const code = await runSpawn(baseOptions(), io)
    expect(code).toBe(2)
    expect(io.createSubtask).not.toHaveBeenCalled()
    expect(io.stderrBuffer.join('')).toMatch(/mixes 1 loose FR page\(s\) with 1 version page\(s\)/)
  })

  it('propagates a custom --bypass-reason to createSubtask', async () => {
    const children: PageRef[] = [{ id: 'p1', url: 'https://example.test/fr1', title: 'FR-AUTH-001 — Thing' }]
    registerSrsBackend('stub', () => new StubAdapter(children))
    writeManifest({ tools: { srs: { backend: 'stub' } } })
    const io = makeIO()
    const code = await runSpawn(baseOptions({ bypassReason: 'bootstrap-epic-174' }), io)
    expect(code).toBe(0)
    expect(io.createSubtask.mock.calls[0][3]).toBe('bootstrap-epic-174')
  })

  // ── Version targeting ────────────────────────────────────────────────────
  //
  // Measured on the live "Réunion live" feature before this landed: spawn created
  // two tickets named after the version pages and none for the four real FRs.
  describe('a versioned feature', () => {
    const feature: PageRef[] = [
      { id: 'v1', url: 'https://example.test/v1', title: 'v1 — Existant' },
      { id: 'v2', url: 'https://example.test/v2', title: 'v2 — Prise de notes vivante' }
    ]
    const tree: Record<string, PageRef[]> = {
      v1: [{ id: 'f1', url: 'https://example.test/f1', title: 'FR-LIVE-001 — Transcript' }],
      v2: [
        { id: 'f2', url: 'https://example.test/f2', title: 'FR-LIVE-007 — Topic-aware AI note taking' },
        { id: 'f3', url: 'https://example.test/f3', title: 'FR-LIVE-008 — Per-topic consolidation' }
      ]
    }

    function register(): void {
      registerSrsBackend(
        'stub',
        () =>
          new StubAdapter(
            [],
            undefined,
            () => ({ id: 'feat', name: 'Réunion live : transcript & notes', url: 'https://example.test/feat' }),
            (parentId) => (parentId in tree ? tree[parentId] : feature)
          )
      )
      writeManifest({ tools: { srs: { backend: 'stub' } } })
    }

    it('refuses to spawn from the feature and lists the versions with their FR counts and URLs', async () => {
      register()
      const io = makeIO()
      const code = await runSpawn(baseOptions({ dryRun: true }), io)
      expect(code).toBe(2)
      expect(io.createSubtask).not.toHaveBeenCalled()
      const err = io.stderrBuffer.join('')
      expect(err).toMatch(/is a versioned feature, not an Epic/)
      expect(err).toMatch(/v1 — Existant\s+\(1 FR\)\s+https:\/\/example\.test\/v1/)
      expect(err).toMatch(/v2 — Prise de notes vivante\s+\(2 FR\)\s+https:\/\/example\.test\/v2/)
    })

    it('plans one Story per real FR once a version is selected, and names the Epic <feature> - <version>', async () => {
      register()
      const io = makeIO()
      const code = await runSpawn(baseOptions({ dryRun: true, version: 'v2 — Prise de notes vivante' }), io)
      expect(code).toBe(0)
      const out = io.stdoutBuffer.join('')
      expect(out).toMatch(/Epic « Réunion live : transcript & notes - v2 — Prise de notes vivante »/)
      expect(out).toMatch(/FR-LIVE-007 → FR-LIVE-007: Topic-aware AI note taking/)
      expect(out).toMatch(/FR-LIVE-008 → FR-LIVE-008: Per-topic consolidation/)
      expect(out).not.toMatch(/v2 — Prise de notes vivante →/)
    })

    it('selects a version by URL as well as by title', async () => {
      register()
      const io = makeIO()
      const code = await runSpawn(baseOptions({ dryRun: true, version: 'https://example.test/v1' }), io)
      expect(code).toBe(0)
      expect(io.stdoutBuffer.join('')).toMatch(/FR-LIVE-001 → FR-LIVE-001: Transcript/)
    })

    // Adversarial review: an empty version would produce an Epic with no Story —
    // a promise on the board that no page backs.
    it('refuses a version that holds no page', async () => {
      const emptyTree: Record<string, PageRef[]> = { v1: [], v2: [] }
      registerSrsBackend(
        'stub',
        () =>
          new StubAdapter(
            [],
            undefined,
            () => ({ id: 'feat', name: 'Réunion live', url: 'https://example.test/feat' }),
            (parentId) => (parentId in emptyTree ? emptyTree[parentId] : feature)
          )
      )
      writeManifest({ tools: { srs: { backend: 'stub' } } })
      const io = makeIO()
      const code = await runSpawn(baseOptions({ dryRun: true, version: 'v1 — Existant' }), io)
      expect(code).toBe(2)
      expect(io.stderrBuffer.join('')).toMatch(/holds no page/)
    })

    // A substring match on the URL would let `--version v1` silently hit a page
    // whose URL merely contains "v1", on a command that writes to the board.
    it('does not match a version on a URL fragment', async () => {
      register()
      const io = makeIO()
      const code = await runSpawn(baseOptions({ dryRun: true, version: 'example.test' }), io)
      expect(code).toBe(2)
      expect(io.stderrBuffer.join('')).toMatch(/no version "example\.test"/)
    })

    it('lists the versions again when the requested one does not exist', async () => {
      register()
      const io = makeIO()
      const code = await runSpawn(baseOptions({ dryRun: true, version: 'v9' }), io)
      expect(code).toBe(2)
      expect(io.stderrBuffer.join('')).toMatch(/no version "v9"/)
      expect(io.stderrBuffer.join('')).toMatch(/v1 — Existant/)
    })
  })

  it('rejects --version on a feature that holds its FRs directly', async () => {
    const children: PageRef[] = [{ id: 'p1', url: 'https://example.test/fr1', title: 'FR-AUTH-001 — Thing' }]
    registerSrsBackend('stub', () => new StubAdapter(children))
    writeManifest({ tools: { srs: { backend: 'stub' } } })
    const io = makeIO()
    const code = await runSpawn(baseOptions({ dryRun: true, version: 'v1' }), io)
    expect(code).toBe(2)
    expect(io.stderrBuffer.join('')).toMatch(/is not versioned/)
  })

  // Without --ticket, spawn owns the Epic. The `<feature> - <version>` name was the
  // one thing the agent had to remember and got wrong, so the tool guarantees it.
  describe('without --ticket', () => {
    const feature: PageRef[] = [{ id: 'v2', url: 'https://example.test/v2', title: 'v2 — Prise de notes vivante' }]
    const tree: Record<string, PageRef[]> = {
      v2: [{ id: 'f2', url: 'https://example.test/f2', title: 'FR-LIVE-007 — Topic-aware AI note taking' }]
    }

    function register(): void {
      registerSrsBackend(
        'stub',
        () =>
          new StubAdapter(
            [],
            undefined,
            () => ({ id: 'feat', name: 'Réunion live', url: 'https://example.test/feat' }),
            (parentId) => (parentId in tree ? tree[parentId] : feature)
          )
      )
      writeManifest({ tools: { srs: { backend: 'stub' } } })
    }

    it('creates the Epic named <feature> - <version>, then the Stories under it', async () => {
      register()
      const io = makeIO()
      const code = await runSpawn({ ...baseOptions({ version: 'v2 — Prise de notes vivante' }), ticket: undefined }, io)
      expect(code).toBe(0)
      expect(io.createEpic).toHaveBeenCalledTimes(1)
      expect(io.createEpic.mock.calls[0][0]).toBe('Réunion live - v2 — Prise de notes vivante')
      // The Stories hang under the Epic that was just created, not under a guess.
      const epicNumber = io.createEpic.mock.results[0].value.epicNumber
      expect(io.createSubtask).toHaveBeenCalledTimes(1)
      expect(io.createSubtask.mock.calls[0][0]).toBe(epicNumber)
      expect(io.createSubtask.mock.calls[0][1]).toBe('FR-LIVE-007: Topic-aware AI note taking')
      // The Epic it created goes on the board with its Story (#836)
      expect(io.addToProject.mock.calls.map((call) => call[0])).toEqual([epicNumber, io.createSubtask.mock.results[0].value.childNumber])
    })

    // #855 — the plan required --ticket, while without one spawn creates the version Epic,
    // the layout the skill recommends: the evidence-first path and that layout never met
    describe('with a reconciliation plan', () => {
      const holder = 'Réunion live - v2 — Prise de notes vivante'
      const options = (overrides: Partial<SpawnOptions> = {}): SpawnOptions => ({
        ...baseOptions({ version: 'v2 — Prise de notes vivante' }),
        reconciliationPlanPath: overrides.reconciliationPlanPath ?? writeReconciliationPlan([{ frId: 'FR-LIVE-007', classification: 'missing' }]),
        ticket: undefined,
        ...overrides
      })
      const story = (overrides: Partial<{ number: string; parentNumber: string | null }> = {}) => ({
        number: '77',
        title: 'FR-LIVE-007: Topic-aware AI note taking',
        state: 'OPEN' as const,
        boardStatus: 'Backlog',
        parentNumber: null,
        issueType: 'sf-story',
        url: 'https://github.test/issues/77',
        srsLinks: ['https://example.test/f2'],
        frIds: ['FR-LIVE-007'],
        ...overrides
      })
      const epic = {
        number: '50',
        title: holder,
        state: 'OPEN' as const,
        boardStatus: 'Backlog',
        parentNumber: null,
        issueType: 'sf-epic',
        url: 'https://github.test/issues/50',
        srsLinks: ['https://example.test/f2'],
        frIds: ['FR-LIVE-007']
      }

      it('previews with no parent, creating nothing', async () => {
        register()
        const io = makeIO()

        await expect(runSpawn(options({ dryRun: true }), io)).resolves.toBe(0)

        expect(io.inspectTickets.mock.calls[0][0]).toBeNull()
        expect(io.stdoutBuffer.join('')).toContain(`under a new Epic « ${holder} »`)
        expect(io.createEpic).not.toHaveBeenCalled()
      })

      it('creates the version Epic as the delivery parent, referencing the drafting ticket', async () => {
        register()
        const io = makeIO()

        await expect(runSpawn(options({ draftingTicket: '16' }), io)).resolves.toBe(0)

        expect(io.createEpic).toHaveBeenCalledTimes(1)
        expect(io.createEpic.mock.calls[0][1]).toContain('_Drafted in #16._')
        expect(io.createSubtask.mock.calls[0][0]).toBe(io.createEpic.mock.results[0].value.epicNumber)
      })

      it('adopts the Epic a previous run created instead of a second one', async () => {
        register()
        const io = makeIO({ inspectTickets: jest.fn(() => [epic, story({ parentNumber: '50' })]) })

        await expect(runSpawn(options(), io)).resolves.toBe(0)

        expect(io.createEpic).not.toHaveBeenCalled()
        expect(io.createSubtask).not.toHaveBeenCalled()
        expect(io.stdoutBuffer.join('')).toContain(`the existing Epic #50 « ${holder} »`)
        expect(io.addToProject.mock.calls.map((call) => call[0])).toEqual(['50', '77'])
      })

      it('links a matching ticket that has no parent under the new Epic', async () => {
        register()
        const io = makeIO({ inspectTickets: jest.fn(() => [story()]) })

        await expect(runSpawn(options(), io)).resolves.toBe(0)

        const epicNumber = io.createEpic.mock.results[0].value.epicNumber
        expect(io.linkSubtask).toHaveBeenCalledWith(epicNumber, '77')
        expect(io.createSubtask).not.toHaveBeenCalled()
      })

      it('blocks before creating anything when a match belongs to another parent', async () => {
        register()
        const io = makeIO({ inspectTickets: jest.fn(() => [story({ parentNumber: '9' })]) })

        await expect(runSpawn(options({ milestone: 'v0.2.0' }), io)).resolves.toBe(10)

        expect(io.stderrBuffer.join('')).toContain('already belongs to parent #9')
        expect(io.createEpic).not.toHaveBeenCalled()
        expect(io.ensureMilestone).not.toHaveBeenCalled()
      })

      it('creates no Epic when every FR is already delivered', async () => {
        register()
        const io = makeIO()

        const plan = writeReconciliationPlan([{ frId: 'FR-LIVE-007', classification: 'delivered' }])
        await expect(runSpawn(options({ reconciliationPlanPath: plan, milestone: 'v0.2.0' }), io)).resolves.toBe(0)

        expect(io.stdoutBuffer.join('')).toContain('no Epic and no Story to create')
        expect(io.createEpic).not.toHaveBeenCalled()
        expect(io.ensureMilestone).not.toHaveBeenCalled()
      })

      it('refuses to choose between two open version Epics', async () => {
        register()
        const io = makeIO({ inspectTickets: jest.fn(() => [epic, { ...epic, number: '51' }]) })

        await expect(runSpawn(options(), io)).resolves.toBe(10)
        expect(io.stderrBuffer.join('')).toContain('several open Epics (#50, #51)')
      })
    })

    // #837 — spawn read titles only: every Story said "No acceptance criteria yet." and the
    // Epic kept its placeholders, although the pages held all of it
    describe('ticket bodies', () => {
      const pages: Record<string, RawContent> = {
        feat: asRead(
          renderEpicPage({
            title: 'Réunion live',
            parentPageId: 'root',
            businessValue: 'A participant leaves with a usable record.',
            urs: [{ id: 'UR-LIVE-1', narrative: 'follow a meeting without taking notes' }],
            frs: [],
            dsItems: [{ id: 'DS-LIVE-1', title: 'Topic segmentation' }]
          }),
          'feat'
        ),
        v2: asRead(
          renderEpicPage({
            title: 'v2 — Prise de notes vivante',
            parentPageId: 'feat',
            parentId: 'feat',
            businessValue: 'Notes that read like minutes.',
            scope: 'AI notes during the meeting.',
            version: { changes: ['Notes are grouped by topic'] },
            urs: [],
            frs: []
          }),
          'v2'
        ),
        f2: asRead(
          renderFrPage({
            parentEpicPageId: 'v2',
            fr: {
              id: 'FR-LIVE-007',
              title: 'Topic-aware AI note taking',
              description: 'Notes are grouped by the topic being discussed.',
              acceptanceCriteria: ['A topic change opens a new group', 'Each group | names its topic'],
              urRefs: ['UR-LIVE-1'],
              dsRefs: ['DS-LIVE-1'],
              validationRules: ['A group has at least one note']
            }
          }),
          'f2'
        )
      }

      const registerWithPages = (fetch: (pageId: string) => RawContent = (pageId) => pages[pageId]): void => {
        registerSrsBackend(
          'stub',
          () =>
            new StubAdapter(
              [],
              undefined,
              () => ({ id: 'feat', name: 'Réunion live', url: 'https://example.test/feat' }),
              (parentId) => (parentId in tree ? tree[parentId] : feature),
              fetch
            )
        )
        writeManifest({ tools: { srs: { backend: 'stub' } } })
      }

      // #901 — spawned Stories carried no complexity, so each one was refused at its first move
      describe('complexity', () => {
        const withComplexity = (pageId: string): RawContent =>
          pageId === 'f2' ? asRead(renderFrPage({ parentEpicPageId: 'v2', fr: { id: 'FR-LIVE-007', title: 'Topic-aware AI note taking', complexity: 'medium' } }), 'f2') : pages[pageId]
        const storyNumber = (io: TestIO): string => (io.createSubtask.mock.results[0].value as { childNumber: string }).childNumber

        it('labels each Story with the complexity its FR page states', async () => {
          registerWithPages(withComplexity)
          const io = makeIO()

          await expect(runSpawn({ ...baseOptions({ version: 'v2 — Prise de notes vivante', complexity: 'low' }), ticket: undefined }, io)).resolves.toBe(0)

          expect(io.setComplexity).toHaveBeenCalledWith(storyNumber(io), 'medium')
          expect(io.stdoutBuffer.join('')).toContain('— complexity medium')
          expect(io.stdoutBuffer.join('')).toContain('every created Story carries its complexity')
        })

        it('falls back to --complexity for an FR page that states none', async () => {
          registerWithPages()
          const io = makeIO()

          await expect(runSpawn({ ...baseOptions({ version: 'v2 — Prise de notes vivante', complexity: 'low' }), ticket: undefined }, io)).resolves.toBe(0)

          expect(io.setComplexity).toHaveBeenCalledWith(storyNumber(io), 'low')
        })

        it('names the Stories left without one, and never labels the Epic', async () => {
          registerWithPages()
          const io = makeIO()

          await expect(runSpawn({ ...baseOptions({ version: 'v2 — Prise de notes vivante' }), ticket: undefined }, io)).resolves.toBe(0)

          expect(io.setComplexity).not.toHaveBeenCalled()
          expect(io.stdoutBuffer.join('')).toContain(
            `1 Story ticket(s) without a complexity — tag each before it leaves Backlog: workflow-cli.sh retag <ticket> <bug|low|medium|complex>: #${storyNumber(io)}`
          )
        })

        it('lists a Story whose label could not be set, without failing the spawn', async () => {
          registerWithPages(withComplexity)
          const io = makeIO({
            setComplexity: jest.fn(() => {
              throw new Error('gh: forbidden')
            })
          })

          await expect(runSpawn({ ...baseOptions({ version: 'v2 — Prise de notes vivante' }), ticket: undefined }, io)).resolves.toBe(0)

          expect(io.stderrBuffer.join('')).toContain('complexity medium not set — gh: forbidden')
          expect(io.stdoutBuffer.join('')).toContain('without a complexity')
        })
      })

      it('builds each Story from its FR page and the feature page', async () => {
        registerWithPages()
        const io = makeIO()

        await expect(runSpawn({ ...baseOptions({ version: 'v2 — Prise de notes vivante' }), ticket: undefined }, io)).resolves.toBe(0)

        const story = io.createSubtask.mock.calls[0][2] as string
        expect(story).toContain('## Objective\n\nNotes are grouped by the topic being discussed.')
        expect(story).toContain('- **UR-LIVE-1** — follow a meeting without taking notes')
        expect(story).toContain('| AC-1 | A topic change opens a new group | FR-LIVE-007 |')
        expect(story).toContain('| AC-2 | Each group \\| names its topic | FR-LIVE-007 |')
        expect(story).toContain('- **DS-LIVE-1** — Topic segmentation')
        expect(story).toContain('- A group has at least one note')
        expect(story).not.toMatch(/No UR references yet|No acceptance criteria yet|No design references yet/)
      })

      it('gives the Epic the business value and scope of its version', async () => {
        registerWithPages()
        const io = makeIO()

        await expect(runSpawn({ ...baseOptions({ version: 'v2 — Prise de notes vivante' }), ticket: undefined }, io)).resolves.toBe(0)

        const epic = io.createEpic.mock.calls[0][1] as string
        expect(epic).toContain('## Business Value\n\nNotes that read like minutes.')
        expect(epic).toContain('### Included\n\n- AI notes during the meeting.\n- Notes are grouped by topic')
        expect(epic).toContain('Every Story below is Done')
        expect(epic).not.toContain('_Describe the business impact of this Epic._')
      })

      it('creates nothing when a page cannot be read', async () => {
        registerWithPages((pageId) => {
          if (pageId === 'f2') throw new Error('rate limited')
          return pages[pageId]
        })
        const io = makeIO()

        await expect(runSpawn({ ...baseOptions({ version: 'v2 — Prise de notes vivante' }), ticket: undefined }, io)).resolves.toBe(7)
        expect(io.stderrBuffer.join('')).toContain('could not read the SRS pages')
        expect(io.createEpic).not.toHaveBeenCalled()
        expect(io.createSubtask).not.toHaveBeenCalled()
      })
    })

    it('creates nothing at all on a dry run', async () => {
      register()
      const io = makeIO()
      const code = await runSpawn({ ...baseOptions({ version: 'v2 — Prise de notes vivante', dryRun: true }), ticket: undefined }, io)
      expect(code).toBe(0)
      expect(io.createEpic).not.toHaveBeenCalled()
      expect(io.createSubtask).not.toHaveBeenCalled()
    })

    it('returns 8 and creates no Story when the Epic number cannot be read back', async () => {
      register()
      const io = makeIO({ createEpic: jest.fn(() => ({ epicNumber: '' })) })
      const code = await runSpawn({ ...baseOptions({ version: 'v2 — Prise de notes vivante' }), ticket: undefined }, io)
      expect(code).toBe(8)
      expect(io.createSubtask).not.toHaveBeenCalled()
    })
  })

  it('returns 8 when the subtask-creation shim yields an empty childNumber', async () => {
    const children: PageRef[] = [{ id: 'p1', url: 'https://example.test/fr1', title: 'FR-AUTH-001 — Thing' }]
    registerSrsBackend('stub', () => new StubAdapter(children))
    writeManifest({ tools: { srs: { backend: 'stub' } } })
    const io = makeIO({ createSubtask: jest.fn(() => ({ childNumber: '' })) })
    const code = await runSpawn(baseOptions(), io)
    expect(code).toBe(8)
    expect(io.stderrBuffer.join('')).toMatch(/could not determine new ticket number/)
  })

  it('returns 8 when createSubtask throws', async () => {
    const children: PageRef[] = [{ id: 'p1', url: 'https://example.test/fr1', title: 'FR-AUTH-001 — Thing' }]
    registerSrsBackend('stub', () => new StubAdapter(children))
    writeManifest({ tools: { srs: { backend: 'stub' } } })
    const io = makeIO({
      createSubtask: jest.fn(() => {
        throw new Error('gh failed')
      })
    })
    const code = await runSpawn(baseOptions(), io)
    expect(code).toBe(8)
    expect(io.stderrBuffer.join('')).toMatch(/gh failed/)
  })
})

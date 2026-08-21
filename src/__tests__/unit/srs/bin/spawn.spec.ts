import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EpicSpec, FrSpec, PageContent, PageRef, RawContent, ResolvedParent, SrsAdapter } from '../../../../builders/srs/types'
import { parseArgs, runSpawn, SpawnIO, SpawnOptions } from '../../../../srs/bin/spawn'
import { parseFrPageTitle } from '../../../../srs/tree/fr-title'
import { registerSrsBackend, unregisterSrsBackend } from '../../../../srs'

class StubAdapter implements SrsAdapter {
  constructor(
    private readonly children: PageRef[] = [],
    private readonly onInit: () => Promise<void> | void = () => undefined,
    private readonly onResolveParent: (input: string) => Promise<ResolvedParent> | ResolvedParent = (input) => ({ id: input, name: input, url: 'https://example.test/epic' }),
    private readonly onListChildren: ((parentId: string) => Promise<PageRef[]> | PageRef[]) | null = null
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
    return { pageId, title: '', url: '', blocks: [] }
  }
  async listChildren(parentPageId: string): Promise<PageRef[]> {
    if (this.onListChildren) return this.onListChildren(parentPageId)
    return this.children
  }
}

interface TestIO extends SpawnIO {
  stdout: jest.Mock
  stderr: jest.Mock
  createSubtask: jest.Mock
  createEpic: jest.Mock
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
  return Object.assign({ stdout, stderr, createSubtask, createEpic, stdoutBuffer, stderrBuffer }, overrides)
}

describe('parseArgs', () => {
  it('parses the minimal happy path', () => {
    const opts = parseArgs(['--ticket', '42', '--epic', 'epic-url'])
    expect(opts.ticket).toBe('42')
    expect(opts.epic).toBe('epic-url')
    expect(opts.dryRun).toBe(false)
    expect(opts.manifestPath).toBe('.saasfoundry.json')
    expect(opts.bypassReason).toBe('spawned-from-srs')
  })

  it('accepts --dry-run and custom --manifest / --bypass-reason', () => {
    const opts = parseArgs(['--ticket', '1', '--epic', 'e', '--dry-run', '--manifest', '/tmp/m.json', '--bypass-reason', 'bootstrap'])
    expect(opts.dryRun).toBe(true)
    expect(opts.manifestPath).toBe('/tmp/m.json')
    expect(opts.bypassReason).toBe('bootstrap')
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

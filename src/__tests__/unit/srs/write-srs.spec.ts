import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DraftCandidate, EpicSpec, FrSpec, PageContent, PageRef, RawContent, ResolvedParent, SectionAddition, SectionAdditionOutcome, SrsAdapter } from '../../../builders/srs/types'
import { registerSrsBackend, unregisterSrsBackend } from '../../../srs'
import { checkSpec, collectFrsByFeature, collectItemsByFeature, collectVersionsByFeature, runWriteSrs } from '../../../srs/bin/write-srs'

class StubAdapter implements SrsAdapter {
  createdEpics: EpicSpec[] = []
  createdFrs: FrSpec[] = []
  constructor(private readonly failOnIndex?: number) {}
  private calls = 0
  async init(): Promise<void> {}
  async resolveParent(input: string): Promise<ResolvedParent> {
    return { id: input, name: input }
  }
  async createPage(parentPageId: string, title: string): Promise<PageRef> {
    void parentPageId
    return { id: 'p', url: '', title }
  }
  async createEpicPage(spec: EpicSpec): Promise<PageRef> {
    if (this.failOnIndex !== undefined && this.calls === this.failOnIndex) {
      this.calls++
      throw new Error('notion rate limited')
    }
    this.calls++
    this.createdEpics.push(spec)
    return { id: `epic-${this.createdEpics.length}`, url: `https://notion.so/epic-${this.createdEpics.length}`, title: spec.title }
  }
  async createFrPage(spec: FrSpec): Promise<PageRef> {
    if (this.failOnIndex !== undefined && this.calls === this.failOnIndex) {
      this.calls++
      throw new Error('notion rate limited')
    }
    this.calls++
    this.createdFrs.push(spec)
    return { id: `fr-${this.createdFrs.length}`, url: `https://notion.so/fr-${this.createdFrs.length}`, title: spec.fr.title }
  }
  async updatePage(pageId: string, content: PageContent): Promise<void> {
    void pageId
    void content
  }
  async fetchPage(pageId: string): Promise<RawContent> {
    return { pageId, title: '', url: '', blocks: [] }
  }
  async listChildren(parentPageId?: string): Promise<PageRef[]> {
    void parentPageId
    return []
  }
  async move(pageId: string, newParentPageId: string): Promise<void> {
    void pageId
    void newParentPageId
  }
}

function makeEpic(title: string): DraftCandidate {
  const epic: EpicSpec = { title, parentPageId: 'root', urs: [], frs: [] }
  return { kind: 'epic', confidence: 'medium', epic, source: { kind: 'notion-pages' } }
}

function makeFr(title: string): DraftCandidate {
  const fr: FrSpec = { parentEpicPageId: 'epic-1', fr: { id: 'FR-1', title } }
  return { kind: 'fr', confidence: 'medium', fr, source: { kind: 'notion-pages' } }
}

describe('runWriteSrs', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sf-srs-write-'))
  })

  afterEach(() => {
    unregisterSrsBackend('write-stub')
    rmSync(tmp, { recursive: true, force: true })
  })

  const writeManifest = (body: unknown): string => {
    const p = join(tmp, '.saasfoundry.json')
    writeFileSync(p, JSON.stringify(body, null, 2))
    return p
  }

  const writeSpec = (candidates: unknown): string => {
    const p = join(tmp, 'spec.json')
    writeFileSync(p, JSON.stringify(candidates))
    return p
  }

  it('creates epic + fr pages and clears pendingIngestion on full success', async () => {
    const adapter = new StubAdapter()
    registerSrsBackend('write-stub', () => adapter)
    const stdout: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk))
      return true
    })

    const manifestPath = writeManifest({
      tools: {
        srs: {
          backend: 'write-stub',
          pendingIngestion: { sourceBackend: 'notion', sourceParent: { id: 'p', url: '', name: 'n' }, createdAt: 'x' }
        }
      }
    })
    const specPath = writeSpec([makeEpic('Auth'), makeFr('Login endpoint')])

    const code = await runWriteSrs({ specPath, manifestPath })

    expect(code).toBe(0)
    expect(adapter.createdEpics).toHaveLength(1)
    expect(adapter.createdFrs).toHaveLength(1)
    const body = JSON.parse(stdout.join(''))
    expect(body.created).toHaveLength(2)
    expect(body.failed).toHaveLength(0)
    expect(body.pendingIngestionCleared).toBe(true)
    const updatedManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    expect(updatedManifest.tools.srs.pendingIngestion).toBeUndefined()
    expect(updatedManifest.tools.srs.backend).toBe('write-stub')
  })

  // #877 — an unresolved parent used to stop the batch halfway, the pages before it written
  it('checks the whole batch before creating any page', async () => {
    const adapter = new StubAdapter()
    registerSrsBackend('write-stub', () => adapter)
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const manifestPath = writeManifest({ tools: { srs: { backend: 'write-stub' } } })
    const orphan: DraftCandidate = { kind: 'fr', confidence: 'medium', fr: { parentEpicId: 'nowhere', fr: { id: 'FR-9', title: 'Orphan' } }, source: { kind: 'notion-pages' } }
    const specPath = writeSpec([makeEpic('Auth'), makeEpic('Billing'), orphan])

    const code = await runWriteSrs({ specPath, manifestPath })

    expect(code).toBe(2)
    expect(adapter.createdEpics).toHaveLength(0)
    expect(adapter.createdFrs).toHaveLength(0)
  })

  it('surfaces a rollbackHint listing previously created pages on partial failure', async () => {
    const adapter = new StubAdapter(1)
    registerSrsBackend('write-stub', () => adapter)
    const stdout: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk))
      return true
    })

    const manifestPath = writeManifest({ tools: { srs: { backend: 'write-stub' } } })
    const specPath = writeSpec([makeEpic('Auth'), makeEpic('Billing'), makeEpic('Inbox')])

    const code = await runWriteSrs({ specPath, manifestPath })

    expect(code).toBe(6)
    const body = JSON.parse(stdout.join(''))
    expect(body.created).toHaveLength(1)
    expect(body.failed).toHaveLength(1)
    expect(body.failed[0].index).toBe(1)
    expect(body.pendingIngestionCleared).toBe(false)
    expect(body.rollbackHint).toMatch(/1 page\(s\) were created/)
    expect(body.rollbackHint).toMatch(/https:\/\/notion\.so\/epic-1/)
  })

  it('reports a first-candidate failure with a no-rollback hint', async () => {
    const adapter = new StubAdapter(0)
    registerSrsBackend('write-stub', () => adapter)
    const stdout: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk))
      return true
    })

    const manifestPath = writeManifest({ tools: { srs: { backend: 'write-stub' } } })
    const specPath = writeSpec([makeEpic('Auth'), makeEpic('Billing')])

    const code = await runWriteSrs({ specPath, manifestPath })

    expect(code).toBe(6)
    const body = JSON.parse(stdout.join(''))
    expect(body.created).toHaveLength(0)
    expect(body.rollbackHint).toMatch(/Nothing to roll back/)
  })

  it('returns 2 when spec is empty', async () => {
    registerSrsBackend('write-stub', () => new StubAdapter())
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const manifestPath = writeManifest({ tools: { srs: { backend: 'write-stub' } } })
    const specPath = writeSpec([])
    const code = await runWriteSrs({ specPath, manifestPath })
    expect(code).toBe(2)
  })

  it('returns 2 when spec has invalid shape (not an array or candidates wrapper)', async () => {
    registerSrsBackend('write-stub', () => new StubAdapter())
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const manifestPath = writeManifest({ tools: { srs: { backend: 'write-stub' } } })
    const specPath = writeSpec({ rogue: 'shape' })
    const code = await runWriteSrs({ specPath, manifestPath })
    expect(code).toBe(2)
  })

  it('accepts { candidates: [...] } wrapper shape', async () => {
    const adapter = new StubAdapter()
    registerSrsBackend('write-stub', () => adapter)
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const manifestPath = writeManifest({ tools: { srs: { backend: 'write-stub' } } })
    const specPath = writeSpec({ candidates: [makeEpic('Auth')] })
    const code = await runWriteSrs({ specPath, manifestPath })
    expect(code).toBe(0)
    expect(adapter.createdEpics).toHaveLength(1)
  })

  it('skips pendingIngestion clearing when --no-clear-pending is set', async () => {
    const adapter = new StubAdapter()
    registerSrsBackend('write-stub', () => adapter)
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const manifestPath = writeManifest({
      tools: {
        srs: {
          backend: 'write-stub',
          pendingIngestion: { sourceBackend: 'notion', sourceParent: { id: 'p', url: '', name: 'n' }, createdAt: 'x' }
        }
      }
    })
    const specPath = writeSpec([makeEpic('Auth')])

    const code = await runWriteSrs({ specPath, manifestPath, clearPendingIngestion: false })
    expect(code).toBe(0)
    const updatedManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    expect(updatedManifest.tools.srs.pendingIngestion).toBeDefined()
  })

  it('rejects an epic candidate missing its epic spec with exit 2 (bad input)', async () => {
    registerSrsBackend('write-stub', () => new StubAdapter())
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const manifestPath = writeManifest({ tools: { srs: { backend: 'write-stub' } } })
    const bogus: DraftCandidate = { kind: 'epic', confidence: 'low', source: { kind: 'notion-pages' } }
    const specPath = writeSpec([bogus])
    const code = await runWriteSrs({ specPath, manifestPath })
    expect(code).toBe(2)
  })

  it('rejects a candidate with unknown kind upfront with exit 2', async () => {
    registerSrsBackend('write-stub', () => new StubAdapter())
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const manifestPath = writeManifest({ tools: { srs: { backend: 'write-stub' } } })
    const bogus = { kind: 'rogue', confidence: 'low', source: { kind: 'notion-pages' } } as unknown as DraftCandidate
    const specPath = writeSpec([bogus])
    const code = await runWriteSrs({ specPath, manifestPath })
    expect(code).toBe(2)
  })

  // This test used to attach the FR straight to the feature, which is the
  // two-level model #518 refuses. It now writes the three levels the SRS actually
  // has: feature → version → FR.
  it('resolves FR parentEpicId to the version created earlier in the same batch', async () => {
    const adapter = new StubAdapter()
    registerSrsBackend('write-stub', () => adapter)
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const manifestPath = writeManifest({ tools: { srs: { backend: 'write-stub' } } })
    const featureCandidate: DraftCandidate = {
      kind: 'epic',
      confidence: 'medium',
      epic: { title: 'Auth', id: 'EPIC-AUTH', parentPageId: 'root', urs: [], frs: [] },
      source: { kind: 'notion-pages' }
    }
    const versionCandidate: DraftCandidate = {
      kind: 'epic',
      confidence: 'medium',
      epic: { title: 'MVP', id: 'AUTH-MVP', parentId: 'EPIC-AUTH', parentPageId: 'ignored', urs: [], frs: [] },
      source: { kind: 'notion-pages' }
    }
    const frCandidate: DraftCandidate = {
      kind: 'fr',
      confidence: 'medium',
      fr: { parentEpicId: 'AUTH-MVP', fr: { id: 'FR-AUTH-01', title: 'Login endpoint' } },
      source: { kind: 'notion-pages' }
    }
    const specPath = writeSpec([featureCandidate, versionCandidate, frCandidate])

    const code = await runWriteSrs({ specPath, manifestPath })

    expect(code).toBe(0)
    expect(adapter.createdFrs).toHaveLength(1)
    // The version page, not the feature: epic-1 is the feature, epic-2 the version.
    expect(adapter.createdFrs[0].parentEpicPageId).toBe('epic-2')
  })

  /**
   * Reading tolerates the flat shape because 25 real features are in it and their
   * FRs must not be lost. Writing does not — there is no reason to create a new
   * feature that already needs `sf srs normalize`. This is the one deliberate
   * breaking change in the chain.
   */
  it('refuses an FR attached to a feature rather than a version, before creating any page', async () => {
    const adapter = new StubAdapter()
    registerSrsBackend('write-stub', () => adapter)
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const manifestPath = writeManifest({ tools: { srs: { backend: 'write-stub' } } })
    const specPath = writeSpec([
      { kind: 'epic', confidence: 'medium', epic: { title: 'Auth', id: 'EPIC-AUTH', parentPageId: 'root', urs: [], frs: [] }, source: { kind: 'notion-pages' } },
      { kind: 'fr', confidence: 'medium', fr: { parentEpicId: 'EPIC-AUTH', fr: { id: 'FR-AUTH-01', title: 'Login' } }, source: { kind: 'notion-pages' } }
    ] as DraftCandidate[])

    const code = await runWriteSrs({ specPath, manifestPath })

    // Checked with the whole batch (#877): the feature page is not written either
    expect(code).toBe(2)
    expect(adapter.createdEpics).toHaveLength(0)
    expect(adapter.createdFrs).toHaveLength(0)
    const printed = stderr.mock.calls.map((c) => String(c[0])).join('')
    expect(printed).toMatch(/which is a feature, not a version/)
    expect(printed).toMatch(/Epic = feature \+ version/)
  })

  it('fails with code 2 and a clear error when parentEpicId is unresolved, before creating any page', async () => {
    const adapter = new StubAdapter()
    registerSrsBackend('write-stub', () => adapter)
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const manifestPath = writeManifest({ tools: { srs: { backend: 'write-stub' } } })
    const frCandidate: DraftCandidate = {
      kind: 'fr',
      confidence: 'medium',
      fr: { parentEpicId: 'EPIC-MISSING', fr: { id: 'FR-1', title: 'Orphan' } },
      source: { kind: 'notion-pages' }
    }
    const specPath = writeSpec([frCandidate])

    const code = await runWriteSrs({ specPath, manifestPath })

    expect(code).toBe(2)
    expect(adapter.createdFrs).toHaveLength(0)
    expect(stderr.mock.calls.map((c) => String(c[0])).join('')).toMatch(/parentEpicId="EPIC-MISSING"/)
  })

  it('still accepts explicit parentEpicPageId as an escape hatch', async () => {
    const adapter = new StubAdapter()
    registerSrsBackend('write-stub', () => adapter)
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const manifestPath = writeManifest({ tools: { srs: { backend: 'write-stub' } } })
    const frCandidate: DraftCandidate = {
      kind: 'fr',
      confidence: 'medium',
      fr: { parentEpicPageId: 'pre-existing-epic-xyz', fr: { id: 'FR-1', title: 'Attach to existing' } },
      source: { kind: 'notion-pages' }
    }
    const specPath = writeSpec([frCandidate])

    const code = await runWriteSrs({ specPath, manifestPath })

    expect(code).toBe(0)
    expect(adapter.createdFrs[0].parentEpicPageId).toBe('pre-existing-epic-xyz')
  })

  it('rejects an FR candidate with neither parentEpicPageId nor parentEpicId (exit 2)', async () => {
    registerSrsBackend('write-stub', () => new StubAdapter())
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const manifestPath = writeManifest({ tools: { srs: { backend: 'write-stub' } } })
    const frCandidate: DraftCandidate = {
      kind: 'fr',
      confidence: 'medium',
      fr: { fr: { id: 'FR-1', title: 'Floating' } } as FrSpec,
      source: { kind: 'notion-pages' }
    }
    const specPath = writeSpec([frCandidate])

    const code = await runWriteSrs({ specPath, manifestPath })

    expect(code).toBe(2)
  })
})

// ── #518: the three-level model ───────────────────────────────────────────
describe('write-srs — feature → version → FR in one spec', () => {
  const feature = (id: string, title: string): DraftCandidate => ({
    kind: 'epic',
    confidence: 'high',
    epic: { id, title, parentPageId: 'root', urs: [], frs: [] },
    source: { kind: 'notion-pages' }
  })

  const version = (id: string, parentId: string, title: string): DraftCandidate => ({
    kind: 'epic',
    confidence: 'high',
    epic: { id, parentId, title, parentPageId: 'ignored', urs: [], frs: [], version: { changes: ['topic-aware notes'] } },
    source: { kind: 'notion-pages' }
  })

  const fr = (parentEpicId: string, id: string): DraftCandidate => ({
    kind: 'fr',
    confidence: 'high',
    fr: { parentEpicId, fr: { id, title: 'Something' } },
    source: { kind: 'notion-pages' }
  })

  it('collects the versions declared under each feature, before anything is written', () => {
    const map = collectVersionsByFeature([feature('feat', 'Réunion live'), version('v1', 'feat', 'v1 — Existant'), version('v2', 'feat', 'v2 — Notes vivantes'), fr('v2', 'FR-LIVE-007')])
    expect(map.get('feat')).toEqual(['v1 — Existant', 'v2 — Notes vivantes'])
  })

  it('gives a feature no version index when the batch declares none', () => {
    expect(collectVersionsByFeature([feature('feat', 'Réunion live')]).get('feat')).toBeUndefined()
  })

  // #850 — the feature page needs its versions' FRs to link URs and DSs to them
  it("collects each feature's version FRs, the fr candidate's references winning", () => {
    const listed = version('v2', 'feat', 'v2 — Notes vivantes')
    listed.epic!.frs = [
      { id: 'FR-LIVE-007', title: 'Listed only by the version' },
      { id: 'FR-LIVE-008', title: 'Topic grouping', priority: 'P2' }
    ]
    const detailed: DraftCandidate = {
      kind: 'fr',
      confidence: 'high',
      fr: { parentEpicId: 'v2', fr: { id: 'FR-LIVE-007', title: 'Topic-aware notes', urRefs: ['UR-1'], dsRefs: ['DS-1'] } },
      source: { kind: 'notion-pages' }
    }

    const frs = collectFrsByFeature([feature('feat', 'Réunion live'), listed, detailed, fr('elsewhere', 'FR-X')])

    expect(frs.get('feat')).toEqual([
      { id: 'FR-LIVE-007', title: 'Topic-aware notes', urRefs: ['UR-1'], dsRefs: ['DS-1'], version: 'v2 — Notes vivantes' },
      { id: 'FR-LIVE-008', title: 'Topic grouping', priority: 'P2', version: 'v2 — Notes vivantes' }
    ])
  })

  it('hands the feature page its version FRs when it writes it', async () => {
    const adapter = new StubAdapter()
    registerSrsBackend('write-stub', () => adapter)
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const tmpDir = mkdtempSync(join(tmpdir(), 'sf-srs-write-frs-'))
    try {
      const manifestPath = join(tmpDir, '.saasfoundry.json')
      writeFileSync(manifestPath, JSON.stringify({ tools: { srs: { backend: 'write-stub' } } }))
      const specPath = join(tmpDir, 'spec.json')
      writeFileSync(specPath, JSON.stringify([feature('feat', 'Réunion live'), version('v2', 'feat', 'v2 — Notes vivantes'), fr('v2', 'FR-LIVE-007')]))

      await expect(runWriteSrs({ specPath, manifestPath })).resolves.toBe(0)

      expect(adapter.createdEpics[0].versionFrs).toEqual([{ id: 'FR-LIVE-007', title: 'Something', version: 'v2 — Notes vivantes' }])
    } finally {
      unregisterSrsBackend('write-stub')
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

// #899 — a version could hang only under a feature declared in the same batch, so the second
// version of every feature needed a node script and a hand-edited Versions list
describe('write-srs — a version under a feature written in an earlier batch', () => {
  const FEATURE_URL = 'https://www.notion.so/Reunion-live-1234567890abcdef1234567890abcdef'
  const FEATURE_ID = '12345678-90ab-cdef-1234-567890abcdef'

  class ExistingFeatureAdapter extends StubAdapter {
    extensions: Array<{ pageId: string; additions: SectionAddition[] }> = []
    updates: Array<{ pageId: string; content: PageContent }> = []
    extendSections?: (pageId: string, additions: SectionAddition[]) => Promise<SectionAdditionOutcome[]>
    constructor(options: { outcome?: SectionAdditionOutcome; rootChildren?: string[]; canExtend?: boolean } = {}) {
      super()
      this.rootChildren = options.rootChildren ?? [FEATURE_ID]
      if (options.canExtend !== false) {
        this.extendSections = async (pageId, additions) => {
          this.extensions.push({ pageId, additions })
          return additions.map(() => options.outcome ?? 'extended')
        }
      }
    }
    private readonly rootChildren: string[]
    async resolveParent(input: string): Promise<ResolvedParent> {
      return { id: FEATURE_ID, name: 'Réunion live', url: input }
    }
    async listChildren(): Promise<PageRef[]> {
      return this.rootChildren.map((id) => ({ id: id.replace(/-/g, ''), url: '', title: 'Feature' }))
    }
    async updatePage(pageId: string, content: PageContent): Promise<void> {
      this.updates.push({ pageId, content })
    }
  }

  const version = (id: string, parentId: string, title: string): DraftCandidate => ({
    kind: 'epic',
    confidence: 'high',
    epic: { id, parentId, title, parentPageId: 'ignored', urs: [], frs: [], version: { changes: ['topic-aware notes'] } },
    source: { kind: 'notion-pages' }
  })
  const fr = (parentEpicId: string, id: string): DraftCandidate => ({ kind: 'fr', confidence: 'high', fr: { parentEpicId, fr: { id, title: 'Something' } }, source: { kind: 'notion-pages' } })

  let tmpDir: string
  let stderr: string[]
  let stdout: string[]
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sf-srs-write-existing-'))
    stderr = []
    stdout = []
    jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk))
      return true
    })
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk))
      return true
    })
  })
  afterEach(() => {
    unregisterSrsBackend('write-stub')
    rmSync(tmpDir, { recursive: true, force: true })
    jest.restoreAllMocks()
  })

  const run = async (adapter: SrsAdapter, candidates: DraftCandidate[], rootPage: { id?: string } | null = { id: 'root-id' }) => {
    registerSrsBackend('write-stub', () => adapter)
    const manifestPath = join(tmpDir, '.saasfoundry.json')
    writeFileSync(manifestPath, JSON.stringify({ tools: { srs: { backend: 'write-stub', ...(rootPage ? { rootPage } : {}) } } }))
    const specPath = join(tmpDir, 'spec.json')
    writeFileSync(specPath, JSON.stringify(candidates))
    return runWriteSrs({ specPath, manifestPath, clearPendingIngestion: false })
  }

  it('passes the offline check with a page reference, and still refuses an unknown logical id', () => {
    expect(checkSpec([version('v1', FEATURE_URL, 'v1 — Topics'), fr('v1', 'FR-1')]).errors).toEqual([])
    expect(checkSpec([version('v1', FEATURE_ID, 'v1 — Topics')]).errors).toEqual([])
    const typo = checkSpec([version('v1', 'feat', 'v1 — Topics')]).errors
    expect(typo).toHaveLength(1)
    expect(typo[0]).toContain("set parentId to that feature page's URL or id")
  })

  it('writes the version and its FRs under the existing feature, and lists the version there in place', async () => {
    const adapter = new ExistingFeatureAdapter()

    await expect(run(adapter, [version('v1', FEATURE_URL, 'v1 — Topics'), fr('v1', 'FR-1')])).resolves.toBe(0)

    expect(adapter.createdEpics[0].parentPageId).toBe(FEATURE_ID)
    expect(adapter.createdFrs[0].parentEpicPageId).toBe('epic-1')
    expect(adapter.extensions[0]).toEqual({
      pageId: FEATURE_ID,
      additions: [{ kind: 'list-items', heading: 'Versions', items: ['v1 — Topics'], createBefore: 'Traceability', intro: expect.stringContaining('Each version below') }]
    })
    // #900 — the version's FRs join the feature's FR table, in whichever shape that table has
    expect(adapter.extensions[1]).toEqual({
      pageId: FEATURE_ID,
      additions: [
        {
          kind: 'table-rows',
          heading: 'Functional Requirements (FR)',
          layouts: [
            { header: ['ID', 'Requirement', 'Version', 'Priority', 'Related UR', 'Related DS'], rows: [['FR-1', 'Something', 'v1 — Topics', '—', '—', '—']] },
            { header: ['ID', 'Requirement', 'Priority', 'Related UR', 'Related DS'], rows: [['FR-1', 'Something', '—', '—', '—']] }
          ]
        }
      ]
    })
    expect(adapter.updates).toEqual([])
  })

  it('refuses a page that is not a feature of this SRS, before writing anything', async () => {
    const adapter = new ExistingFeatureAdapter({ rootChildren: ['another-feature'] })

    await expect(run(adapter, [version('v1', FEATURE_URL, 'v1 — Topics')])).resolves.toBe(2)

    expect(adapter.createdEpics).toEqual([])
    expect(stderr.join('')).toContain('is the page "Réunion live", which is not a feature of this SRS')
  })

  it('refuses without the SRS root page in the manifest, which the check needs', async () => {
    const adapter = new ExistingFeatureAdapter()

    await expect(run(adapter, [version('v1', FEATURE_URL, 'v1 — Topics')], null)).resolves.toBe(2)

    expect(adapter.createdEpics).toEqual([])
    expect(stderr.join('')).toContain('tools.srs.rootPage.id')
  })

  it('appends the Versions section to the end of a page that has nowhere to put it', async () => {
    const adapter = new ExistingFeatureAdapter({ outcome: 'unplaced' })

    await expect(run(adapter, [version('v1', FEATURE_URL, 'v1 — Topics')])).resolves.toBe(0)

    expect(adapter.updates).toEqual([
      {
        pageId: FEATURE_ID,
        content: {
          blocks: [
            { kind: 'heading', level: 2, text: 'Versions' },
            { kind: 'bulleted_list', items: ['v1 — Topics'] }
          ]
        }
      }
    ])
  })

  it('reports what a backend that cannot edit pages leaves to add by hand', async () => {
    const adapter = new ExistingFeatureAdapter({ canExtend: false })

    await expect(run(adapter, [version('v1', FEATURE_URL, 'v1 — Topics')])).resolves.toBe(0)

    expect(JSON.parse(stdout.join('')).notPlaced).toEqual(['v1 — Topics: add to "Versions" by hand — this SRS backend cannot edit an existing page.'])
  })
})

// #900 — a version's and its FRs' UR / DS / TC / NFR items were dropped without a word
describe('write-srs — the items of a version and its FRs reach the feature tables', () => {
  const feature: DraftCandidate = { kind: 'epic', confidence: 'high', epic: { id: 'feat', title: 'Réunion live', parentPageId: 'root', urs: [], frs: [] }, source: { kind: 'notion-pages' } }
  const version: DraftCandidate = {
    kind: 'epic',
    confidence: 'high',
    epic: {
      id: 'v1',
      parentId: 'feat',
      title: 'v1 — Topics',
      parentPageId: 'ignored',
      urs: [{ id: 'UR-2', narrative: 'Listed by the version' }],
      frs: [],
      nfrItems: [{ id: 'NFR-1', title: 'Topic latency', target: '≤ 2 s' }]
    },
    source: { kind: 'notion-pages' }
  }
  const frCandidate: DraftCandidate = {
    kind: 'fr',
    confidence: 'high',
    fr: {
      parentEpicId: 'v1',
      fr: { id: 'FR-2', title: 'Topic grouping', urRefs: ['UR-2'], dsRefs: ['DS-1'] },
      urs: [{ id: 'UR-2', narrative: 'See notes by topic' }],
      dsItems: [{ id: 'DS-1', title: 'Topic store' }],
      tcItems: [{ id: 'TC-1', title: 'Topics appear' }]
    },
    source: { kind: 'notion-pages' }
  }

  it('collects them per feature with their version, the FR candidate winning', () => {
    expect(collectItemsByFeature([feature, version, frCandidate]).get('feat')).toEqual({
      urs: [{ id: 'UR-2', narrative: 'See notes by topic', version: 'v1 — Topics' }],
      dsItems: [{ id: 'DS-1', title: 'Topic store', version: 'v1 — Topics' }],
      tcItems: [{ id: 'TC-1', title: 'Topics appear', version: 'v1 — Topics' }],
      nfrItems: [{ id: 'NFR-1', title: 'Topic latency', target: '≤ 2 s', version: 'v1 — Topics' }]
    })
    expect(collectItemsByFeature([feature]).get('feat')).toBeUndefined()
  })

  it('hands them to the feature page it writes', async () => {
    const adapter = new StubAdapter()
    registerSrsBackend('write-stub', () => adapter)
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const tmpDir = mkdtempSync(join(tmpdir(), 'sf-srs-write-items-'))
    try {
      const manifestPath = join(tmpDir, '.saasfoundry.json')
      writeFileSync(manifestPath, JSON.stringify({ tools: { srs: { backend: 'write-stub' } } }))
      const specPath = join(tmpDir, 'spec.json')
      writeFileSync(specPath, JSON.stringify([feature, version, frCandidate]))

      await expect(runWriteSrs({ specPath, manifestPath, clearPendingIngestion: false })).resolves.toBe(0)

      expect(adapter.createdEpics[0].versionItems?.dsItems).toEqual([{ id: 'DS-1', title: 'Topic store', version: 'v1 — Topics' }])
    } finally {
      unregisterSrsBackend('write-stub')
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('warns that the items of an FR attached by page id reach the feature tables only through a version', () => {
    const byPage: DraftCandidate = {
      kind: 'fr',
      confidence: 'high',
      fr: { parentEpicPageId: 'page-1', fr: { id: 'FR-3', title: 'Elsewhere' }, dsItems: [{ id: 'DS-9', title: 'Lost' }] },
      source: { kind: 'notion-pages' }
    }

    const check = checkSpec([byPage])

    expect(check.errors).toEqual([])
    expect(check.warnings).toEqual([
      'write-srs: candidate #0 (fr) carries dsItems and is attached by parentEpicPageId: they reach the feature tables only if that page is a version of this SRS, which write checks before writing anything.'
    ])
  })
})

// #919 — two sessions extending one feature both wrote "v3" and the same ids
describe('write-srs — refuses what the existing feature already holds', () => {
  const FEATURE_ID = '12345678-90ab-cdef-1234-567890abcdef'
  const FEATURE_URL = 'https://www.notion.so/Reunion-live-1234567890abcdef1234567890abcdef'

  /** Root → feature → `v1 — Existing` → FR-LIVE-007; the feature's UR table lists UR-LIVE-004. */
  class FeatureWithHistory extends StubAdapter {
    async resolveParent(input: string): Promise<ResolvedParent> {
      return { id: FEATURE_ID, name: 'Réunion live', url: input }
    }
    async listChildren(parentPageId?: string): Promise<PageRef[]> {
      if (parentPageId === 'root-id') return [{ id: FEATURE_ID.replace(/-/g, ''), url: '', title: 'Réunion live' }]
      if (parentPageId === FEATURE_ID) return [{ id: 'version-1', url: '', title: 'v1 — Existing' }]
      if (parentPageId === 'version-1') return [{ id: 'fr-page', url: '', title: 'FR-LIVE-007 — Topic notes' }]
      return []
    }
    async fetchPage(pageId: string): Promise<RawContent> {
      return {
        pageId,
        title: 'Réunion live',
        url: '',
        blocks: [
          {
            kind: 'table',
            text: '',
            rows: [
              ['ID', 'Requirement', 'Version', 'Priority', 'Related FR'],
              ['UR-LIVE-004', 'Notes by topic', 'v1 — Existing', 'P1', 'FR-LIVE-007']
            ]
          }
        ]
      }
    }
    extendSections = async (_pageId: string, additions: SectionAddition[]): Promise<SectionAdditionOutcome[]> => additions.map(() => 'extended')
  }

  const version = (title: string, frs: { id: string; title: string }[] = []): DraftCandidate => ({
    kind: 'epic',
    confidence: 'high',
    epic: { id: 'NEW', parentId: FEATURE_URL, title, parentPageId: 'ignored', urs: [], frs, version: { changes: ['more'] } },
    source: { kind: 'notion-pages' }
  })
  const fr = (id: string, urs: { id: string; narrative: string }[] = []): DraftCandidate => ({
    kind: 'fr',
    confidence: 'high',
    fr: { parentEpicId: 'NEW', fr: { id, title: 'Something' }, urs },
    source: { kind: 'notion-pages' }
  })

  let tmpDir: string
  let stderr: string[]
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sf-srs-write-clash-'))
    stderr = []
    jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk))
      return true
    })
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })
  afterEach(() => {
    unregisterSrsBackend('clash-stub')
    rmSync(tmpDir, { recursive: true, force: true })
    jest.restoreAllMocks()
  })

  const run = async (adapter: SrsAdapter, candidates: DraftCandidate[]) => {
    registerSrsBackend('clash-stub', () => adapter)
    const manifestPath = join(tmpDir, '.saasfoundry.json')
    writeFileSync(manifestPath, JSON.stringify({ tools: { srs: { backend: 'clash-stub', rootPage: { id: 'root-id' } } } }))
    const specPath = join(tmpDir, 'spec.json')
    writeFileSync(specPath, JSON.stringify(candidates))
    return runWriteSrs({ specPath, manifestPath, clearPendingIngestion: false })
  }

  it('refuses a version number the feature already has, and names the next one', async () => {
    const adapter = new FeatureWithHistory()
    await expect(run(adapter, [version('v1 — Another take')])).resolves.toBe(2)
    expect(adapter.createdEpics).toEqual([])
    expect(stderr.join('')).toContain('version number v1')
    expect(stderr.join('')).toContain('next version: v2')
  })

  it('refuses an FR id an FR page carries and a UR id a feature table lists, before writing anything', async () => {
    const adapter = new FeatureWithHistory()
    await expect(run(adapter, [version('v2 — Live topics'), fr('FR-LIVE-007', [{ id: 'UR-LIVE-004', narrative: 'again' }])])).resolves.toBe(2)
    expect(adapter.createdEpics).toEqual([])
    expect(adapter.createdFrs).toEqual([])
    const message = stderr.join('')
    expect(message).toContain('FR-LIVE-007')
    expect(message).toContain('UR-LIVE-004')
    expect(message).toContain('FR-LIVE-008')
    expect(message).toContain('UR-LIVE-005')
  })

  it('writes a version whose title and ids are new', async () => {
    const adapter = new FeatureWithHistory()
    await expect(run(adapter, [version('v2 — Live topics', [{ id: 'FR-LIVE-008', title: 'Consolidation' }]), fr('FR-LIVE-008', [{ id: 'UR-LIVE-005', narrative: 'new' }])])).resolves.toBe(0)
    expect(adapter.createdEpics).toHaveLength(1)
    expect(adapter.createdFrs).toHaveLength(1)
  })
})

// #917 — an FR joining a version keeps the version and its feature consistent
describe('write-srs — FRs joining a version', () => {
  /** root → feature "Live" → "v1 — Topics" → FR-LIVE-001 */
  class VersionedFeature extends StubAdapter {
    extensions: Array<{ pageId: string; additions: SectionAddition[] }> = []
    async listChildren(parentPageId?: string): Promise<PageRef[]> {
      if (parentPageId === 'root-id') return [{ id: 'feature', url: '', title: 'Live' }]
      if (parentPageId === 'feature') return [{ id: 'version-1', url: '', title: 'v1 — Topics' }]
      if (parentPageId === 'version-1') return [{ id: 'fr-page', url: '', title: 'FR-LIVE-001 — Notes' }]
      return []
    }
    extendSections = async (pageId: string, additions: SectionAddition[]): Promise<SectionAdditionOutcome[]> => {
      this.extensions.push({ pageId, additions })
      return additions.map(() => 'extended')
    }
  }

  let tmpDir: string
  let stderr: string[]
  let stdout: string[]
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sf-srs-write-joining-'))
    stderr = []
    stdout = []
    jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk))
      return true
    })
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk))
      return true
    })
  })
  afterEach(() => {
    unregisterSrsBackend('joining-stub')
    rmSync(tmpDir, { recursive: true, force: true })
    jest.restoreAllMocks()
  })

  const run = async (adapter: SrsAdapter, candidates: DraftCandidate[]) => {
    registerSrsBackend('joining-stub', () => adapter)
    const manifestPath = join(tmpDir, '.saasfoundry.json')
    writeFileSync(manifestPath, JSON.stringify({ tools: { srs: { backend: 'joining-stub', rootPage: { id: 'root-id' } } } }))
    const specPath = join(tmpDir, 'spec.json')
    writeFileSync(specPath, JSON.stringify(candidates))
    return runWriteSrs({ specPath, manifestPath, clearPendingIngestion: false })
  }
  const attached = (fr: Partial<FrSpec> & { fr: FrSpec['fr'] }): DraftCandidate => ({ kind: 'fr', confidence: 'high', fr: { parentEpicPageId: 'version-1', ...fr }, source: { kind: 'notion-pages' } })

  it('lists on a new version page the FR candidates attached to it, not only its own frs', async () => {
    const adapter = new StubAdapter()
    const candidates: DraftCandidate[] = [
      { kind: 'epic', confidence: 'high', epic: { id: 'F', title: 'Feature', parentPageId: 'root', urs: [], frs: [] }, source: { kind: 'notion-pages' } },
      { kind: 'epic', confidence: 'high', epic: { id: 'V1', parentId: 'F', title: 'v1 — First', parentPageId: '', urs: [], frs: [] }, source: { kind: 'notion-pages' } },
      { kind: 'fr', confidence: 'high', fr: { parentEpicId: 'V1', fr: { id: 'FR-X-001', title: 'Attached' } }, source: { kind: 'notion-pages' } }
    ]
    await expect(run(adapter, candidates)).resolves.toBe(0)
    expect(adapter.createdEpics[1].frs.map((fr) => fr.id)).toEqual(['FR-X-001'])
  })

  it('adds an FR attached by page id to the version page and the feature, with the default change line', async () => {
    const adapter = new VersionedFeature()
    await expect(run(adapter, [attached({ fr: { id: 'FR-LIVE-002', title: 'Consolidation' }, urs: [{ id: 'UR-LIVE-002', narrative: 'consolidate' }] })])).resolves.toBe(0)
    expect(adapter.createdFrs[0].parentEpicPageId).toBe('version-1')
    const onVersion = adapter.extensions.find((extension) => extension.pageId === 'version-1')!
    expect(onVersion.additions[0]).toEqual({ kind: 'list-items', heading: 'What changed in this version', items: ['Adds FR-LIVE-002 — Consolidation'] })
    expect(onVersion.additions[1]).toMatchObject({ kind: 'table-rows', heading: 'Functional Requirements (FR)' })
    const onFeature = JSON.stringify(adapter.extensions.find((extension) => extension.pageId === 'feature')!.additions)
    expect(onFeature).toContain('FR-LIVE-002')
    expect(onFeature).toContain('UR-LIVE-002')
    expect(onFeature).toContain('v1 — Topics')
  })

  it('uses the change the FR candidate words', async () => {
    const adapter = new VersionedFeature()
    await run(adapter, [attached({ fr: { id: 'FR-LIVE-002', title: 'Consolidation' }, change: 'Notes consolidate per topic' })])
    expect(adapter.extensions.find((extension) => extension.pageId === 'version-1')!.additions[0]).toMatchObject({ items: ['Notes consolidate per topic'] })
  })

  it('refuses an attached FR whose id the feature already holds, before writing', async () => {
    const adapter = new VersionedFeature()
    await expect(run(adapter, [attached({ fr: { id: 'FR-LIVE-001', title: 'Again' } })])).resolves.toBe(2)
    expect(adapter.createdFrs).toEqual([])
    expect(stderr.join('')).toContain('FR-LIVE-002')
  })

  it('writes an FR under a page that is not a version, and says no table lists it', async () => {
    const adapter = new VersionedFeature()
    await expect(run(adapter, [{ kind: 'fr', confidence: 'high', fr: { parentEpicPageId: 'somewhere', fr: { id: 'FR-9', title: 'Loose' } }, source: { kind: 'notion-pages' } }])).resolves.toBe(0)
    expect(adapter.createdFrs).toHaveLength(1)
    expect(stderr.join('')).toContain('not a version of this SRS')
  })
})

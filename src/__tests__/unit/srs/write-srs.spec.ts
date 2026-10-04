import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DraftCandidate, EpicSpec, FrSpec, PageContent, PageRef, RawContent, ResolvedParent, SectionAddition, SectionAdditionOutcome, SrsAdapter } from '../../../builders/srs/types'
import { registerSrsBackend, unregisterSrsBackend } from '../../../srs'
import { checkSpec, collectFrsByFeature, collectVersionsByFeature, runWriteSrs } from '../../../srs/bin/write-srs'

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
  async listChildren(): Promise<PageRef[]> {
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
    expect(adapter.extensions).toEqual([
      { pageId: FEATURE_ID, additions: [{ kind: 'list-items', heading: 'Versions', items: ['v1 — Topics'], createBefore: 'Traceability', intro: expect.stringContaining('Each version below') }] }
    ])
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

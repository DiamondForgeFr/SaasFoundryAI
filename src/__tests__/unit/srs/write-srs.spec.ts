import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DraftCandidate, EpicSpec, FrSpec, PageContent, PageRef, RawContent, ResolvedParent, SrsAdapter } from '../../../builders/srs/types'
import { registerSrsBackend, unregisterSrsBackend } from '../../../srs'
import { collectVersionsByFeature, runWriteSrs } from '../../../srs/bin/write-srs'

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
  it('refuses an FR attached to a feature rather than a version', async () => {
    const adapter = new StubAdapter()
    registerSrsBackend('write-stub', () => adapter)
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const manifestPath = writeManifest({ tools: { srs: { backend: 'write-stub' } } })
    const specPath = writeSpec([
      { kind: 'epic', confidence: 'medium', epic: { title: 'Auth', id: 'EPIC-AUTH', parentPageId: 'root', urs: [], frs: [] }, source: { kind: 'notion-pages' } },
      { kind: 'fr', confidence: 'medium', fr: { parentEpicId: 'EPIC-AUTH', fr: { id: 'FR-AUTH-01', title: 'Login' } }, source: { kind: 'notion-pages' } }
    ] as DraftCandidate[])

    const code = await runWriteSrs({ specPath, manifestPath })

    expect(code).toBe(6)
    expect(adapter.createdFrs).toHaveLength(0)
    const printed = stdout.mock.calls.map((c) => String(c[0])).join('')
    expect(printed).toMatch(/which is a feature, not a version/)
    expect(printed).toMatch(/Epic = feature \+ version/)
  })

  it('fails with code 6 and a clear error when parentEpicId is unresolved', async () => {
    const adapter = new StubAdapter()
    registerSrsBackend('write-stub', () => adapter)
    const stdout: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk))
      return true
    })

    const manifestPath = writeManifest({ tools: { srs: { backend: 'write-stub' } } })
    const frCandidate: DraftCandidate = {
      kind: 'fr',
      confidence: 'medium',
      fr: { parentEpicId: 'EPIC-MISSING', fr: { id: 'FR-1', title: 'Orphan' } },
      source: { kind: 'notion-pages' }
    }
    const specPath = writeSpec([frCandidate])

    const code = await runWriteSrs({ specPath, manifestPath })

    expect(code).toBe(6)
    const body = JSON.parse(stdout.join(''))
    expect(body.failed[0].error).toMatch(/parentEpicId="EPIC-MISSING"/)
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
})

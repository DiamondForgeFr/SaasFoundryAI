import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EpicSpec, FrSpec, PageRef, RawContent, ResolvedParent, SrsAdapter } from '../../../../builders/srs/types'
import { NormalizeOptions, parseArgs, runNormalize } from '../../../../srs/bin/normalize'
import { registerSrsBackend, unregisterSrsBackend } from '../../../../srs/registry'

class StubAdapter implements SrsAdapter {
  public readonly created: Array<{ parent: string; title: string }> = []
  public readonly moved: Array<{ pageId: string; parent: string }> = []

  constructor(
    private readonly tree: Record<string, PageRef[]>,
    private readonly failOn?: { move?: string; create?: string }
  ) {}

  async init(): Promise<void> {}
  async resolveParent(input: string): Promise<ResolvedParent> {
    return { id: input, name: input }
  }
  async createPage(parentPageId: string, title: string): Promise<PageRef> {
    if (this.failOn?.create === parentPageId) throw new Error('notion exploded')
    this.created.push({ parent: parentPageId, title })
    const id = `version-of-${parentPageId}`
    this.tree[id] = []
    return { id, url: `https://www.notion.so/${id}`, title }
  }
  async createEpicPage(spec: EpicSpec): Promise<PageRef> {
    return { id: 'e', url: '', title: spec.title }
  }
  async createFrPage(spec: FrSpec): Promise<PageRef> {
    return { id: 'f', url: '', title: spec.fr.title }
  }
  async updatePage(): Promise<void> {}
  async fetchPage(pageId: string): Promise<RawContent> {
    return { pageId, title: '', url: '', blocks: [] }
  }
  async listChildren(parentPageId: string): Promise<PageRef[]> {
    return this.tree[parentPageId] ?? []
  }
  async move(pageId: string, newParentPageId: string): Promise<void> {
    if (this.failOn?.move === pageId) throw new Error('notion refused the move')
    this.moved.push({ pageId, parent: newParentPageId })
  }
}

function page(id: string, title: string): PageRef {
  return { id, url: `https://www.notion.so/${id}`, title }
}

// Two flat features and one already-versioned, which is the live shape in miniature.
function liveShape(): Record<string, PageRef[]> {
  return {
    root: [page('flat-a', 'Capture audio & enregistrement'), page('flat-b', 'Import audio/vidéo'), page('deep', 'Réunion live'), page('bare', 'User flows & Specifications')],
    'flat-a': [page('fr-1', 'FR-CAPTURE-01 — Start'), page('fr-2', 'FR-CAPTURE-02 — Stop')],
    'flat-b': [page('fr-3', 'FR-IMPORT-01 — Import')],
    deep: [page('v1', 'v1 — Existant')],
    v1: [page('fr-4', 'FR-LIVE-001 — Transcript')],
    bare: []
  }
}

describe('normalize', () => {
  let tmp: string
  let io: { stdout: jest.Mock; stderr: jest.Mock; out: string[]; err: string[] }

  const makeIO = (): typeof io => {
    const out: string[] = []
    const err: string[] = []
    return { stdout: jest.fn((c: string) => out.push(c)), stderr: jest.fn((c: string) => err.push(c)), out, err }
  }

  const options = (overrides: Partial<NormalizeOptions> = {}): NormalizeOptions => ({
    manifestPath: join(tmp, '.saasfoundry.json'),
    versionName: 'MVP',
    apply: false,
    rootPageId: 'root',
    ...overrides
  })

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sf-srs-normalize-'))
    writeFileSync(join(tmp, '.saasfoundry.json'), JSON.stringify({ tools: { srs: { backend: 'stub', rootPage: { id: 'root' } } } }))
    io = makeIO()
  })

  afterEach(() => {
    unregisterSrsBackend('stub')
    rmSync(tmp, { recursive: true, force: true })
  })

  describe('parseArgs', () => {
    // Writing to a production SRS must be deliberate: the cost of an unintended
    // 196-page sweep is not symmetric with the cost of typing one more flag.
    it('defaults to a dry run', () => {
      expect(parseArgs([]).apply).toBe(false)
    })

    it('writes only when --apply is passed', () => {
      expect(parseArgs(['--apply']).apply).toBe(true)
    })

    it('accepts --dry-run as an explicit no-op so a script can spell out its intent', () => {
      expect(parseArgs(['--dry-run']).apply).toBe(false)
    })

    it('reads --feature and --version-name', () => {
      const opts = parseArgs(['--feature', 'https://notion.so/x', '--version-name', 'v1'])
      expect(opts.feature).toBe('https://notion.so/x')
      expect(opts.versionName).toBe('v1')
    })
  })

  describe('dry run', () => {
    it('prints the full plan and writes nothing', async () => {
      const adapter = new StubAdapter(liveShape())
      registerSrsBackend('stub', () => adapter)

      const code = await runNormalize(options(), io)

      expect(code).toBe(0)
      expect(adapter.created).toEqual([])
      expect(adapter.moved).toEqual([])
      const out = io.out.join('')
      expect(out).toMatch(/2 feature\(s\) to normalize, 3 FR page\(s\) to move/)
      expect(out).toMatch(/« Capture audio & enregistrement »/)
      expect(out).toMatch(/\+ create {3}« MVP »/)
      expect(out).toMatch(/dry-run/)
    })

    it('leaves an already-versioned feature out of the plan', async () => {
      registerSrsBackend('stub', () => new StubAdapter(liveShape()))
      const code = await runNormalize(options(), io)
      expect(code).toBe(0)
      expect(io.out.join('')).not.toMatch(/« Réunion live »/)
    })

    // Three real features carry no spec at all. An empty version page would be a
    // level with nothing under it.
    it('skips a feature with no FR instead of giving it an empty version', async () => {
      registerSrsBackend('stub', () => new StubAdapter(liveShape()))
      const code = await runNormalize(options(), io)
      expect(code).toBe(0)
      const out = io.out.join('')
      expect(out).toMatch(/« User flows & Specifications » — no FR page, skipped/)
      expect(out).not.toMatch(/« User flows & Specifications »\n {2}\+ create/)
    })
  })

  describe('--apply', () => {
    it('creates the version page and moves the FRs under it', async () => {
      const adapter = new StubAdapter(liveShape())
      registerSrsBackend('stub', () => adapter)

      const code = await runNormalize(options({ apply: true }), io)

      expect(code).toBe(0)
      expect(adapter.created).toEqual([
        { parent: 'flat-a', title: 'MVP' },
        { parent: 'flat-b', title: 'MVP' }
      ])
      expect(adapter.moved).toEqual([
        { pageId: 'fr-1', parent: 'version-of-flat-a' },
        { pageId: 'fr-2', parent: 'version-of-flat-a' },
        { pageId: 'fr-3', parent: 'version-of-flat-b' }
      ])
      expect(io.out.join('')).toMatch(/moved, not recreated/)
    })

    // Pages are moved so that ids and URLs survive. Recreating them would break
    // every existing link into the SRS.
    it('never creates a page in place of an FR', async () => {
      const adapter = new StubAdapter(liveShape())
      registerSrsBackend('stub', () => adapter)

      await runNormalize(options({ apply: true }), io)

      expect(adapter.created.every((c) => c.title === 'MVP')).toBe(true)
      expect(adapter.created).toHaveLength(2)
    })

    it('honours --version-name', async () => {
      const adapter = new StubAdapter(liveShape())
      registerSrsBackend('stub', () => adapter)

      await runNormalize(options({ apply: true, versionName: 'v1 — Existant', feature: 'flat-a' }), io)

      expect(adapter.created).toEqual([{ parent: 'flat-a', title: 'v1 — Existant' }])
    })
  })

  describe('--feature', () => {
    it('restricts the run to one feature', async () => {
      const adapter = new StubAdapter(liveShape())
      registerSrsBackend('stub', () => adapter)

      const code = await runNormalize(options({ apply: true, feature: 'flat-b' }), io)

      expect(code).toBe(0)
      expect(adapter.created).toEqual([{ parent: 'flat-b', title: 'MVP' }])
      expect(adapter.moved).toEqual([{ pageId: 'fr-3', parent: 'version-of-flat-b' }])
    })

    it('reports an already-conforming feature as nothing to do', async () => {
      registerSrsBackend('stub', () => new StubAdapter(liveShape()))
      const code = await runNormalize(options({ feature: 'deep' }), io)
      expect(code).toBe(0)
      expect(io.out.join('')).toMatch(/already holds its FRs under a version page/)
    })

    it('errors when the feature does not exist', async () => {
      registerSrsBackend('stub', () => new StubAdapter(liveShape()))
      const code = await runNormalize(options({ feature: 'nope' }), io)
      expect(code).toBe(2)
      expect(io.err.join('')).toMatch(/no feature matching "nope"/)
    })
  })

  // Notion has no transactional rollback. A partial failure that does not say
  // what already moved turns into a manual audit of 196 pages.
  describe('partial failure', () => {
    it('names every page already moved when a move fails', async () => {
      const adapter = new StubAdapter(liveShape(), { move: 'fr-2' })
      registerSrsBackend('stub', () => adapter)

      const code = await runNormalize(options({ apply: true }), io)

      expect(code).toBe(6)
      const err = io.err.join('')
      expect(err).toMatch(/failed to move "FR-CAPTURE-02 — Stop"/)
      expect(err).toMatch(/1 page\(s\) were already moved/)
      expect(err).toMatch(/fr-1/)
      expect(err).toMatch(/Re-running is safe/)
    })

    it('says plainly when nothing had moved yet', async () => {
      const adapter = new StubAdapter(liveShape(), { create: 'flat-a' })
      registerSrsBackend('stub', () => adapter)

      const code = await runNormalize(options({ apply: true }), io)

      expect(code).toBe(6)
      expect(io.err.join('')).toMatch(/No page was moved before the failure/)
    })
  })

  it('reports a fully conforming SRS as nothing to do', async () => {
    registerSrsBackend('stub', () => new StubAdapter({ root: [page('deep', 'Réunion live')], deep: [page('v1', 'MVP')], v1: [page('fr', 'FR-LIVE-001 — X')] }))
    const code = await runNormalize(options(), io)
    expect(code).toBe(0)
    expect(io.out.join('')).toMatch(/every feature already conforms/)
  })
})

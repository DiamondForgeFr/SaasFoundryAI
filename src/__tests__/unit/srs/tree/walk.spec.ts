import { EpicSpec, FrSpec, PageContent, PageRef, RawContent, ResolvedParent, SrsAdapter } from '../../../../builders/srs/types'
import { SrsConformanceKind, walkSrsTree } from '../../../../srs/tree/walk'

class StubAdapter implements SrsAdapter {
  public readonly calls: string[] = []
  constructor(private readonly tree: Record<string, PageRef[]>) {}
  async init(): Promise<void> {}
  async resolveParent(input: string): Promise<ResolvedParent> {
    return { id: input, name: input }
  }
  async createPage(_parent: string, title: string): Promise<PageRef> {
    return { id: 'x', url: '', title }
  }
  async createEpicPage(spec: EpicSpec): Promise<PageRef> {
    return { id: 'e', url: '', title: spec.title }
  }
  async createFrPage(spec: FrSpec): Promise<PageRef> {
    return { id: 'f', url: '', title: spec.fr.title }
  }
  async updatePage(id: string, content: PageContent): Promise<void> {
    void id
    void content
  }
  async fetchPage(pageId: string): Promise<RawContent> {
    return { pageId, title: '', url: '', blocks: [] }
  }
  async listChildren(parentId: string): Promise<PageRef[]> {
    this.calls.push(parentId)
    return this.tree[parentId] ?? []
  }
}

function page(id: string, title: string): PageRef {
  return { id, url: `https://notion.so/${id}`, title }
}

function kinds(findings: Array<{ kind: SrsConformanceKind }>): SrsConformanceKind[] {
  return findings.map((f) => f.kind)
}

describe('walkSrsTree', () => {
  // ── Shape 1: flat (25 of the 36 real features) ────────────────────────────
  it('reads a feature that holds its FRs directly and names it non-conforming', async () => {
    const adapter = new StubAdapter({
      root: [page('feat-a', 'Capture audio & enregistrement')],
      'feat-a': [page('fr-1', 'FR-CAPTURE-01 — Start recording'), page('fr-2', 'FR-CAPTURE-02 — Stop recording')]
    })

    const tree = await walkSrsTree(adapter, 'root')

    expect(tree.frs.map((f) => f.id)).toEqual(['FR-CAPTURE-01', 'FR-CAPTURE-02'])
    expect(tree.frs[0]).toMatchObject({
      featurePageId: 'feat-a',
      featureTitle: 'Capture audio & enregistrement',
      holderPageId: 'feat-a',
      holderTitle: 'Capture audio & enregistrement'
    })
    expect(tree.frs[0].version).toBeUndefined()
    expect(kinds(tree.conformance)).toEqual(['feature-without-version'])
    expect(tree.conformance[0].message).toContain('no version page')
    expect(tree.features[0]).toMatchObject({ frCount: 2, conforming: false })
    expect(tree.unparsedPages).toEqual([])
  })

  // ── Shape 2: versioned (the model) ────────────────────────────────────────
  it('reads FRs one level deeper, under a version page, and attributes the version', async () => {
    const adapter = new StubAdapter({
      root: [page('feat-b', 'Réunion live : transcript & notes')],
      'feat-b': [page('v1', 'v1 — Existant'), page('v2', 'v2 — Prise de notes vivante')],
      v1: [page('fr-3', 'FR-LIVE-001 — Transcript')],
      v2: [page('fr-4', 'FR-LIVE-007 — Topic-aware AI note taking'), page('fr-5', 'FR-LIVE-008 — Per-topic consolidation')]
    })

    const tree = await walkSrsTree(adapter, 'root')

    expect(tree.frs.map((f) => f.id)).toEqual(['FR-LIVE-001', 'FR-LIVE-007', 'FR-LIVE-008'])
    expect(tree.frs[1]).toMatchObject({
      featurePageId: 'feat-b',
      featureTitle: 'Réunion live : transcript & notes',
      version: 'v2 — Prise de notes vivante',
      versionPageId: 'v2',
      holderPageId: 'v2',
      holderTitle: 'v2 — Prise de notes vivante'
    })
    expect(tree.features[0]).toMatchObject({ frCount: 3, conforming: true })
    expect(tree.features[0].versions.map((v) => v.frCount)).toEqual([1, 2])
    expect(tree.conformance).toEqual([])
    // The 13 real version pages used to be reported as malformed FR pages. They are levels.
    expect(tree.unparsedPages).toEqual([])
  })

  // A version is named by whoever wrote it. Reading the level from the title would
  // drop every feature that numbers its versions differently.
  it.each(['MVP', 'V1', 'v2 — Titre', 'Existant', 'Phase deux'])('treats "%s" as a version because of its position, not its name', async (versionTitle) => {
    const adapter = new StubAdapter({
      root: [page('feat', 'Feature')],
      feat: [page('ver', versionTitle)],
      ver: [page('fr', 'FR-X-01 — Something')]
    })

    const tree = await walkSrsTree(adapter, 'root')

    expect(tree.frs).toHaveLength(1)
    expect(tree.frs[0].version).toBe(versionTitle)
    expect(tree.conformance).toEqual([])
  })

  // ── Shape 3: both shapes in one tree ──────────────────────────────────────
  it('reads the flat and the versioned shape in a single pass without losing either', async () => {
    const adapter = new StubAdapter({
      root: [page('flat', 'Flat feature'), page('deep', 'Versioned feature')],
      flat: [page('fr-a', 'FR-FLAT-01 — A')],
      deep: [page('v1', 'MVP')],
      v1: [page('fr-b', 'FR-DEEP-01 — B')]
    })

    const tree = await walkSrsTree(adapter, 'root')

    expect(tree.frs.map((f) => f.id)).toEqual(['FR-FLAT-01', 'FR-DEEP-01'])
    expect(tree.features.map((f) => f.conforming)).toEqual([false, true])
    expect(kinds(tree.conformance)).toEqual(['feature-without-version'])
  })

  it('reports a feature that mixes direct FRs with version pages under the same kind, with a distinct message', async () => {
    const adapter = new StubAdapter({
      root: [page('feat', 'Mixed feature')],
      feat: [page('fr-loose', 'FR-MIX-01 — Loose'), page('v1', 'v1')],
      v1: [page('fr-in', 'FR-MIX-02 — Placed')]
    })

    const tree = await walkSrsTree(adapter, 'root')

    expect(tree.frs.map((f) => f.id)).toEqual(['FR-MIX-01', 'FR-MIX-02'])
    expect(kinds(tree.conformance)).toEqual(['feature-without-version'])
    expect(tree.conformance[0].message).toContain('sit beside its 1 version page(s)')
  })

  // ── Shape 4: a page where an FR was expected ──────────────────────────────
  it('reports a non-FR page under a version and excludes it from the FR list', async () => {
    const adapter = new StubAdapter({
      root: [page('feat', 'Feature')],
      feat: [page('v1', 'v1')],
      v1: [page('fr', 'FR-X-01 — Real'), page('junk', 'Meeting notes')]
    })

    const tree = await walkSrsTree(adapter, 'root')

    expect(tree.frs.map((f) => f.id)).toEqual(['FR-X-01'])
    expect(kinds(tree.conformance)).toEqual(['unexpected-page-under-version'])
    expect(tree.unparsedPages).toEqual([{ pageId: 'junk', title: 'Meeting notes', holderTitle: 'v1' }])
  })

  // ── Shape 5: an FR at root level ──────────────────────────────────────────
  it('records an FR sitting directly under the root instead of dropping it', async () => {
    const adapter = new StubAdapter({
      root: [page('orphan', 'FR-ORPHAN-01 — No feature above me'), page('feat', 'Feature')],
      feat: [page('fr', 'FR-X-01 — Normal')]
    })

    const tree = await walkSrsTree(adapter, 'root')

    expect(tree.frs.map((f) => f.id)).toEqual(['FR-ORPHAN-01', 'FR-X-01'])
    expect(kinds(tree.conformance)).toEqual(['fr-at-root-level', 'feature-without-version'])
    expect(tree.frs[0]).toMatchObject({ featurePageId: 'root', holderPageId: 'root' })
    // The orphan is not a feature — it must not appear in the feature list.
    expect(tree.features.map((f) => f.pageId)).toEqual(['feat'])
  })

  // ── Shape 6: the depth cap ────────────────────────────────────────────────
  it('reports a page nested below the FR level and stops descending there', async () => {
    const adapter = new StubAdapter({
      root: [page('feat', 'Feature')],
      feat: [page('v1', 'v1')],
      v1: [page('junk', 'Sub-section')],
      junk: [page('deep', 'FR-TOODEEP-01 — Buried')],
      deep: [page('deeper', 'Even deeper')]
    })

    const tree = await walkSrsTree(adapter, 'root')

    // The buried FR counts for nobody, so the version and the feature both report empty.
    expect(kinds(tree.conformance)).toEqual(['unexpected-page-under-version', 'nesting-too-deep', 'version-without-frs', 'feature-without-frs'])
    // The message has to name the cost: a buried FR is one no score will ever see.
    expect(tree.conformance[1].message).toContain('1 child page(s), 1 of them FR page(s) that no score will ever see')
    // The buried FR is NOT harvested — the model stops at the FR level, and silently
    // reaching deeper would make the tree's shape unpredictable.
    expect(tree.frs).toEqual([])
    // Nothing below the flagged page is visited.
    expect(adapter.calls).not.toContain('deep')
  })

  // ── Conformance edges ─────────────────────────────────────────────────────
  it('reports a feature carrying no spec at all', async () => {
    const adapter = new StubAdapter({ root: [page('empty', 'Empty feature')] })

    const tree = await walkSrsTree(adapter, 'root')

    expect(kinds(tree.conformance)).toEqual(['feature-without-frs'])
    expect(tree.features[0]).toMatchObject({ frCount: 0, conforming: false })
  })

  it('reports a version page holding no FR rather than absorbing it as an empty level', async () => {
    const adapter = new StubAdapter({
      root: [page('feat', 'Feature')],
      feat: [page('v1', 'v1'), page('v2', 'v2')],
      v1: [page('fr', 'FR-X-01 — Real')]
    })

    const tree = await walkSrsTree(adapter, 'root')

    expect(kinds(tree.conformance)).toEqual(['version-without-frs'])
    expect(tree.conformance[0].title).toBe('v2')
  })

  it('handles an empty root', async () => {
    const tree = await walkSrsTree(new StubAdapter({ root: [] }), 'root')
    expect(tree).toMatchObject({ rootPageId: 'root', features: [], frs: [], conformance: [], unparsedPages: [] })
  })

  // ── Call budget ───────────────────────────────────────────────────────────
  it('never descends into an FR page, so the call count follows the non-FR pages only', async () => {
    const adapter = new StubAdapter({
      root: [page('feat', 'Feature')],
      feat: [page('v1', 'v1')],
      v1: [page('fr-1', 'FR-X-01 — A'), page('fr-2', 'FR-X-02 — B'), page('fr-3', 'FR-X-03 — C')]
    })

    await walkSrsTree(adapter, 'root')

    expect(adapter.calls).toEqual(['root', 'feat', 'v1'])
  })
})

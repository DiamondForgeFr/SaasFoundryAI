import { FR_TITLE_SEPARATOR } from '../../../../builders/srs/constants'
import { EpicSpec, FrSpec, PageContent, PageRef, RawContent, ResolvedParent, SrsAdapter } from '../../../../builders/srs/types'
import { buildSrsInventory, parseFrPageTitle } from '../../../../srs/eval/inventory'

class StubAdapter implements SrsAdapter {
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
    return this.tree[parentId] ?? []
  }
}

describe('parseFrPageTitle', () => {
  it('parses the canonical FR page-title shape "FR-AREA-NN — Title"', () => {
    expect(parseFrPageTitle('FR-AUTH-01 — Sign in')).toEqual({ id: 'FR-AUTH-01', area: 'auth', title: 'Sign in' })
  })

  it('parses the double-index shape "FR-AREA-NN-MM — Title"', () => {
    expect(parseFrPageTitle('FR-AUTH-01-02 — Sign out')).toEqual({ id: 'FR-AUTH-01-02', area: 'auth', title: 'Sign out' })
  })

  // Regression: the area used to be a single alphanumeric segment, so every multi-segment id
  // failed to parse. The 8 real FR-CONFIG-ENGINE-* pages were dropped from the inventory in
  // silence, deflating frTotal from 42 to 34 and inflating the freshness score.
  it('parses a multi-segment area "FR-CONFIG-ENGINE-NN — Title"', () => {
    expect(parseFrPageTitle('FR-CONFIG-ENGINE-01 — Declarative step definitions')).toEqual({
      id: 'FR-CONFIG-ENGINE-01',
      area: 'config-engine',
      title: 'Declarative step definitions'
    })
  })

  it('keeps the trailing numeric group out of a multi-segment area', () => {
    expect(parseFrPageTitle('FR-CONFIG-ENGINE-01-02 — Nested')).toEqual({
      id: 'FR-CONFIG-ENGINE-01-02',
      area: 'config-engine',
      title: 'Nested'
    })
  })

  it('returns null for a title that carries no FR id', () => {
    expect(parseFrPageTitle('Some random page title')).toBeNull()
  })

  it('accepts a colon separator', () => {
    expect(parseFrPageTitle('FR-STORAGE-01: Upload')).toEqual({ id: 'FR-STORAGE-01', area: 'storage', title: 'Upload' })
  })

  it('parses a title built with the shared FR_TITLE_SEPARATOR constant', () => {
    const raw = `FR-AUTH-01${FR_TITLE_SEPARATOR}Sign in`
    expect(parseFrPageTitle(raw)).toEqual({ id: 'FR-AUTH-01', area: 'auth', title: 'Sign in' })
  })

  it('normalises the area to lowercase', () => {
    expect(parseFrPageTitle('FR-Accounts-01 — X')?.area).toBe('accounts')
  })

  it('returns null when the title is not an FR id', () => {
    expect(parseFrPageTitle('Random page')).toBeNull()
    expect(parseFrPageTitle('UR-AUTH-01')).toBeNull()
  })
})

describe('buildSrsInventory', () => {
  it('walks root → Epic → FR pages and skips non-FR children', async () => {
    const adapter = new StubAdapter({
      root: [
        { id: 'epic-a', url: '', title: 'Authentication' },
        { id: 'epic-b', url: '', title: 'Storage' }
      ],
      'epic-a': [
        { id: 'fr-a1', url: '', title: 'FR-AUTH-01 — Sign in' },
        { id: 'fr-a2', url: '', title: 'FR-AUTH-02 — Sign out' },
        { id: 'junk', url: '', title: 'Random note' }
      ],
      'epic-b': [{ id: 'fr-b1', url: '', title: 'FR-STORAGE-01 — Upload file' }]
    })

    const inventory = await buildSrsInventory(adapter, 'root')

    expect(inventory.rootPageId).toBe('root')
    expect(inventory.epics.map((e) => e.title)).toEqual(['Authentication', 'Storage'])
    expect(inventory.frs).toEqual([
      { id: 'FR-AUTH-01', area: 'auth', title: 'Sign in', pageId: 'fr-a1', epicPageId: 'epic-a', epicTitle: 'Authentication' },
      { id: 'FR-AUTH-02', area: 'auth', title: 'Sign out', pageId: 'fr-a2', epicPageId: 'epic-a', epicTitle: 'Authentication' },
      { id: 'FR-STORAGE-01', area: 'storage', title: 'Upload file', pageId: 'fr-b1', epicPageId: 'epic-b', epicTitle: 'Storage' }
    ])
    expect(inventory.unsupportedCategories).toEqual(['UR', 'DS', 'TC', 'NFR'])
  })

  it('handles an empty root', async () => {
    const adapter = new StubAdapter({ root: [] })
    const inventory = await buildSrsInventory(adapter, 'root')
    expect(inventory.epics).toEqual([])
    expect(inventory.frs).toEqual([])
  })

  // A page excluded from the inventory is excluded from every score, so it must be reported.
  it('reports pages under an Epic whose title yields no FR id instead of dropping them silently', async () => {
    const adapter = new StubAdapter({
      root: [{ id: 'epic-a', url: '', title: 'Authentication' }],
      'epic-a': [
        { id: 'fr-a1', url: '', title: 'FR-AUTH-01 — Sign in' },
        { id: 'junk', url: '', title: 'Meeting notes' }
      ]
    })

    const inventory = await buildSrsInventory(adapter, 'root')

    expect(inventory.frs).toHaveLength(1)
    expect(inventory.unparsedPages).toEqual([{ pageId: 'junk', title: 'Meeting notes', epicTitle: 'Authentication' }])
  })

  it('inventories multi-segment FR areas', async () => {
    const adapter = new StubAdapter({
      root: [{ id: 'epic-c', url: '', title: 'EPIC-CONFIG-ENGINE' }],
      'epic-c': [{ id: 'fr-c1', url: '', title: 'FR-CONFIG-ENGINE-01 — Declarative step definitions' }]
    })

    const inventory = await buildSrsInventory(adapter, 'root')

    expect(inventory.frs).toHaveLength(1)
    expect(inventory.frs[0]).toMatchObject({ id: 'FR-CONFIG-ENGINE-01', area: 'config-engine' })
  })
})
